import { TTSProvider, Speaker, SpeakerStyle } from './types.js';
import { VoicevoxConfig } from '../config/index.js';

/**
 * VOICEVOX APIレスポンス型
 */
interface VoicevoxSpeaker {
    name: string;
    speaker_uuid: string;
    styles: Array<{
        name: string;
        id: number;
    }>;
}

interface AudioQuery {
    accent_phrases: any[];
    speedScale: number;
    pitchScale: number;
    intonationScale: number;
    volumeScale: number;
    prePhonemeLength: number;
    postPhonemeLength: number;
    outputSamplingRate: number;
    outputStereo: boolean;
    kana: string;
}

/**
 * VOICEVOX Engine を使用した音声合成プロバイダ
 *
 * 設定の変更方法:
 * - config/config.json の tts.voicevox セクションを編集
 * - または環境変数 VOICEVOX_BASE_URL, VOICEVOX_SPEAKER_ID を設定
 *
 * 話者IDの確認方法:
 * - VOICEVOX Engine起動後、http://localhost:50021/speakers にアクセス
 * - または tts-speakers IPC経由で取得可能
 */
export class VoicevoxProvider implements TTSProvider {
    private baseUrl: string;
    private speakerId: number;
    private speedScale: number;
    private ready: boolean = false;

    /**
     * @param config - 設定オブジェクト（configLoader から取得）
     *
     * 使用例:
     * ```typescript
     * import { config } from '../config/index.js';
     * const provider = new VoicevoxProvider(config.tts.voicevox);
     * ```
     */
    constructor(config?: Partial<VoicevoxConfig>) {
        // デフォルト値（configLoader が初期化される前のフォールバック）
        this.baseUrl = config?.baseUrl ?? 'http://localhost:50021';
        this.speakerId = config?.speakerId ?? 14;
        this.speedScale = config?.speedScale ?? 1.3;
    }

    async initialize(): Promise<void> {
        console.log(`[VoicevoxProvider] Initializing with baseUrl: ${this.baseUrl}`);

        // 接続確認
        try {
            const response = await fetch(`${this.baseUrl}/version`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const version = await response.text();
            console.log(`[VoicevoxProvider] Connected to VOICEVOX Engine v${version}`);
            this.ready = true;
        } catch (error) {
            console.error(`[VoicevoxProvider] Failed to connect:`, error);
            console.log(`[VoicevoxProvider] Make sure VOICEVOX Engine is running on ${this.baseUrl}`);
            throw new Error(`VOICEVOX Engine not available at ${this.baseUrl}`);
        }
    }

    async synthesize(text: string): Promise<Buffer> {
        if (!this.ready) {
            throw new Error('VoicevoxProvider not initialized');
        }

        if (!text.trim()) {
            throw new Error('Empty text');
        }

        console.log(`[VoicevoxProvider] Synthesizing: "${text.substring(0, 50)}..."`);

        // Step 1: AudioQueryを生成
        const queryController = new AbortController();
        const queryTimeout = setTimeout(() => queryController.abort(), 10000); // 10秒

        let audioQuery: AudioQuery;

        try {
            const queryResponse = await fetch(
                `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${this.speakerId}`,
                {
                    method: 'POST',
                    signal: queryController.signal
                }
            );

            if (!queryResponse.ok) {
                const errorText = await queryResponse.text().catch(() => '');
                throw new Error(`AudioQuery failed: ${queryResponse.status} - ${errorText}`);
            }

            audioQuery = await queryResponse.json();
        } finally {
            clearTimeout(queryTimeout);
        }

        // 読み上げ速度を設定値で上書き
        audioQuery.speedScale = this.speedScale;

        // Discord用最適化: 変換負荷をゼロにするため、最初から48kHz Stereoで生成させる
        audioQuery.outputSamplingRate = 48000;
        audioQuery.outputStereo = true;

        // Step 2: 音声合成
        const synthesisController = new AbortController();
        const synthesisTimeout = setTimeout(() => synthesisController.abort(), 60000); // 60秒
        let synthesisResponse;

        try {
            synthesisResponse = await fetch(
                `${this.baseUrl}/synthesis?speaker=${this.speakerId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(audioQuery),
                    signal: synthesisController.signal
                }
            );

        } finally {
            clearTimeout(synthesisTimeout);
        }

        if (!synthesisResponse.ok) {
            const errorText = await synthesisResponse.text().catch(() => '');
            throw new Error(`Synthesis failed: ${synthesisResponse.status} - ${errorText}`);
        }

        const arrayBuffer = await synthesisResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`[VoicevoxProvider] Synthesized ${buffer.length} bytes`);
        return buffer;
    }

    async getSpeakers(): Promise<Speaker[]> {
        const response = await fetch(`${this.baseUrl}/speakers`);
        if (!response.ok) {
            throw new Error(`Failed to get speakers: ${response.status}`);
        }

        const speakers: VoicevoxSpeaker[] = await response.json();

        return speakers.map((s, index) => ({
            id: index,
            name: s.name,
            styles: s.styles.map(style => ({
                id: style.id,
                name: style.name,
            })),
        }));
    }

    setSpeaker(speakerId: number): void {
        this.speakerId = speakerId;
        console.log(`[VoicevoxProvider] Speaker set to ${speakerId}`);
    }

    getSpeakerId(): number {
        return this.speakerId;
    }

    isReady(): boolean {
        return this.ready;
    }
}