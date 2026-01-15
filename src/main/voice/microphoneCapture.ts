import { EventEmitter } from 'events';
import { CaptureConfig, CaptureState, VADEvent } from './types.js';
import Mic from 'mic';

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: CaptureConfig = {
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    silenceThreshold: 0.02,
    silenceDuration: 1500,      // 1.5秒の無音で録音停止
    maxRecordingTime: 30000,    // 最大30秒
};

/**
 * マイク入力のキャプチャと音声区間検出
 */
export class MicrophoneCapture extends EventEmitter {
    private config: CaptureConfig;
    private mic: any;
    private micStream: any;
    private state: CaptureState = 'idle';
    private audioChunks: Buffer[] = [];
    private silenceStart: number = 0;
    private recordingStart: number = 0;

    constructor(config: Partial<CaptureConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * マイクの初期化
     */
    initialize(): void {
        this.mic = Mic({
            rate: String(this.config.sampleRate),
            channels: String(this.config.channels),
            bitwidth: String(this.config.bitDepth),
            encoding: 'signed-integer',
            endian: 'little',
            device: 'default',
        });

        console.log(`[MicrophoneCapture] Initialized with config:`, this.config);
    }

    /**
     * リスニング開始（音声検出待ち）
     */
    startListening(): void {
        if (this.state !== 'idle') {
            console.log(`[MicrophoneCapture] Already in state: ${this.state}`);
            return;
        }

        this.state = 'listening';
        this.micStream = this.mic.getAudioStream();

        this.micStream.on('data', (chunk: Buffer) => {
            this.processAudioChunk(chunk);
        });

        this.micStream.on('error', (error: Error) => {
            console.error(`[MicrophoneCapture] Error:`, error);
            this.emit('error', error);
        });

        this.mic.start();
        console.log(`[MicrophoneCapture] Listening started`);
        this.emit('stateChange', this.state);
    }

    /**
     * 停止
     */
    stop(): void {
        if (this.mic) {
            this.mic.stop();
        }
        this.state = 'idle';
        this.audioChunks = [];
        console.log(`[MicrophoneCapture] Stopped`);
        this.emit('stateChange', this.state);
    }

    /**
     * 音声チャンクの処理
     */
    private processAudioChunk(chunk: Buffer): void {
        const volume = this.calculateVolume(chunk);
        const isSpeech = volume > this.config.silenceThreshold;
        const now = Date.now();

        if (this.state === 'listening') {
            if (isSpeech) {
                // 音声検出 → 録音開始
                this.state = 'recording';
                this.audioChunks = [chunk];
                this.recordingStart = now;
                this.silenceStart = 0;
                console.log(`[MicrophoneCapture] Speech detected, recording started`);
                this.emit('stateChange', this.state);
                this.emit('vad', { type: 'speech_start', timestamp: now } as VADEvent);
            }
        } else if (this.state === 'recording') {
            this.audioChunks.push(chunk);

            // 最大録音時間チェック
            if (now - this.recordingStart > this.config.maxRecordingTime) {
                this.finishRecording();
                return;
            }

            if (isSpeech) {
                this.silenceStart = 0;
            } else {
                if (this.silenceStart === 0) {
                    this.silenceStart = now;
                } else if (now - this.silenceStart > this.config.silenceDuration) {
                    // 無音が継続 → 録音終了
                    this.finishRecording();
                }
            }
        }
    }

    /**
     * 録音終了と音声データ送出
     */
    private finishRecording(): void {
        const audioBuffer = Buffer.concat(this.audioChunks);
        const duration = (Date.now() - this.recordingStart) / 1000;

        console.log(`[MicrophoneCapture] Recording finished: ${duration.toFixed(2)}s, ${audioBuffer.length} bytes`);

        this.state = 'processing';
        this.emit('stateChange', this.state);
        this.emit('vad', { type: 'speech_end', timestamp: Date.now() } as VADEvent);
        this.emit('audioCapture', audioBuffer);

        // リスニング状態に戻る
        this.audioChunks = [];
        this.silenceStart = 0;
        this.state = 'listening';
        this.emit('stateChange', this.state);
    }

    /**
     * 音量計算（RMS）
     */
    private calculateVolume(chunk: Buffer): number {
        let sum = 0;
        const samples = chunk.length / 2;  // 16bit = 2bytes

        for (let i = 0; i < chunk.length; i += 2) {
            const sample = chunk.readInt16LE(i) / 32768;  // 正規化
            sum += sample * sample;
        }

        return Math.sqrt(sum / samples);
    }

    /**
     * 現在の状態取得
     */
    getState(): CaptureState {
        return this.state;
    }
}