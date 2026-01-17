import { EventEmitter } from 'events';
import { activeWindowMonitor, ScreenContext, WindowInfo } from './activeWindowMonitor.js';
import { screenshotCapture } from './screenshotCapture.js';

/**
 * 画面認識結果
 */
export interface ScreenRecognitionResult {
    context: ScreenContext;
    analysis?: string;
    timestamp: number;
}

/**
 * 画面認識コントローラ
 */
export class ScreenRecognitionController extends EventEmitter {
    private config = {
        enabled: true,
        windowMonitorEnabled: true,
        screenshotEnabled: false,  // デフォルトは無効（プライバシー考慮）
        screenshotIntervalMs: 5 * 60 * 1000,
        reactToWindowChange: true,
    };

    // LLMハンドラ（外部から注入）
    private llmVisionHandler: ((imageBase64: string, prompt: string) => Promise<string>) | null = null;
    private llmTextHandler: ((prompt: string) => Promise<string>) | null = null;

    // 最後のコンテキスト
    private lastContext: ScreenContext | null = null;

    // 反応の抑制用
    private lastReactionTime: number = 0;
    private readonly minReactionIntervalMs = 60 * 1000;  // 1分

    constructor() {
        super();
        this.setupEventListeners();
    }

    /**
     * イベントリスナーを設定
     */
    private setupEventListeners(): void {
        // ウィンドウ変更イベント
        activeWindowMonitor.on('windowChange', async (data: {
            previous: WindowInfo | null;
            current: WindowInfo;
            context: ScreenContext;
        }) => {
            this.lastContext = data.context;
            this.emit('contextChange', data.context);

            if (this.config.reactToWindowChange) {
                await this.maybeReact(data.context);
            }
        });

        // スクリーンショットイベント
        screenshotCapture.on('capture', async (data: { buffer: Buffer; timestamp: number }) => {
            if (this.llmVisionHandler) {
                const base64 = data.buffer.toString('base64');
                await this.analyzeScreenshot(base64);
            }
        });
    }

    /**
     * 開始
     */
    start(config?: Partial<typeof this.config>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }

        if (!this.config.enabled) return;

        if (this.config.windowMonitorEnabled) {
            activeWindowMonitor.start();
        }

        if (this.config.screenshotEnabled) {
            screenshotCapture.startPeriodicCapture({
                intervalMs: this.config.screenshotIntervalMs,
            });
        }

        console.log('[ScreenRecognition] Started');
    }

    /**
     * 停止
     */
    stop(): void {
        activeWindowMonitor.stop();
        screenshotCapture.stopPeriodicCapture();
        console.log('[ScreenRecognition] Stopped');
    }

    /**
     * LLM Visionハンドラを設定
     */
    setLLMVisionHandler(handler: (imageBase64: string, prompt: string) => Promise<string>): void {
        this.llmVisionHandler = handler;
    }

    /**
     * LLM Textハンドラを設定
     */
    setLLMTextHandler(handler: (prompt: string) => Promise<string>): void {
        this.llmTextHandler = handler;
    }

    /**
     * コンテキストに基づいてリアクション
     */
    private async maybeReact(context: ScreenContext): Promise<void> {
        // 抑制チェック
        const now = Date.now();
        if (now - this.lastReactionTime < this.minReactionIntervalMs) {
            return;
        }

        // リアクションが必要か判定
        const reaction = this.shouldReact(context);
        if (!reaction) return;

        this.lastReactionTime = now;

        // LLMで自然なコメントを生成
        let message = reaction.defaultMessage;
        if (this.llmTextHandler) {
            try {
                message = await this.llmTextHandler(reaction.prompt);
            } catch (error) {
                console.error('[ScreenRecognition] LLM reaction failed:', error);
            }
        }

        this.emit('reaction', {
            type: reaction.type,
            context,
            message,
            timestamp: now,
        });
    }

    /**
     * リアクションが必要か判定
     */
    private shouldReact(context: ScreenContext): {
        type: string;
        prompt: string;
        defaultMessage: string;
    } | null {
        const { category, details, app } = context;

        // YouTubeを見始めた
        if (details.videoTitle && details.siteName === 'YouTube') {
            return {
                type: 'youtube_detected',
                prompt: `ユーザーがYouTubeで「${details.videoTitle}」を見始めました。プロンプトの設定に基づいた反応をしてください。`,
                defaultMessage: `「${details.videoTitle.substring(0, 20)}...」面白そう！`,
            };
        }

        // ゲームを起動した
        if (category === 'game') {
            return {
                type: 'game_detected',
                prompt: `ユーザーがゲーム（${app}）を起動しました。プロンプトの設定に基づいた反応をしてください。`,
                defaultMessage: 'ゲーム楽しんでね！',
            };
        }

        // 特定のサイトを閲覧
        if (details.siteName) {
            const interestingSites = ['GitHub', 'Stack Overflow', 'Qiita', 'Zenn'];
            if (interestingSites.some(s => details.siteName?.includes(s))) {
                return {
                    type: 'dev_site_detected',
                    prompt: `ユーザーが${details.siteName}を見ています。プロンプトの設定に基づいた反応をしてください。`,
                    defaultMessage: `${details.siteName}で調べ物？頑張ってるね！`,
                };
            }
        }

        return null;
    }

    /**
     * スクリーンショットを解析
     */
    private async analyzeScreenshot(imageBase64: string): Promise<void> {
        if (!this.llmVisionHandler) return;

        try {
            const prompt = `この画面のスクリーンショットを見て、ユーザーが何をしているか簡潔に説明してください。プライバシーに配慮し、具体的な個人情報は含めないでください。
            プロンプトの設定に基づいた反応をしてください。`;

            const analysis = await this.llmVisionHandler(imageBase64, prompt);

            this.emit('analysis', {
                analysis,
                context: this.lastContext,
                timestamp: Date.now(),
            });
        } catch (error) {
            console.error('[ScreenRecognition] Screenshot analysis failed:', error);
        }
    }

    /**
     * 現在のコンテキストを取得
     */
    getCurrentContext(): ScreenContext | null {
        return this.lastContext;
    }

    /**
     * 手動でスクリーンショット解析を実行
     */
    async analyzeNow(): Promise<string | null> {
        const base64 = await screenshotCapture.captureAsBase64();
        if (!base64 || !this.llmVisionHandler) return null;

        const prompt = `この画面を見て、ユーザーの作業内容を簡潔に説明してください。プライバシーに配慮し、具体的な個人情報は含めないでください。
        プロンプトの設定に基づいた反応をしてください。`;
        return await this.llmVisionHandler(base64, prompt);
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<typeof this.config>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        enabled: boolean;
        windowMonitorEnabled: boolean;
        screenshotEnabled: boolean;
        lastContext: ScreenContext | null;
        lastReactionTime: number;
    } {
        return {
            enabled: this.config.enabled,
            windowMonitorEnabled: this.config.windowMonitorEnabled,
            screenshotEnabled: this.config.screenshotEnabled,
            lastContext: this.lastContext,
            lastReactionTime: this.lastReactionTime,
        };
    }
}

export const screenRecognitionController = new ScreenRecognitionController();