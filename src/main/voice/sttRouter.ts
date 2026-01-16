import { STTProvider, TranscriptionResult } from './types.js';
import { WhisperProvider } from './whisperProvider.js';
import { FasterWhisperProvider } from './fasterWhisperProvider.js';

export type STTProviderType = 'whisper-cpp' | 'faster-whisper';

/**
 * STTプロバイダを動的に切り替えるルーター
 * 
 * 優先順位:
 * 1. faster-whisper (GPU, 高速)
 * 2. whisper-cpp (CPU, フォールバック)
 */
export class STTRouter implements STTProvider {
    private providers: Map<STTProviderType, STTProvider> = new Map();
    private activeProvider: STTProviderType;
    private initialized: boolean = false;

    constructor(preferredProvider: STTProviderType = 'faster-whisper') {
        this.activeProvider = preferredProvider;
    }

    async initialize(): Promise<void> {
        console.log(`[STTRouter] Initializing with preferred provider: ${this.activeProvider}`);

        // faster-whisperを優先して試行
        if (this.activeProvider === 'faster-whisper') {
            try {
                const fasterWhisper = new FasterWhisperProvider();
                await fasterWhisper.initialize();
                this.providers.set('faster-whisper', fasterWhisper);
                console.log('[STTRouter] Using faster-whisper (GPU)');
                this.initialized = true;

                // サーバー情報を取得して表示
                const info = await fasterWhisper.getServerInfo();
                if (info) {
                    console.log(`[STTRouter] Server info: model=${info.model}, device=${info.device}`);
                }

                return;
            } catch (error) {
                console.warn('[STTRouter] faster-whisper initialization failed:', error);
                console.log('[STTRouter] Falling back to whisper-cpp');
            }
        }

        // フォールバック: whisper.cpp
        try {
            const whisperCpp = new WhisperProvider();
            await whisperCpp.initialize();
            this.providers.set('whisper-cpp', whisperCpp);
            this.activeProvider = 'whisper-cpp';
            console.log('[STTRouter] Using whisper-cpp (CPU)');
            this.initialized = true;
        } catch (error) {
            console.error('[STTRouter] whisper-cpp initialization also failed:', error);
            throw new Error('No STT provider available');
        }
    }

    async transcribe(audioBuffer: Buffer, sampleRate: number): Promise<TranscriptionResult> {
        if (!this.initialized) {
            throw new Error('STTRouter not initialized');
        }

        const provider = this.providers.get(this.activeProvider);
        if (!provider) {
            throw new Error(`STT provider not available: ${this.activeProvider}`);
        }

        const startTime = Date.now();

        try {
            const result = await provider.transcribe(audioBuffer, sampleRate);
            const elapsed = Date.now() - startTime;
            console.log(`[STTRouter] Transcription completed in ${elapsed}ms (${this.activeProvider})`);
            return result;
        } catch (error) {
            console.error(`[STTRouter] Transcription failed with ${this.activeProvider}:`, error);

            // アクティブプロバイダ以外で再試行
            for (const [type, altProvider] of this.providers) {
                if (type !== this.activeProvider) {
                    console.log(`[STTRouter] Retrying with ${type}...`);
                    try {
                        const result = await altProvider.transcribe(audioBuffer, sampleRate);
                        console.log(`[STTRouter] Fallback to ${type} succeeded`);
                        return result;
                    } catch (altError) {
                        console.error(`[STTRouter] Fallback to ${type} also failed:`, altError);
                    }
                }
            }

            throw error;
        }
    }

    isReady(): boolean {
        return this.initialized && this.providers.has(this.activeProvider);
    }

    getActiveProvider(): STTProviderType {
        return this.activeProvider;
    }

    /**
     * プロバイダを切り替え
     */
    async switchProvider(type: STTProviderType): Promise<boolean> {
        console.log(`[STTRouter] Switching provider to: ${type}`);

        // 既に初期化済みの場合
        if (this.providers.has(type)) {
            this.activeProvider = type;
            console.log(`[STTRouter] Switched to existing provider: ${type}`);
            return true;
        }

        // 新しいプロバイダを初期化
        try {
            if (type === 'faster-whisper') {
                const provider = new FasterWhisperProvider();
                await provider.initialize();
                this.providers.set(type, provider);
            } else {
                const provider = new WhisperProvider();
                await provider.initialize();
                this.providers.set(type, provider);
            }
            this.activeProvider = type;
            console.log(`[STTRouter] Switched to new provider: ${type}`);
            return true;
        } catch (error) {
            console.error(`[STTRouter] Failed to switch to ${type}:`, error);
            return false;
        }
    }

    /**
     * 利用可能なプロバイダ一覧
     */
    getAvailableProviders(): STTProviderType[] {
        return Array.from(this.providers.keys());
    }

    /**
     * シャットダウン
     */
    async shutdown(): Promise<void> {
        console.log('[STTRouter] Shutting down all providers...');

        for (const [type, provider] of this.providers) {
            if (type === 'faster-whisper' && provider instanceof FasterWhisperProvider) {
                await provider.shutdown();
            }
        }

        this.providers.clear();
        this.initialized = false;
        console.log('[STTRouter] Shutdown complete');
    }
}