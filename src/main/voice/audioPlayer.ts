import { EventEmitter } from 'events';
import { PlaybackState } from './types.js';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * 音声再生クラス
 * aplay（Linux）を使用してWAVを再生
 */
export class AudioPlayer extends EventEmitter {
    private state: PlaybackState = 'idle';
    private currentProcess: ChildProcess | null = null;

    constructor() {
        super();
    }

    /**
     * WAVバッファを再生
     */
    /**
     * WAVバッファを再生
     */
    async play(wavBuffer: Buffer): Promise<void> {
        if (this.state === 'playing') {
            this.stop();
        }

        // 一時ファイルに保存
        const tempFile = path.join(os.tmpdir(), `tts_output_${Date.now()}.wav`);

        try {
            await fs.writeFile(tempFile, wavBuffer);

            this.state = 'playing';
            this.emit('stateChange', this.state);

            await this.playFile(tempFile);

            this.state = 'idle';
            this.emit('stateChange', this.state);
        } finally {
            // 一時ファイル削除
            try {
                await fs.unlink(tempFile);
            } catch {
                // 無視
            }
        }
    }

    /**
     * ファイルを再生
     */
    private playFile(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Linuxの場合はaplay，macOSの場合はafplay
            const command = process.platform === 'darwin' ? 'afplay' : 'aplay';

            this.currentProcess = spawn(command, [filePath]);

            this.currentProcess.on('close', (code) => {
                this.currentProcess = null;
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Playback failed with code ${code}`));
                }
            });

            this.currentProcess.on('error', (error) => {
                this.currentProcess = null;
                reject(error);
            });
        });
    }

    /**
     * 再生停止
     */
    stop(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
        }
        this.state = 'idle';
        this.emit('stateChange', this.state);
    }

    /**
     * 状態取得
     */
    getState(): PlaybackState {
        return this.state;
    }
}