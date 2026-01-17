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
 * 状況コンテキスト（LLMに渡す情報）
 */
export interface SituationContext {
    /** 現在時刻 */
    currentTime: string;
    /** 時間帯 */
    timeOfDay: 'late_night' | 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night';
    /** ユーザーの状態 */
    userState: 'active' | 'idle' | 'returned';
    /** アイドル時間（秒） */
    idleTimeSeconds?: number;
    /** 作業時間（分） */
    workDurationMinutes?: number;
    /** 画面情報（あれば） */
    screenInfo?: {
        app?: string;
        title?: string;
        url?: string;
    };
    /** トリガーとなったイベント */
    trigger: 'idle' | 'active' | 'timer' | 'screen_change';
    /** 追加メモ */
    note?: string;
}

/**
 * 自律行動コントローラ
 *
 * 固定のアクションタイプではなく、状況をLLMに伝えて
 * AI自身に判断させる方式。
 */
export class AutonomousController extends EventEmitter {
    private config: AutonomousConfig = getAutonomousConfig();

    private lastActionTime: number = 0;
    private dailyActionCount: number = 0;
    private lastResetDate: string = '';
    private workStartTime: number = Date.now();
    private isUserActive: boolean = true;
    private lastIdleTime: number = 0;
    private idleStartTimestamp: number = 0;

    // システムプロンプト（外部から注入）
    private systemPrompt: string = '';

    // LLMハンドラ（外部から注入）- システムプロンプト付きで呼び出す
    private llmHandler: ((systemPrompt: string, userMessage: string) => Promise<string>) | null = null;

    // Discordハンドラ（外部から注入）
    private discordHandler: ((message: string, options?: { channelId?: string }) => Promise<void>) | null = null;

    // 発話状態チェッカー（外部から注入）
    private isSpeakingChecker: (() => boolean) | null = null;

    // 自律発話中フラグ（競合防止用）
    private isAutonomousSpeaking: boolean = false;

    /**
     * 発話状態チェッカーを設定
     */
    setIsSpeakingChecker(checker: () => boolean): void {
        this.isSpeakingChecker = checker;
    }

    /**
     * 自律発話中かどうかを取得
     */
    isCurrentlySpeaking(): boolean {
        return this.isAutonomousSpeaking;
    }

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
     * システムプロンプトを設定
     */
    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
        console.log('[Autonomous] System prompt set');
    }

    /**
     * LLMハンドラを設定（新形式：システムプロンプト + ユーザーメッセージ）
     */
    setLLMHandler(handler: (systemPrompt: string, userMessage: string) => Promise<string>): void {
        this.llmHandler = handler;
    }

    /**
     * Discordハンドラを設定
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
    }    // ... (skip) ...

    /**
     * アイドル状態の処理
     */
    private handleIdle(event: AgentEvent): void {
        this.isUserActive = false;
        const idleTime = (event.data as any)?.idleTime || 0;
        this.lastIdleTime = idleTime;
        this.idleStartTimestamp = Date.now() - (idleTime * 1000); // 実際にアイドル開始した時刻を推計

        console.log(`[Autonomous] User became idle (idleTime: ${idleTime}s)`);

        // デバッグイベント発行
        this.emit('debug', {
            type: 'idle_detected',
            idleTime,
            timestamp: Date.now(),
        });

        // 長時間アイドルなら発話検討
        if (idleTime >= this.config.idleThresholdMs / 1000) {
            const context = this.buildContext('idle', { idleTimeSeconds: idleTime });
            this.trySpeak(context);
        }
    }

    /**
     * アクティブ復帰の処理
     */
    private handleActive(event: AgentEvent): void {
        const wasIdle = !this.isUserActive;
        this.isUserActive = true;

        if (wasIdle) {
            const idleTime = (event.data as any)?.idleTime || this.lastIdleTime;
            console.log(`[Autonomous] User returned after ${idleTime}s`);

            // デバッグイベント発行
            this.emit('debug', {
                type: 'active_detected',
                idleTime,
                wasIdle,
                timestamp: Date.now(),
            });

            // 長時間離席後の復帰
            if (idleTime > this.config.greetingIdleThresholdSeconds) {
                const context = this.buildContext('active', {
                    idleTimeSeconds: idleTime,
                    note: `ユーザーが${Math.floor(idleTime / 60)}分ぶりに戻ってきた`
                });
                this.trySpeak(context);
            }
        }
    }

    // ... (skip) ...

    /**
     * 定期チェックと行動
     */
    private async checkAndAct(): Promise<void> {
        if (!this.config.enabled) return;

        this.resetDailyCountIfNeeded();

        // ユーザーがアクティブでない場合の処理（長時間放置）
        if (!this.isUserActive) {
            const currentIdleTimeSeconds = Math.floor((Date.now() - this.idleStartTimestamp) / 1000);

            // アイドル状態が続いている場合、たまに話しかける
            // 例: 30分経過毎など (ここでは簡易的にチェック間隔で判定)
            // workDurationMs (デフォルト60分?) を再利用するか、または別の閾値を使う
            // ここでは workDurationMs / 2 (30分程度) 以上のアイドルで発話検討
            if (currentIdleTimeSeconds * 1000 >= this.config.workDurationMs / 2) {
                const context = this.buildContext('idle', {
                    idleTimeSeconds: currentIdleTimeSeconds,
                    note: 'ユーザーは長時間反応がない'
                });
                // トリガー名を変更して区別してもよいが、'idle'のままでも通じる
                // 文脈に「長時間」を含める
                this.trySpeak(context);
            }
            return;
        }

        // 作業時間チェック
        const workDuration = Date.now() - this.workStartTime;
        const workMinutes = Math.floor(workDuration / 60000);

        if (workDuration >= this.config.workDurationMs) {
            const context = this.buildContext('timer', {
                workDurationMinutes: workMinutes,
                note: `ユーザーは${workMinutes}分間作業を続けている`
            });
            this.trySpeak(context);
        }
    }

    /**
     * 画面変更時の処理（外部から呼び出し可能）
     */
    async handleScreenChange(screenInfo: { app?: string; title?: string; url?: string }): Promise<void> {
        if (!this.config.enabled) return;
        if (!this.canAct()) return;

        const context = this.buildContext('screen_change', { screenInfo });
        await this.trySpeak(context);
    }

    // ... (skip) ...

    /**
     * 状況コンテキストを構築
     */
    private buildContext(
        trigger: SituationContext['trigger'],
        extra?: Partial<SituationContext>
    ): SituationContext {
        const now = new Date();

        const hour = now.getHours();

        // 時間帯を判定
        let timeOfDay: SituationContext['timeOfDay'];
        if (hour >= 0 && hour < 5) {
            timeOfDay = 'late_night';
        } else if (hour >= 5 && hour < 8) {
            timeOfDay = 'early_morning';
        } else if (hour >= 8 && hour < 12) {
            timeOfDay = 'morning';
        } else if (hour >= 12 && hour < 17) {
            timeOfDay = 'afternoon';
        } else if (hour >= 17 && hour < 21) {
            timeOfDay = 'evening';
        } else {
            timeOfDay = 'night';
        }

        // ユーザー状態
        let userState: SituationContext['userState'] = this.isUserActive ? 'active' : 'idle';
        if (trigger === 'active') {
            userState = 'returned';
        }

        return {
            currentTime: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
            timeOfDay,
            userState,
            trigger,
            workDurationMinutes: Math.floor((Date.now() - this.workStartTime) / 60000),
            ...extra,
        };
    }

    /**
     * 発話を試みる
     */
    private async trySpeak(context: SituationContext): Promise<void> {
        console.log(`[Autonomous] trySpeak called with trigger: ${context.trigger}`);

        if (!this.canAct()) {
            const elapsed = Date.now() - this.lastActionTime;
            console.log(`[Autonomous] Speech suppressed (rate limit). Elapsed: ${elapsed}ms, Required: ${this.config.minIntervalMs}ms, DailyCount: ${this.dailyActionCount}/${this.config.maxDailyActions}`);
            return;
        }

        // 自律発話中フラグを立てる
        this.isAutonomousSpeaking = true;

        try {
            const message = await this.generateMessage(context);
            if (!message || message.trim() === '') {
                console.log('[Autonomous] No message generated (AI decided not to speak)');
                return;
            }

            // カウンタ更新
            this.lastActionTime = Date.now();
            this.dailyActionCount++;

            // 作業提案後は作業時間リセット
            if (context.trigger === 'timer') {
                this.workStartTime = Date.now();
            }

            console.log(`[Autonomous] Speaking: ${message.substring(0, 50)}...`);

            // Discordにも送信
            if (this.discordHandler) {
                try {
                    await this.discordHandler(message);
                    console.log('[Autonomous] Message sent to Discord');
                } catch (error) {
                    console.error('[Autonomous] Discord send failed:', error);
                }
            }
        } finally {
            // 必ずフラグを解除
            this.isAutonomousSpeaking = false;
        }
    }

    /**
     * アクション実行可能かチェック
     */
    private canAct(): boolean {
        if (!this.config.enabled) return false;

        // AIが喋っている場合はアクションしない
        if (this.isSpeakingChecker && this.isSpeakingChecker()) {
            return false;
        }

        if (this.dailyActionCount >= this.config.maxDailyActions) {
            return false;
        }

        const elapsed = Date.now() - this.lastActionTime;
        if (elapsed < this.config.minIntervalMs) {
            return false;
        }

        return true;
    }

    /**
     * メッセージを生成（システムプロンプト + 状況説明）
     */
    private async generateMessage(context: SituationContext): Promise<string | null> {
        if (!this.llmHandler || !this.systemPrompt) {
            console.log('[Autonomous] LLM handler or system prompt not set, using fallback');
            return this.getFallbackMessage(context);
        }

        // 状況説明を構築
        const situationMessage = this.buildSituationMessage(context);

        try {
            const response = await this.llmHandler(this.systemPrompt, situationMessage);
            console.log(`[Autonomous] LLM response: "${response}"`);

            // 「発言しない」という判断もありえる
            if (this.shouldSkipResponse(response)) {
                console.log(`[Autonomous] Response skipped (matched skip pattern)`);
                return null;
            }

            return response.trim();
        } catch (error) {
            console.error('[Autonomous] LLM generation failed:', error);
            return this.getFallbackMessage(context);
        }
    }

    /**
     * 状況説明メッセージを構築
     */
    private buildSituationMessage(context: SituationContext): string {
        const parts: string[] = [];

        parts.push(`【現在の状況】`);
        parts.push(`時刻: ${context.currentTime}`);

        // 時間帯の説明
        const timeDescriptions: Record<SituationContext['timeOfDay'], string> = {
            late_night: '深夜',
            early_morning: '早朝',
            morning: '午前中',
            afternoon: '午後',
            evening: '夕方',
            night: '夜',
        };
        parts.push(`時間帯: ${timeDescriptions[context.timeOfDay]}`);

        // トリガーに応じた説明
        switch (context.trigger) {
            case 'idle':
                parts.push(`状況: ユーザーが${context.idleTimeSeconds}秒間操作していない`);
                break;
            case 'active':
                parts.push(`状況: ユーザーが戻ってきた`);
                if (context.idleTimeSeconds) {
                    const minutes = Math.floor(context.idleTimeSeconds / 60);
                    parts.push(`離席時間: 約${minutes}分`);
                }
                break;
            case 'timer':
                parts.push(`状況: ユーザーは${context.workDurationMinutes}分間作業を続けている`);
                break;
            case 'screen_change':
                if (context.screenInfo) {
                    if (context.screenInfo.app) {
                        parts.push(`ユーザーが開いているアプリ: ${context.screenInfo.app}`);
                    }
                    if (context.screenInfo.title) {
                        parts.push(`ウィンドウタイトル: ${context.screenInfo.title}`);
                    }
                }
                break;
        }

        if (context.note) {
            parts.push(`補足: ${context.note}`);
        }

        parts.push('');
        parts.push('この状況であなたが言いたいことを短く（30文字以内）言ってください。');
        parts.push('何も言いたくなければ「（黙る）」と答えてください。');

        return parts.join('\n');
    }

    /**
     * 発言をスキップすべきレスポンスか判定
     * 完全一致のみでスキップ（「……暇」などの返答は許可）
     */
    private shouldSkipResponse(response: string): boolean {
        const trimmed = response.trim();

        // 完全一致でスキップするパターン
        const exactSkipPatterns = [
            '（黙る）',
            '(黙る)',
            '黙る',
            '...',
            '……',
            '',
        ];

        return exactSkipPatterns.includes(trimmed);
    }

    /**
     * フォールバックメッセージ
     */
    private getFallbackMessage(context: SituationContext): string {
        const messages: Record<SituationContext['trigger'], string[]> = {
            idle: [
                'ちょっと休憩したら？',
                'まだいる？',
                '……暇',
            ],
            active: [
                'おかえり',
                'あ、戻ってきた',
                'やっと戻ってきたね',
            ],
            timer: [
                '長くない？休憩しなよ',
                'ずっと作業してるね',
                '目、疲れてない？',
            ],
            screen_change: [
                'へー、何見てるの？',
                'ふーん',
                '面白そう',
            ],
        };

        const options = messages[context.trigger] || ['……'];
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
