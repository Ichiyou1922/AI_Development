import { desktopCapturer, screen } from 'electron';
import { EventEmitter } from 'events';

/**
 * スクリーンショットキャプチャ
 */
export class ScreenshotCapture extends EventEmitter {
    private captureInterval: NodeJS.Timeout | null = null;
    private config = {
        enabled: true,
        intervalMs: 30 * 1000,  // 1分ごと
        quality: 90,                 // JPEG品質
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
            const width = primaryDisplay.size.width * primaryDisplay.scaleFactor;
            const height = primaryDisplay.size.height * primaryDisplay.scaleFactor;

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height },
            });

            if ( sources.length === 0) {
                console.warn('[ScreenshotCapture] No screen sources found');
                return null;
            }

            const source = sources[0];
            //JPEGバッファに変換
            return source.thumbnail.toJPEG(this.config.quality);
            
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