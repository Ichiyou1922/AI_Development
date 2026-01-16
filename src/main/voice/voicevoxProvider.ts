import { TTSProvider, Speaker, SpeakerStyle } from './types.js';

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
 */
export class VoicevoxProvider implements TTSProvider {
    private baseUrl: string;
    private speakerId: number;
    private ready: boolean = false;

    constructor(baseUrl: string = 'http://localhost:50021', speakerId: number = 1) {
        this.baseUrl = baseUrl;
        this.speakerId = speakerId;
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
        const queryResponse = await fetch(
            `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${this.speakerId}`,
            { method: 'POST' }
        );

        if (!queryResponse.ok) {
            const errorText = await queryResponse.text().catch(() => '');
            throw new Error(`AudioQuery failed: ${queryResponse.status} - ${errorText}`);
        }

        const audioQuery: AudioQuery = await queryResponse.json();

        // Step 2: 音声合成
        const synthesisResponse = await fetch(
            `${this.baseUrl}/synthesis?speaker=${this.speakerId}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(audioQuery),
            }
        );

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