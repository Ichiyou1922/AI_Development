import { EventEmitter } from 'events';
import {
    eventBus,
    AgentEvent,
    EventPriority,
} from '../events/index.js';
import {
    AutonomousConfig,
    getAutonomousConfig,
} from '../config/index.js';

/**
 * 自律行動の種類
 */
export type AutonomousActionType =
    | 'break_suggestion'    // 休憩提案
    | 'greeting'            // 挨拶
    | 'encouragement'       // 励まし
    | 'reminder'            // リマインダー
    | 'weather_info'        // 天気情報
    | 'tip';                // 豆知識

/**
 * 自律行動コントローラ
 */
export class AutonomousController extends EventEmitter {
    private config: AutonomousConfig = getAutonomousConfig();

    private lastActionTime: number = 0;
    private dailyActionCount: number = 0;
    private lastResetDate: string = '';
    private workStartTime: number = Date.now();
    private isUserActive: boolean = true;
    private pendingAction: AutonomousActionType | null = null;

    // LLMハンドラ（外部から注入）
    private llmHandler: ((prompt: string) => Promise<string>) | null = null;

    // Discordハンドラ（外部から注入）
    private discordHandler: ((message: string, options?: { channelId?: string }) => Promise<void>) | null = null;

    constructor() {
        super();
        this.setupEventListeners();
        this.resetDailyCountIfNeeded();
    }

    /**
     * イベントリスナーを設定
     */
    private setupEventListeners(): void {
        // アイドル検出
        eventBus.register('system:idle', (event) => {
            this.handleIdle(event);
        }, EventPriority.NORMAL);

        // アクティブ復帰
        eventBus.register('system:active', (event) => {
            this.handleActive(event);
        }, EventPriority.NORMAL);

        // 定期チェック
        eventBus.register('timer:interval', (event) => {
            if (event.type === 'timer:interval' && event.data?.name === 'autonomous-check') {
                this.checkAndAct();
            }
        }, EventPriority.NORMAL);
    }

    /**
     * LLMハンドラを設定
     */
    setLLMHandler(handler: (prompt: string) => Promise<string>): void {
        this.llmHandler = handler;
    }

    /**
     * Discordハンドラを設定
     * 自律発話をDiscordに送信するための関数を外部から注入
     */
    setDiscordHandler(handler: (message: string, options?: { channelId?: string }) => Promise<void>): void {
        this.discordHandler = handler;
        console.log('[Autonomous] Discord handler set');
    }

    /**
     * 有効/無効を切り替え
     */
    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
        console.log(`[Autonomous] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<AutonomousConfig>): void {
        this.config = { ...this.config, ...config };
        console.log('[Autonomous] Config updated:', this.config);
    }

    /**
     * アイドル状態の処理
     */
    private handleIdle(event: AgentEvent): void {
        this.isUserActive = false;
        const idleTime = (event.data as any)?.idleTime || 0;
        console.log(`[Autonomous] User became idle (idleTime: ${idleTime}s, threshold: ${this.config.idleThresholdMs / 1000}s)`);

        // デバッグイベント発行
        this.emit('debug', {
            type: 'idle_detected',
            idleTime,
            threshold: this.config.idleThresholdMs / 1000,
            timestamp: Date.now(),
        });

        // アイドル検知時に声掛け
        if (idleTime >= this.config.idleThresholdMs / 1000) {
            this.scheduleAction('break_suggestion');
        }
    }

    /**
     * アクティブ復帰の処理
     */
    private handleActive(event: AgentEvent): void {
        const wasIdle = !this.isUserActive;
        this.isUserActive = true;

        if (wasIdle) {
            const idleTime = (event.data as any)?.idleTime || 0;
            console.log(`[Autonomous] User returned after ${idleTime}s`);

            // デバッグイベント発行
            this.emit('debug', {
                type: 'active_detected',
                idleTime,
                wasIdle,
                timestamp: Date.now(),
            });

            // 長時間離席後の復帰時に挨拶
            if (idleTime > this.config.greetingIdleThresholdSeconds) {
                this.scheduleAction('greeting');
            }
        }
    }

    /**
     * 定期チェックと行動
     */
    private async checkAndAct(): Promise<void> {
        if (!this.config.enabled) return;
        if (!this.isUserActive) return;

        this.resetDailyCountIfNeeded();

        // 作業時間チェック
        const workDuration = Date.now() - this.workStartTime;
        if (workDuration >= this.config.workDurationMs) {
            this.scheduleAction('break_suggestion');
        }
    }

    /**
     * アクションをスケジュール
     */
    private scheduleAction(action: AutonomousActionType): void {
        if (!this.canAct()) {
            console.log(`[Autonomous] Action "${action}" suppressed (rate limit)`);
            return;
        }

        this.pendingAction = action;
        this.executeAction(action);
    }

    /**
     * アクション実行可能かチェック
     */
    private canAct(): boolean {
        // 無効なら不可
        if (!this.config.enabled) return false;

        // 1日の上限チェック
        if (this.dailyActionCount >= this.config.maxDailyActions) {
            return false;
        }

        // 最小間隔チェック
        const elapsed = Date.now() - this.lastActionTime;
        if (elapsed < this.config.minIntervalMs) {
            return false;
        }

        return true;
    }

    /**
     * アクションを実行
     */
    private async executeAction(action: AutonomousActionType): Promise<void> {
        const message = await this.generateMessage(action);
        if (!message) return;

        // カウンタ更新
        this.lastActionTime = Date.now();
        this.dailyActionCount++;

        // 休憩提案後は作業時間リセット
        if (action === 'break_suggestion') {
            this.workStartTime = Date.now();
        }

        console.log(`[Autonomous] Executing "${action}": ${message.substring(0, 50)}...`);

        // イベントを発行（ローカルUI用）
        this.emit('action', {
            type: action,
            message,
            timestamp: Date.now(),
        });

        // Discordにも送信
        if (this.discordHandler) {
            try {
                await this.discordHandler(message);
                console.log(`[Autonomous] Message sent to Discord`);
            } catch (error) {
                console.error('[Autonomous] Discord send failed:', error);
            }
        }

        this.pendingAction = null;
    }

    /**
     * メッセージを生成
     */
    private async generateMessage(action: AutonomousActionType): Promise<string | null> {
        const prompts: Record<AutonomousActionType, string> = {
            break_suggestion: `ユーザーが長時間作業しています。休憩を提案する短いメッセージを生成してください。
親しみやすく、押し付けがましくない口調で。50文字以内で。`,
            
            greeting: `ユーザーが戻ってきました。おかえりなさいの挨拶を生成してください。
親しみやすい口調で。30文字以内で。`,
            
            encouragement: `ユーザーを励ます短いメッセージを生成してください。
元気が出るような口調で。40文字以内で。`,
            
            reminder: `優しいリマインダーメッセージを生成してください。30文字以内で。`,
            
            weather_info: `天気に関する短い一言を生成してください。30文字以内で。`,
            
            tip: `プログラミングや生産性に関する豆知識を一つ教えてください。50文字以内で。`,
        };

        const prompt = prompts[action];
        if (!prompt) return null;

        // LLMがあれば使用
        if (this.llmHandler) {
            try {
                return await this.llmHandler(prompt);
            } catch (error) {
                console.error('[Autonomous] LLM generation failed:', error);
            }
        }

        // フォールバック：定型文
        return this.getFallbackMessage(action);
    }

    /**
     * フォールバックメッセージ
     */
    private getFallbackMessage(action: AutonomousActionType): string {
        const messages: Record<AutonomousActionType, string[]> = {
            break_suggestion: [
                'そろそろ休憩しませんか？',
                '少し休憩を取りましょう！',
                '目を休める時間ですよ',
                'ストレッチはいかがですか？',
            ],
            greeting: [
                'おかえりなさい！',
                'お戻りですね！',
                'また会えて嬉しいです',
            ],
            encouragement: [
                '頑張ってますね！',
                'いい調子です！',
                '素敵な作業ぶりです',
            ],
            reminder: [
                '忘れていることはありませんか？',
                '何かお手伝いできることはありますか？',
            ],
            weather_info: [
                '今日もいい天気ですね',
                '体調に気をつけてくださいね',
            ],
            tip: [
                '小さな一歩が大きな成果につながります',
                '整理整頓は生産性の基本です',
            ],
        };

        const options = messages[action] || ['こんにちは'];
        return options[Math.floor(Math.random() * options.length)];
    }

    /**
     * 日次カウントをリセット
     */
    private resetDailyCountIfNeeded(): void {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.dailyActionCount = 0;
            this.lastResetDate = today;
            console.log('[Autonomous] Daily count reset');
        }
    }

    /**
     * 作業開始をマーク
     */
    markWorkStart(): void {
        this.workStartTime = Date.now();
        console.log('[Autonomous] Work start marked');
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        enabled: boolean;
        dailyActionCount: number;
        maxDailyActions: number;
        workDurationMs: number;
        lastActionTime: number;
        isUserActive: boolean;
    } {
        return {
            enabled: this.config.enabled,
            dailyActionCount: this.dailyActionCount,
            maxDailyActions: this.config.maxDailyActions,
            workDurationMs: Date.now() - this.workStartTime,
            lastActionTime: this.lastActionTime,
            isUserActive: this.isUserActive,
        };
    }
}

export const autonomousController = new AutonomousController();