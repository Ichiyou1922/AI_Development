import { STTProvider, TranscriptionResult } from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { app } from 'electron';
import { spawn } from 'child_process';

/**
 * Whisper.cpp を使用した音声認識プロバイダ
 * whisper-node が使えない場合のフォールバックとして
 * whisper.cpp を直接呼び出す実装
 */
export class WhisperProvider implements STTProvider {
    private modelPath: string;
    private whisperPath: string;
    private ready: boolean = false;
    private modelName: string;

    constructor(modelName: string = 'base') {
        this.modelName = modelName;
        this.modelPath = path.join(app.getPath('userData'), 'whisper-models', `ggml-${modelName}.bin`);
        // whisper.cpp の実行ファイルパス（後でセットアップ）
        this.whisperPath = path.join(app.getPath('userData'), 'whisper-cpp', 'whisper-cli');
    }

    async initialize(): Promise<void> {
        console.log(`[WhisperProvider] Initializing with model: ${this.modelName}`);

        // モデルの存在確認
        try {
            await fs.access(this.modelPath);
            console.log(`[WhisperProvider] Model found at ${this.modelPath}`);
        } catch {
            console.log(`[WhisperProvider] Model not found. Please download the model.`);
            console.log(`[WhisperProvider] Download from: https://huggingface.co/ggerganov/whisper.cpp/tree/main`);
            console.log(`[WhisperProvider] Place at: ${this.modelPath}`);
            throw new Error(`Whisper model not found: ${this.modelPath}`);
        }

        this.ready = true;
        console.log(`[WhisperProvider] Ready`);
    }

    async transcribe(audioBuffer: Buffer, sampleRate: number): Promise<TranscriptionResult> {
        if (!this.ready) {
            throw new Error('WhisperProvider not initialized');
        }

        // 一時ファイルに音声を保存
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `whisper_input_${Date.now()}.wav`);

        try {
            // WAVヘッダーを付けて保存
            const wavBuffer = this.createWavBuffer(audioBuffer, sampleRate);
            await fs.writeFile(tempFile, wavBuffer);

            // whisper.cpp を実行
            const result = await this.runWhisper(tempFile);

            return {
                text: result.trim(),
                language: 'ja',
            };
        } finally {
            // 一時ファイルを削除
            try {
                await fs.unlink(tempFile);
            } catch {
                // 無視
            }
        }
    }

    private async runWhisper(audioFile: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = [
                '--model', this.modelPath,
                '--file', audioFile,
                '--language', 'ja',           // 日本語
                '--no-timestamps',                // タイムスタンプなし
                '--output-txt',
            ];

            console.log(`[WhisperProvider] Running: ${this.whisperPath} ${args.join(' ')}`);

            const proc = spawn(this.whisperPath, args);

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                console.log(`[WhisperProvider] Exit code: ${code}`);
                console.log(`[WhisperProvider] Full stdout: ${stdout}`);
                console.log(`[WhisperProvider] Full stderr: ${stderr}`);
                if (code === 0) {
                    resolve(stdout || stderr);
                } else {
                    reject(new Error(`Whisper failed with code ${code}: ${stderr || stdout}`));
                }
            });

            proc.on('error', (error) => {
                reject(error);
            });
        });
    }

    private createWavBuffer(audioData: Buffer, sampleRate: number): Buffer {
        const channels = 1;
        const bitDepth = 16;
        const byteRate = sampleRate * channels * (bitDepth / 8);
        const blockAlign = channels * (bitDepth / 8);
        const dataSize = audioData.length;
        const headerSize = 44;

        const buffer = Buffer.alloc(headerSize + dataSize);

        // RIFF header
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);

        // fmt chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);           // chunk size
        buffer.writeUInt16LE(1, 20);            // PCM format
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bitDepth, 34);

        // data chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        audioData.copy(buffer, 44);

        return buffer;
    }

    isReady(): boolean {
        return this.ready;
    }
}