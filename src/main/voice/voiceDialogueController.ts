import { EventEmitter } from 'events';
import { MicrophoneCapture } from './microphoneCapture.js';
import { STTProvider } from './types.js';
import { VoicevoxProvider } from './voicevoxProvider.js';
import { AudioPlayer } from './audioPlayer.js';

/**
 * 音声対話の状態
 */
export type DialogueState =
    | 'idle'           // 待機中
    | 'listening'      // 音声入力待ち
    | 'recording'      // 録音中
    | 'transcribing'   // 音声認識中
    | 'thinking'       // LLM処理中
    | 'speaking';      // 読み上げ中

/**
 * 音声対話イベント
 */
export interface DialogueEvents {
    stateChange: (state: DialogueState) => void;
    userSpeech: (text: string) => void;
    assistantResponse: (text: string) => void;
    error: (error: Error) => void;
}

/**
 * 音声対話コントローラ
 * STT → LLM → TTS のループを管理
 */
export class VoiceDialogueController extends EventEmitter {
    private micCapture: MicrophoneCapture;
    private stt: STTProvider;
    private voicevox: VoicevoxProvider;
    private audioPlayer: AudioPlayer;

    private state: DialogueState = 'idle';
    private isActive: boolean = false;
    private autoListen: boolean = true;  // TTS後に自動でリスニング再開

    // 外部から注入されるLLM処理関数
    private llmHandler: ((text: string) => Promise<string>) | null = null;

    constructor(
        micCapture: MicrophoneCapture,
        stt: STTProvider,
        voicevox: VoicevoxProvider,
        audioPlayer: AudioPlayer
    ) {
        super();
        this.micCapture = micCapture;
        this.stt = stt;
        this.voicevox = voicevox;
        this.audioPlayer = audioPlayer;

        this.setupEventHandlers();
    }

    /**
     * イベントハンドラのセットアップ
     */
    private setupEventHandlers(): void {
        // マイクからの音声キャプチャ
        this.micCapture.on('audioCapture', async (audioBuffer: Buffer) => {
            await this.handleAudioCapture(audioBuffer);
        });

        // マイク状態変更
        this.micCapture.on('stateChange', (captureState: string) => {
            if (captureState === 'recording') {
                // 発話中は録音状態に遷移させない
                if (this.state !== 'speaking') {
                    this.setState('recording');
                }
            } else if (captureState === 'listening' && this.state === 'recording') {
                this.setState('transcribing');
            }
        });

        // 音声再生完了
        this.audioPlayer.on('stateChange', (playbackState: string) => {
            if (playbackState === 'idle' && this.state === 'speaking') {
                this.onSpeakingComplete();
            }
        });
    }

    /**
     * LLMハンドラを設定
     */
    setLLMHandler(handler: (text: string) => Promise<string>): void {
        this.llmHandler = handler;
    }

    /**
     * 音声対話を開始
     */
    start(): void {
        if (this.isActive) {
            console.log('[VoiceDialogue] Already active');
            return;
        }

        console.log('[VoiceDialogue] Starting voice dialogue');
        this.isActive = true;
        this.setState('listening');
        this.micCapture.startListening();
    }

    /**
     * 音声対話を停止
     */
    stop(): void {
        console.log('[VoiceDialogue] Stopping voice dialogue');
        this.isActive = false;
        this.micCapture.stop();
        this.audioPlayer.stop();
        this.setState('idle');
    }

    /**
     * 読み上げを中断（割り込み）
     */
    interrupt(): void {
        if (this.state === 'speaking') {
            console.log('[VoiceDialogue] Interrupted');
            this.audioPlayer.stop();
            this.setState('listening');
            this.micCapture.startListening();
        }
    }

    /**
     * 自動リスニングの設定
     */
    setAutoListen(enabled: boolean): void {
        this.autoListen = enabled;
    }

    /**
     * 音声キャプチャの処理
     */
    private async handleAudioCapture(audioBuffer: Buffer): Promise<void> {
        if (!this.isActive) return;

        // 発話中の音声入力は無視（エコーバック防止）
        if (this.state === 'speaking') {
            console.log('[VoiceDialogue] Ignored audio input during speaking');
            return;
        }

        try {
            this.setState('transcribing');

            // STT: 音声→テキスト
            const result = await this.stt.transcribe(audioBuffer, 16000);
            const userText = result.text.trim();

            if (!userText) {
                console.log('[VoiceDialogue] Empty transcription, resuming listening');
                this.resumeListening();
                return;
            }

            console.log(`[VoiceDialogue] User said: "${userText}"`);
            this.emit('userSpeech', userText);

            // LLM処理
            if (this.llmHandler) {
                this.setState('thinking');
                const response = await this.llmHandler(userText);

                if (!this.isActive) return;  // 停止された場合

                console.log(`[VoiceDialogue] Assistant: "${response.substring(0, 50)}..."`);
                this.emit('assistantResponse', response);

                // TTS: テキスト→音声
                await this.speak(response);
            } else {
                console.warn('[VoiceDialogue] No LLM handler set');
                this.resumeListening();
            }

        } catch (error) {
            console.error('[VoiceDialogue] Error:', error);
            this.emit('error', error as Error);
            this.resumeListening();
        }
    }

    /**
     * テキストを読み上げ
     */
    async speak(text: string): Promise<void> {
        if (!this.isActive) return;

        try {
            this.setState('speaking');
            const audioBuffer = await this.voicevox.synthesize(text);
            await this.audioPlayer.play(audioBuffer);
        } catch (error) {
            console.error('[VoiceDialogue] TTS error:', error);
            this.onSpeakingComplete();
        }
    }

    /**
     * 読み上げ完了時の処理
     */
    private onSpeakingComplete(): void {
        if (!this.isActive) {
            this.setState('idle');
            return;
        }

        // 残響対策：少し待ってからリスニング再開
        setTimeout(() => {
            if (!this.isActive) return;

            if (this.autoListen) {
                this.resumeListening();
            } else {
                this.setState('idle');
            }
        }, 500); // 0.5秒待機 もっと長くしないとだめか
    }

    /**
     * リスニングを再開
     */
    private resumeListening(): void {
        if (this.isActive) {
            this.setState('listening');
            this.micCapture.startListening();
        }
    }

    /**
     * 状態を更新
     */
    private setState(newState: DialogueState): void {
        if (this.state !== newState) {
            console.log(`[VoiceDialogue] State: ${this.state} -> ${newState}`);
            this.state = newState;
            this.emit('stateChange', newState);
        }
    }

    /**
     * 現在の状態を取得
     */
    getState(): DialogueState {
        return this.state;
    }

    /**
     * アクティブかどうか
     */
    isDialogueActive(): boolean {
        return this.isActive;
    }
}