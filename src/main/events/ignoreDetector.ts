import { eventBus } from "./eventBus.js";
import { EventPriority, SystemEvent } from "./types.js";
import { VoiceDialogueController } from "../voice/voiceDialogueController.js";
import { MicrophoneCapture } from "../voice/microphoneCapture.js";

interface IgnoreConfig {
    ignoreThresholdSeconds: number;
    checkIntervalMs: number;
}

/**
 * イベント無視検出
 * イベントの無視状態を検出
 */
export class IgnoreDetector {
    private config: IgnoreConfig = {
        ignoreThresholdSeconds: 30, // 30秒
        checkIntervalMs: 30000, // 30秒ごとにチェック
    };

    private checkInterval: NodeJS.Timeout | null = null;
    private isIgnoring: boolean = false;
    private lastIgnoreTime: number = 0;

    /**
     * 検出を開始
     */

    start(config?: Partial<IgnoreConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }

        // 既存のインターバルをクリア
        this.stop();

        this.checkInterval = setInterval(() => {
            this.checkIgnoreState();
        }, this.config.checkIntervalMs);

        console.log(`[IgnoreDetector] Started (threshold: ${this.config.ignoreThresholdSeconds}s)`);
    }

    /**
     * 現在の無視状態を取得
     */
    getState(): { isIgnoring: boolean; ignoreTime: number } {
        return {
            isIgnoring: this.isIgnoring,
            ignoreTime: this.lastIgnoreTime,
        };
    }

    /** 
     * 無視状態をチェック
     */
    private checkIgnoreState(): void {
        const ignoreTime = Date.now() - this.lastIgnoreTime;
        if (ignoreTime >= this.config.ignoreThresholdSeconds && !this.isIgnoring) {
            this.isIgnoring = true;

            const event: SystemEvent = {
                type: 'user:ignoring',
                priority: EventPriority.LOW,
                timestamp: Date.now(),
                data: {
                    ignoreTime,
                }
            };
            eventBus.publish(event);

            console.log(`[IgnoreDetector] User is ignoring (${ignoreTime}s)`);
        } else if (ignoreTime < this.config.ignoreThresholdSeconds && this.isIgnoring) {
            this.isIgnoring = false;

            const event: SystemEvent = {
                type: 'user:ignoring',
                priority: EventPriority.LOW,
                timestamp: Date.now(),
                data: {
                    ignoreTime: this.lastIgnoreTime,
                },
            };
            eventBus.publish(event);

            console.log(`[IgnoreDetector] User is ignoring (${ignoreTime}s)`);
        }
    }

    /**
     * 現在の無視状態を取得
     */
    getIsIgnoring(): boolean {
        return this.isIgnoring;
    }



    /**
     * 検出を停止
     */
    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isIgnoring = false;
        console.log('[IgnoreDetector] Stopped');
    }
}

export const ignoreDetector = new IgnoreDetector();