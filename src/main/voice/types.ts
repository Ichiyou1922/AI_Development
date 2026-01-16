/**
 * 音声認識結果
 */
export interface TranscriptionResult {
    text: string;
    language?: string;
    duration?: number;      // 秒
    confidence?: number;    // 0.0 ~ 1.0
}

/**
 * 音声認識プロバイダのインターフェース
 */
export interface STTProvider {
    initialize(): Promise<void>;
    transcribe(audioBuffer: Buffer, sampleRate: number): Promise<TranscriptionResult>;
    isReady(): boolean;
}

/**
 * マイクキャプチャの状態
 */
export type CaptureState = 'idle' | 'listening' | 'recording' | 'processing';

/**
 * VAD（音声区間検出）イベント
 */
export interface VADEvent {
    type: 'speech_start' | 'speech_end' | 'silence';
    timestamp: number;
}

/**
 * 音声キャプチャの設定
 */
export interface CaptureConfig {
    sampleRate: number;         // 16000Hz推奨（Whisper用）
    channels: number;           // 1（モノラル）
    bitDepth: number;           // 16
    silenceThreshold: number;   // 無音判定の閾値（0.0 ~ 1.0）
    silenceDuration: number;    // 無音継続時間（ms）で録音停止
    maxRecordingTime: number;   // 最大録音時間（ms）
    intermediateSilenceDuration?: number; // 分割用：短い無音判定（ms）
    minChunkLength?: number;              // 分割用：最小チャンク長（ms）
}

/**
 * 音声合成プロバイダのインターフェース
 */
export interface TTSProvider {
    initialize(): Promise<void>;
    synthesize(text: string): Promise<Buffer>;
    isReady(): boolean;
    getSpeakers(): Promise<Speaker[]>;
    setSpeaker(speakerId: number): void;
}

/**
 * VOICEVOX話者情報
 */
export interface Speaker {
    id: number;
    name: string;
    styles: SpeakerStyle[];
}

export interface SpeakerStyle {
    id: number;
    name: string;
}

/**
 * 音声再生状態
 */
export type PlaybackState = 'idle' | 'playing' | 'paused';