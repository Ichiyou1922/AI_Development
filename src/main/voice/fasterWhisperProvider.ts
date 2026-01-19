import { STTProvider, TranscriptionResult } from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { FasterWhisperConfig } from '../config/index.js';
import { createWavBuffer } from '../utils/audioUtils.js';

/**
 * faster-whisper を使用した高速音声認識プロバイダ
 * GPU推論対応（CUDA）
 *
 * 要件:
 * - Python 3.8+
 * - faster-whisper (`pip install faster-whisper`)
 * - CUDA 11.x/12.x + cuDNN (GPU使用時)
 *
 * 設定の変更方法:
 * - config/config.json の stt.fasterWhisper セクションを編集
 * - または環境変数 WHISPER_SERVER_URL, WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE を設定
 */
export class FasterWhisperProvider implements STTProvider {
    private serverUrl: string;
    private serverProcess: ChildProcess | null = null;
    private ready: boolean = false;
    private useServer: boolean;
    private scriptPath: string;

    // 設定値（サーバー起動時に環境変数として渡す）
    private model: string;
    private device: string;
    private computeType: string;
    private serverStartupTimeoutMs: number;
    private healthCheckIntervalMs: number;
    private transcriptionTimeoutMs: number;

    /**
     * @param config - 設定オブジェクト（configLoader から取得）
     * @param options - 追加オプション
     *
     * 使用例:
     * ```typescript
     * import { config } from '../config/index.js';
     * const provider = new FasterWhisperProvider(config.stt.fasterWhisper);
     * ```
     */
    constructor(
        config?: Partial<FasterWhisperConfig>,
        options?: {
            useServer?: boolean;
            scriptPath?: string;
        }
    ) {
        // 設定値の読み込み（デフォルト値付き）
        this.serverUrl = config?.serverUrl ?? 'http://127.0.0.1:5001';
        this.model = config?.model ?? 'small';
        this.device = config?.device ?? 'cuda';
        this.computeType = config?.computeType ?? 'float16';
        this.serverStartupTimeoutMs = config?.serverStartupTimeoutMs ?? 300000;
        this.healthCheckIntervalMs = config?.healthCheckIntervalMs ?? 1000;
        this.transcriptionTimeoutMs = config?.transcriptionTimeoutMs ?? 30000;

        this.useServer = options?.useServer ?? true;

        // スクリプトパスの決定
        if (options?.scriptPath) {
            this.scriptPath = options.scriptPath;
        } else {
            this.scriptPath = path.join(process.cwd(), 'scripts', 'whisper_server.py');
        }
    }

    async initialize(): Promise<void> {
        console.log('[FasterWhisper] Initializing...');
        console.log(`[FasterWhisper] Script path: ${this.scriptPath}`);

        if (this.useServer) {
            // サーバーが既に起動しているか確認
            const isRunning = await this.checkServer();
            if (isRunning) {
                console.log('[FasterWhisper] Server already running');
                this.ready = true;
                return;
            }

            // スクリプト存在確認
            try {
                await fs.access(this.scriptPath);
            } catch {
                console.error(`[FasterWhisper] Server script not found: ${this.scriptPath}`);
                throw new Error(`Whisper server script not found: ${this.scriptPath}\nPlease create scripts/whisper_server.py`);
            }

            // サーバーを起動
            await this.startServer();
        }

        this.ready = true;
        console.log('[FasterWhisper] Ready');
    }

    /**
     * サーバーの起動確認
     */
    private async checkServer(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000),
            });

            if (response.ok) {
                const data = await response.json() as { status: string; model: string; device: string };
                console.log(`[FasterWhisper] Server health: model=${data.model}, device=${data.device}`);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Pythonサーバーを起動
     */
    private async startServer(): Promise<void> {
        console.log('[FasterWhisper] Starting server...');

        // Python実行可能ファイルを探す
        const pythonCandidates = [
            path.join(process.cwd(), '.venv', 'bin', 'python3'),
            path.join(process.cwd(), '.venv', 'bin', 'python'),
            path.join(process.cwd(), 'venv', 'bin', 'python3'),
            path.join(process.cwd(), 'venv', 'bin', 'python'),
            'python3',
            'python'
        ];
        let pythonPath = 'python3';

        for (const candidate of pythonCandidates) {
            try {
                const { execSync } = await import('child_process');
                execSync(`${candidate} --version`, { stdio: 'ignore' });
                pythonPath = candidate;
                break;
            } catch {
                continue;
            }
        }

        // 環境変数を設定（設定値を優先、環境変数でも上書き可能）
        const env = {
            ...process.env,
            WHISPER_MODEL: process.env.WHISPER_MODEL ?? this.model,
            WHISPER_DEVICE: process.env.WHISPER_DEVICE ?? this.device,
            WHISPER_COMPUTE_TYPE: process.env.WHISPER_COMPUTE_TYPE ?? this.computeType,
        };

        this.serverProcess = spawn(pythonPath, [this.scriptPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        this.serverProcess.stdout?.on('data', (data) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                console.log(`[whisper-server] ${line}`);
            }
        });

        this.serverProcess.stderr?.on('data', (data) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                // Pythonの一部ライブラリはstderrに情報を出力する
                if (line.includes('Error') || line.includes('error')) {
                    console.error(`[whisper-server] ${line}`);
                } else {
                    console.log(`[whisper-server] ${line}`);
                }
            }
        });

        this.serverProcess.on('error', (error) => {
            console.error('[FasterWhisper] Server process error:', error);
        });

        this.serverProcess.on('exit', (code, signal) => {
            console.log(`[FasterWhisper] Server exited (code=${code}, signal=${signal})`);
            this.serverProcess = null;
            this.ready = false;
        });

        // サーバー起動待ち（モデルロードに時間がかかる）
        // 初回はモデルのダウンロードがあるため時間がかかる
        const maxWait = this.serverStartupTimeoutMs;
        const interval = this.healthCheckIntervalMs;
        let waited = 0;

        while (waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, interval));
            waited += interval;

            if (await this.checkServer()) {
                console.log(`[FasterWhisper] Server started after ${waited}ms`);
                return;
            }

            // プロセスが終了していたらエラー
            if (!this.serverProcess || this.serverProcess.exitCode !== null) {
                throw new Error('Whisper server process terminated unexpectedly');
            }

            if (waited % 10000 === 0) {
                console.log(`[FasterWhisper] Still waiting for server... (${waited / 1000}s)`);
            }
        }

        throw new Error(`Whisper server failed to start within ${maxWait / 1000}s`);
    }

    /**
     * 音声認識を実行
     */
    async transcribe(audioBuffer: Buffer, sampleRate: number): Promise<TranscriptionResult> {
        if (!this.ready) {
            throw new Error('FasterWhisperProvider not initialized');
        }

        // WAVヘッダーを付与
        const wavBuffer = createWavBuffer(audioBuffer, sampleRate);

        console.log(`[FasterWhisper] Transcribing ${wavBuffer.length} bytes (${(audioBuffer.length / 2 / sampleRate * 1000).toFixed(0)}ms at ${sampleRate}Hz)`);

        return await this.transcribeViaServer(wavBuffer);
    }

    /**
     * HTTPサーバー経由で認識
     */
    private async transcribeViaServer(wavBuffer: Buffer): Promise<TranscriptionResult> {
        const startTime = Date.now();

        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'audio/wav',
                },
                body: wavBuffer as any,
                signal: AbortSignal.timeout(this.transcriptionTimeoutMs),
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json() as {
                success: boolean;
                text?: string;
                language?: string;
                language_probability?: number;
                duration?: number;
                error?: string;
            };

            const elapsed = Date.now() - startTime;
            console.log(`[FasterWhisper] Transcribed in ${elapsed}ms: "${result.text?.substring(0, 50) ?? ''}..."`);

            if (!result.success) {
                throw new Error(result.error || 'Transcription failed');
            }

            return {
                text: result.text || '',
                language: result.language,
                duration: result.duration,
                confidence: result.language_probability,
            };
        } catch (error) {
            if (error instanceof Error && error.name === 'TimeoutError') {
                throw new Error(`Transcription timeout (${this.transcriptionTimeoutMs / 1000}s)`);
            }
            throw error;
        }
    }

    /**
     * サーバーを停止
     */
    async shutdown(): Promise<void> {
        if (this.serverProcess) {
            console.log('[FasterWhisper] Shutting down server...');
            this.serverProcess.kill('SIGTERM');

            // 5秒待っても終了しなければSIGKILL
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.serverProcess) {
                        this.serverProcess.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);

                if (this.serverProcess) {
                    this.serverProcess.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                } else {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            this.serverProcess = null;
        }
        this.ready = false;
        console.log('[FasterWhisper] Shutdown complete');
    }

    isReady(): boolean {
        return this.ready;
    }

    /**
     * 使用中のデバイス情報を取得
     */
    async getServerInfo(): Promise<{ model: string; device: string; compute_type: string } | null> {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000),
            });

            if (response.ok) {
                return await response.json() as { model: string; device: string; compute_type: string };
            }
        } catch {
            // ignore
        }
        return null;
    }
}