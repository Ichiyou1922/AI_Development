import { EventEmitter } from 'events';
import { VoicevoxProvider } from './voicevoxProvider.js';
import { AudioPlayer } from './audioPlayer.js';

/**
 * 文区切り検出用の正規表現
 * 句読点で文を区切る
 */
const SENTENCE_DELIMITERS = /[。！？!?\n]/;

/**
 * 音声キューアイテム
 */
interface AudioQueueItem {
    text: string;
    buffer: Buffer;
    index: number;
}

/**
 * StreamingTTSControllerイベント
 */
export interface StreamingTTSEvents {
    start: () => void;
    sentenceDetected: (data: { text: string; index: number }) => void;
    synthesized: (data: { text: string; index: number; bufferSize: number }) => void;
    playStart: (data: { text: string; index: number }) => void;
    playEnd: (data: { text: string; index: number }) => void;
    done: () => void;
    stopped: () => void;
    error: (data: { text: string; index: number; error: unknown }) => void;
}

/**
 * ストリーミングTTSコントローラ
 *
 * LLMからのトークンをストリーミング受信しながら、
 * 句読点で区切った文単位でVOICEVOXに音声合成させ、順次再生する。
 *
 * server_gyaru.py の実装を参考に設計。
 */
export class StreamingTTSController extends EventEmitter {
    private voicevox: VoicevoxProvider;
    private localPlayer: AudioPlayer | null;
    private discordPlayer: ((buffer: Buffer) => Promise<void>) | null;

    // 文バッファ
    private sentenceBuffer: string = '';
    private sentenceIndex: number = 0;

    // 音声合成の追跡
    private synthesisPromises: Promise<void>[] = [];
    private pendingSynthesis: number = 0;

    // 再生キュー
    private audioQueue: AudioQueueItem[] = [];
    private isPlaying: boolean = false;
    private isStopped: boolean = false;

    // 設定
    private minSentenceLength: number = 2; // 最小文長（短すぎる文は次と結合）

    // 合成処理の連鎖用（順序保証と並列実行防止）
    private synthesisChain: Promise<void> = Promise.resolve();

    /**
     * @param voicevox - VOICEVOXプロバイダ
     * @param localPlayer - ローカル音声再生用AudioPlayer（Discord用の場合はundefined）
     * @param discordPlayer - Discord音声再生用関数（ローカル用の場合はundefined）
     */
    constructor(
        voicevox: VoicevoxProvider,
        localPlayer?: AudioPlayer,
        discordPlayer?: (buffer: Buffer) => Promise<void>
    ) {
        super();
        this.voicevox = voicevox;
        this.localPlayer = localPlayer || null;
        this.discordPlayer = discordPlayer || null;
    }

    /**
     * ストリーミング開始
     */
    start(): void {
        this.reset();
        console.log('[StreamingTTS] Started');
        this.emit('start');
    }

    /**
     * トークン受信
     * LLMのonTokenコールバックから呼び出す
     */
    onToken(token: string): void {
        if (this.isStopped) return;

        this.sentenceBuffer += token;

        // 句読点を検出して文を抽出
        this.processSentenceBuffer();
    }

    /**
     * ストリーミング終了
     * LLMのonDoneコールバックから呼び出す
     */
    async onDone(): Promise<void> {
        console.log('[StreamingTTS] onDone called, buffer remaining:', this.sentenceBuffer.length);

        // バッファに残っている文を処理
        if (this.sentenceBuffer.trim()) {
            this.enqueueSentence(this.sentenceBuffer.trim());
            this.sentenceBuffer = '';
        }

        // すべての合成完了を待つ
        // synthesisChainが完了するのを待つだけでよいはずだが、
        // 念のためsynthesisPromisesもチェック（enqueueSentenceでの実装による）

        // 既存のsynthesisPromisesは維持しつつ、chainも待機
        await this.synthesisChain;

        if (this.synthesisPromises.length > 0) {
            console.log('[StreamingTTS] Waiting for synthesis to complete...');
            try {
                await Promise.all(this.synthesisPromises);
            } catch (error) {
                console.error('[StreamingTTS] Synthesis error during onDone:', error);
            }
        }

        // 再生完了を待つ
        console.log('[StreamingTTS] Waiting for playback to complete...');
        await this.waitForPlaybackComplete();

        console.log('[StreamingTTS] Done');
        this.emit('done');
    }

    /**
     * 中断
     */
    stop(): void {
        console.log('[StreamingTTS] Stopped');
        this.isStopped = true;
        this.audioQueue = [];
        this.localPlayer?.stop();
        this.emit('stopped');
    }

    /**
     * 文バッファを処理
     * 句読点を検出して文を抽出し、合成キューに追加
     */
    private processSentenceBuffer(): void {
        let match: RegExpExecArray | null;

        // 句読点が見つかるたびに文を抽出
        while ((match = SENTENCE_DELIMITERS.exec(this.sentenceBuffer)) !== null) {
            const sentence = this.sentenceBuffer.substring(0, match.index + 1).trim();
            this.sentenceBuffer = this.sentenceBuffer.substring(match.index + 1);

            // 短すぎる文はスキップ（次の文と結合される）
            if (sentence.length >= this.minSentenceLength) {
                this.enqueueSentence(sentence);
            } else if (sentence.length > 0) {
                // 短い文はバッファに戻す（次の文と結合）
                this.sentenceBuffer = sentence + this.sentenceBuffer;
            }
        }
    }

    /**
     * 文を合成キューに追加
     */
    private enqueueSentence(text: string): void {
        if (this.isStopped) return;

        const index = this.sentenceIndex++;
        this.pendingSynthesis++;

        this.emit('sentenceDetected', { text, index });

        // 並列実行ではなく、チェーンして直列実行する
        // これにより順序保証と負荷分散を行う
        const task = () => this.synthesizeAndQueue(text, index);

        // チェーンに追加
        this.synthesisChain = this.synthesisChain.then(task).catch(() => {
            // エラーはsynthesizeAndQueue内で処理されるため、ここでチェーンを止めない
        });

        // onDoneでの待機用にPromiseリストにも入れる（ただしchainがあるので実質的にはchain待ちで十分）
        // 型合わせのために、チェーンの末尾をPromiseとして登録しておく
        this.synthesisPromises.push(this.synthesisChain);
    }

    /**
     * 音声合成してキューに追加
     */
    private async synthesizeAndQueue(text: string, index: number): Promise<void> {
        if (this.isStopped) {
            this.pendingSynthesis--;
            return;
        }

        try {
            const buffer = await this.voicevox.synthesize(text);
            this.pendingSynthesis--;

            if (this.isStopped) return;

            this.emit('synthesized', { text, index, bufferSize: buffer.length });

            // 再生キューに追加
            this.audioQueue.push({ text, buffer, index });

            // 再生中でなければ再生開始
            if (!this.isPlaying) {
                this.playNext();
            }
        } catch (error) {
            this.pendingSynthesis--;
            console.error(`[StreamingTTS] Synthesis error [${index}]:`, error);
            this.emit('error', { text, index, error });
        }
    }

    /**
     * 次の音声を再生（ループ形式）
     */
    private async playNext(): Promise<void> {
        // 既に再生中の場合は何もしない（二重起動防止）
        if (this.isPlaying) {
            return;
        }

        this.isPlaying = true;

        // キューが空になるまでループ
        while (this.audioQueue.length > 0 && !this.isStopped) {
            const item = this.audioQueue.shift()!;

            this.emit('playStart', { text: item.text, index: item.index });

            try {
                if (this.discordPlayer) {
                    await this.discordPlayer(item.buffer);
                } else if (this.localPlayer) {
                    await this.localPlayer.play(item.buffer);
                }

                this.emit('playEnd', { text: item.text, index: item.index });
            } catch (error) {
                console.error(`[StreamingTTS] Play error [${item.index}]:`, error);
                this.emit('error', { text: item.text, index: item.index, error });
            }
        }

        this.isPlaying = false;
    }

    /**
     * 再生完了を待つ
     */
    private waitForPlaybackComplete(): Promise<void> {
        return new Promise((resolve) => {
            const check = () => {
                if (!this.isPlaying && this.audioQueue.length === 0 && this.pendingSynthesis === 0) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    /**
     * リセット
     */
    private reset(): void {
        this.sentenceBuffer = '';
        this.sentenceIndex = 0;
        this.synthesisPromises = [];
        this.pendingSynthesis = 0;
        this.audioQueue = [];
        this.isPlaying = false;
        this.isStopped = false;
    }

    /**
     * 状態取得
     */
    getStatus(): {
        isStopped: boolean;
        isPlaying: boolean;
        pendingSynthesis: number;
        queuedAudio: number;
        bufferLength: number;
    } {
        return {
            isStopped: this.isStopped,
            isPlaying: this.isPlaying,
            pendingSynthesis: this.pendingSynthesis,
            queuedAudio: this.audioQueue.length,
            bufferLength: this.sentenceBuffer.length,
        };
    }

    /**
     * 再生中かどうか
     */
    isSpeaking(): boolean {
        return this.isPlaying || this.audioQueue.length > 0 || this.pendingSynthesis > 0;
    }
}
