import { desktopCapturer, screen } from 'electron';
import { EventEmitter } from 'events';

/**
 * スクリーンショットキャプチャ
 */
export class ScreenshotCapture extends EventEmitter {
    private captureInterval: NodeJS.Timeout | null = null;
    private config = {
        enabled: true,
        intervalMs: 1 * 60 * 1000,  // 1分ごと
        maxWidth: 800,               // 最大幅
        quality: 60,                 // JPEG品質
    };

    /**
     * 定期キャプチャを開始
     */
    startPeriodicCapture(config?: Partial<typeof this.config>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }

        this.stopPeriodicCapture();

        if (!this.config.enabled) return;

        this.captureInterval = setInterval(() => {
            this.captureAndEmit();
        }, this.config.intervalMs);

        console.log(`[ScreenshotCapture] Started (interval: ${this.config.intervalMs}ms)`);
    }

    /**
     * 定期キャプチャを停止
     */
    stopPeriodicCapture(): void {
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }
        console.log('[ScreenshotCapture] Stopped');
    }

    /**
     * スクリーンショットを取得
     */
    async capture(): Promise<Buffer | null> {
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;

            // スクリーンソースを取得
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                    width: Math.min(width, this.config.maxWidth),
                    height: Math.min(height, Math.round(this.config.maxWidth * height / width)),
                },
            });

            if (sources.length === 0) {
                console.warn('[ScreenshotCapture] No screen sources found');
                return null;
            }

            // プライマリディスプレイのサムネイルを取得
            const thumbnail = sources[0].thumbnail;

            // JPEG形式でバッファに変換
            const buffer = thumbnail.toJPEG(this.config.quality);

            console.log(`[ScreenshotCapture] Captured ${buffer.length} bytes`);
            return buffer;
        } catch (error) {
            console.error('[ScreenshotCapture] Capture failed:', error);
            return null;
        }
    }

    /**
     * キャプチャしてイベント発火
     */
    private async captureAndEmit(): Promise<void> {
        const buffer = await this.capture();
        if (buffer) {
            this.emit('capture', {
                buffer,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Base64エンコード済みで取得
     */
    async captureAsBase64(): Promise<string | null> {
        const buffer = await this.capture();
        if (!buffer) return null;
        return buffer.toString('base64');
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<typeof this.config>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 現在の設定を取得
     */
    getConfig(): typeof this.config {
        return { ...this.config };
    }
}

export const screenshotCapture = new ScreenshotCapture();