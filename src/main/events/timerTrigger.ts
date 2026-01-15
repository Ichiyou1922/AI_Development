import { eventBus } from './eventBus.js';
import { EventPriority, TimerEvent } from './types.js';

interface TimerConfig {
    name: string;
    intervalMs: number;
    priority?: EventPriority;
    immediate?: boolean;  // 登録時に即座に発火するか
}

/**
 * タイマートリガー
 * 定期的にイベントを発火する
 */
export class TimerTrigger {
    private timers: Map<string, NodeJS.Timeout> = new Map();
    private configs: Map<string, TimerConfig> = new Map();

    /**
     * 定期タイマーを登録
     */
    register(config: TimerConfig): void {
        // 既存のタイマーがあれば停止
        this.unregister(config.name);
        
        this.configs.set(config.name, config);
        
        const fire = () => {
            const event: TimerEvent = {
                type: 'timer:interval',
                priority: config.priority ?? EventPriority.NORMAL,
                timestamp: Date.now(),
                data: {
                    name: config.name,
                    intervalMs: config.intervalMs,
                },
            };
            eventBus.publish(event);
        };
        
        // 即座に発火
        if (config.immediate) {
            fire();
        }
        
        // 定期実行
        const timer = setInterval(fire, config.intervalMs);
        this.timers.set(config.name, timer);
        
        console.log(`[TimerTrigger] Registered "${config.name}" (${config.intervalMs}ms)`);
    }

    /**
     * タイマーを解除
     */
    unregister(name: string): void {
        const timer = this.timers.get(name);
        if (timer) {
            clearInterval(timer);
            this.timers.delete(name);
            this.configs.delete(name);
            console.log(`[TimerTrigger] Unregistered "${name}"`);
        }
    }

    /**
     * すべてのタイマーを停止
     */
    stopAll(): void {
        for (const [name, timer] of this.timers) {
            clearInterval(timer);
            console.log(`[TimerTrigger] Stopped "${name}"`);
        }
        this.timers.clear();
        this.configs.clear();
    }

    /**
     * 登録済みタイマー一覧
     */
    list(): string[] {
        return Array.from(this.timers.keys());
    }

    /**
     * 特定タイマーの設定を取得
     */
    getConfig(name: string): TimerConfig | undefined {
        return this.configs.get(name);
    }
}

export const timerTrigger = new TimerTrigger();