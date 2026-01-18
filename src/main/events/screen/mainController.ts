import { screenshotCapture } from './screenshotCapture.js';
import { activeWindowMonitor, ScreenContext } from './activeWindowMonitor.js';
import { EventEmitter } from 'stream';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config/index.js';

// Gemmaへのリクエスト用
interface OllamaRequest {
    model: string;
    prompt: string;
    images?: string[]; // Base64 images
    stream?: boolean;
}

export class MainController {
    private isRunning = false;
    private readonly OUTPUT_DIR = './screenshots'; // Fixed typo

    private lastContext: ScreenContext | null = null;
    private lastReaction: string | null = null;
    private lastCheckTime: number = 0;

    // Handler for external reaction processing (e.g. Discord Voice)
    private reactionHandler: ((reaction: string) => Promise<void>) | null = null;



    constructor() {
        // 保存用ディレクトリ作成
        fs.mkdir(this.OUTPUT_DIR, { recursive: true }).catch(console.error);
    }

    start() {
        if (this.isRunning) return;
        console.log('[mainController] Capture start');

        // 各モジュールの開始
        activeWindowMonitor.start();
        this.isRunning = true;

        this.loop();
    }

    stop() {
        this.isRunning = false;
        console.log('[mainController] Capture stop');
        activeWindowMonitor.stop();
    }

    getStatus() {
        return {
            enabled: this.isRunning,
            lastContext: this.lastContext,
            lastReaction: this.lastReaction,
            lastCheckTime: this.lastCheckTime
        };
    }

    setReactionHandler(handler: (reaction: string) => Promise<void>) {
        this.reactionHandler = handler;
    }

    private async loop() {
        // 監視モジュールの起動を待機
        await new Promise(resolve => setTimeout(resolve, 2000));

        while (this.isRunning) {
            try {
                // 30%の確率でのみ実行 (30% probability to execute)
                // Math.random() < 0.3 で30%の確率で実行
                if (Math.random() > 0.3) {
                    await new Promise(resolve => setTimeout(resolve, config.screenRecognition.screenshotIntervalMs));
                    continue;
                }

                this.lastCheckTime = Date.now();
                // アクティブウィンドウ取得（取得できていない場合は少し待って再試行）
                let context = activeWindowMonitor.getCurrentContext();
                if (!context) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    context = activeWindowMonitor.getCurrentContext();
                }
                this.lastContext = context;

                const windowTitle = context?.details.siteName || context?.app || '';

                console.log(`[mainController] Capturing... (Active: ${windowTitle || 'Unknown'})`);

                // スクリーンショット撮影
                const imageBase64 = await screenshotCapture.captureAsBase64();

                if (imageBase64) {
                    // バックアップとしてファイル保存
                    const filename = path.join(this.OUTPUT_DIR, `capture_${Date.now()}.jpg`);
                    await fs.writeFile(filename, Buffer.from(imageBase64, 'base64'));

                    // gemmaに画像を送信してコメントをもらう
                    console.log('[mainController] Analyzing the picture');
                    const reaction = await this.askGemma(imageBase64, windowTitle);

                    this.lastReaction = reaction;
                    console.log(`[mainController] Reaction: ${reaction}`);


                    // Use external handler
                    if (this.reactionHandler) {
                        await this.reactionHandler(reaction).catch(e => console.error('[mainController] Reaction handler error:', e));
                    }

                    // 保存したファイルを削除（ディスク容量節約のため）
                    await fs.unlink(filename).catch(e => console.warn(`[mainController] Failed to delete temporary screenshot: ${filename}`, e));
                }

            } catch (err) {
                console.error('Error in loop:', err);
            }
            // 30秒待機
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
        console.log('[mainController] Finish loop');
    }


    // Ollama API経由でgemmaに送る
    private async askGemma(imageBase64: string, contextInfo: string): Promise<string> {
        // コンテキスト情報の構築
        const userActionDescription = contextInfo
            ? `「${contextInfo}」というウィンドウを開いて`
            : 'PCで';

        // 設定からプロンプトを取得してプレースホルダーを置換
        let prompt = config.prompts.screenReaction || '';
        prompt = prompt.replace('{{contextInfo}}', userActionDescription);

        try {
            const body: OllamaRequest = {
                model: config.llm.ollama.model,
                prompt: prompt,
                images: [imageBase64],
                stream: false
            };

            const response = await fetch(`${config.llm.ollama.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`Ollama API Error: ${response.statusText}`);
            }

            const data = await response.json();
            return data.response;
        } catch (error) {
            return `(Gemmaとの通信エラー: ${error})`;
        }
    }
}

export const mainController = new MainController()
