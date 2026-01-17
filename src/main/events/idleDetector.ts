import { powerMonitor } from 'electron';
import { eventBus } from './eventBus.js';
import { EventPriority, SystemEvent } from './types.js';

interface IdleConfig {
    idleThresholdSeconds: number;  // アイドルとみなす秒数
    checkIntervalMs: number;       // チェック間隔
}

/**
 * アイドル検出
 * ユーザーの非アクティブ状態を検出
 */
export class IdleDetector {
    private config: IdleConfig = {
        idleThresholdSeconds: 60,  // 1分
        checkIntervalMs: 60000,     // 1分ごとにチェック
    };

    private checkInterval: NodeJS.Timeout | null = null;
    private isIdle: boolean = false;
    private lastIdleTime: number = 0;

    /**
     * 検出を開始
     */
    start(config?: Partial<IdleConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }

        // 既存のインターバルをクリア
        this.stop();

        this.checkInterval = setInterval(() => {
            this.checkIdleState();
        }, this.config.checkIntervalMs);

        console.log(`[IdleDetector] Started (threshold: ${this.config.idleThresholdSeconds}s)`);
    }

    /**
     * 検出を停止
     */
    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isIdle = false;
        console.log('[IdleDetector] Stopped');
    }

    /**
     * アイドル状態をチェック
     */
    private checkIdleState(): void {
        const idleTime = powerMonitor.getSystemIdleTime();

        if (idleTime >= this.config.idleThresholdSeconds && !this.isIdle) {
            // アイドル状態に移行
            this.isIdle = true;
            this.lastIdleTime = idleTime;

            const event: SystemEvent = {
                type: 'system:idle',
                priority: EventPriority.LOW,
                timestamp: Date.now(),
                data: {
                    idleTime,
                },
            };
            eventBus.publish(event);

            console.log(`[IdleDetector] User is idle (${idleTime}s)`);

        } else if (idleTime < this.config.idleThresholdSeconds && this.isIdle) {
            // アクティブ状態に復帰
            this.isIdle = false;

            const event: SystemEvent = {
                type: 'system:active',
                priority: EventPriority.NORMAL,
                timestamp: Date.now(),
                data: {
                    idleTime: this.lastIdleTime,
                },
            };
            eventBus.publish(event);

            console.log(`[IdleDetector] User is active again`);
        }
    }

    /**
     * 現在のアイドル状態を取得
     */
    getState(): { isIdle: boolean; idleTime: number } {
        return {
            isIdle: this.isIdle,
            idleTime: powerMonitor.getSystemIdleTime(),
        };
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<IdleConfig>): void {
        this.config = { ...this.config, ...config };
        console.log(`[IdleDetector] Config updated:`, this.config);
    }
}

export const idleDetector = new IdleDetector();
