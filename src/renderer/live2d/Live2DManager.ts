import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { ExpressionController, EmotionType } from './ExpressionController';

// Live2DModelをPIXIに登録
// Polyfill for pixi-live2d-display interaction with PixiJS v7+
// The library expects isInteractive function which was removed/changed in recent Pixi versions
const isInteractiveFunc = function (this: any) {
    return this.interactive;
};

// Patch DisplayObject prototype
if (typeof (PIXI.DisplayObject.prototype as any).isInteractive !== 'function') {
    (PIXI.DisplayObject.prototype as any).isInteractive = isInteractiveFunc;
}

// Patch Live2DModel prototype directly as well to be safe
// Note: We access the prototype of the imported class
(Live2DModel.prototype as any).isInteractive = isInteractiveFunc;

Live2DModel.registerTicker(PIXI.Ticker as any);

/**
 * Live2Dアバター管理クラス
 */
export class Live2DManager {
    private app: PIXI.Application | null = null;
    private model: Live2DModel | null = null;
    private canvas: HTMLCanvasElement;
    private isInitialized: boolean = false;

    // 表情コントローラー
    private expressionController: ExpressionController;

    // リップシンク用
    private mouthOpenValue: number = 0;
    private targetMouthOpen: number = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.expressionController = new ExpressionController();

        // パラメータ更新コールバックを設定
        this.expressionController.setParameterCallback((name, value) => {
            this.setParameter(name, value);
        });
    }

    /**
     * 初期化
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        this.app = new PIXI.Application({
            view: this.canvas,
            autoStart: true,
            backgroundAlpha: 0,  // 透明背景
            resizeTo: this.canvas.parentElement || undefined,
        });

        this.isInitialized = true;
        console.log('[Live2D] Initialized');
    }

    /**
     * モデルをロード
     */
    async loadModel(modelPath: string): Promise<void> {
        if (!this.app) {
            throw new Error('Live2DManager not initialized');
        }

        // 既存のモデルを削除
        if (this.model) {
            this.app.stage.removeChild(this.model as any);
            this.model.destroy();
            this.model = null;
        }

        console.log(`[Live2D] Loading model: ${modelPath}`);

        try {
            this.model = await Live2DModel.from(modelPath, {
                autoInteract: false,  // 自動インタラクションを無効化
            });

            // インタラクション設定 (Pixi v7+対応)
            (this.model as any).eventMode = 'static'; // or 'dynamic' or 'passive'
            (this.model as any).interactive = true; // Backward compatibility

            // 念のためインスタンスにもパッチ
            (this.model as any).isInteractive = isInteractiveFunc;

            // モデルのサイズと位置を調整
            this.adjustModelTransform();

            // ステージに追加
            this.app.stage.addChild(this.model as any);

            // アニメーションループを開始
            this.startAnimationLoop();

            console.log('[Live2D] Model loaded successfully');
        } catch (error) {
            console.error('[Live2D] Failed to load model:', error);
            throw error;
        }
    }

    /**
     * モデルの位置とサイズを調整
     */
    private adjustModelTransform(): void {
        if (!this.model || !this.app) return;

        const { width, height } = this.app.screen;

        // モデルをキャンバスの中央下部に配置
        this.model.anchor.set(0.5, 0.5);
        this.model.position.set(width / 2, height / 2);

        // スケールを調整
        // 初期状態のモデルサイズが不正確な場合があるため、制限を設ける
        // 0.8 / 0.9 は大きすぎる場合があるので 0.4 程度に下げる
        const scale = Math.min(
            width / this.model.width * 0.8,
            height / this.model.height * 0.9
        );
        this.model.scale.set(scale);

        console.log(`[Live2D] Adjusting transform. Screen: ${width}x${height}, Model: ${this.model.width}x${this.model.height}, Scale: ${scale}`);
    }

    /**
     * アニメーションループ
     */
    private startAnimationLoop(): void {
        if (!this.app) return;

        this.app.ticker.add(() => {
            // 表情コントローラの更新
            this.expressionController.update();
        });
    }

    /**
     * 感情を設定
     */
    setEmotion(emotion: EmotionType): void {
        this.expressionController.setEmotion(emotion);
    }
    /**
     * テキストから感情を自動検出して設定
     */
    setEmotionFromText(text: string): void {
        const emotion = this.expressionController.detectEmotionFromText(text);
        this.expressionController.setEmotion(emotion);
    }

    /**
     * 口の開き具合を設定
     */
    setMouthOpen(value: number): void {
        this.expressionController.setMouthOpen(value);
    }

    /**
     * 音量からリップシンクを更新
     */
    updateLipSyncFromVolume(volume: number): void {
        const lipValue = this.expressionController.calculateLipSyncFromVolume(volume);
        this.expressionController.setMouthOpen(lipValue);
    }

    /**
     * パラメータを直接設定
     */
    setParameter(name: string, value: number): void {
        if (!this.model) return;

        const coreModel = this.model.internalModel.coreModel as any;
        const paramIndex = coreModel.getParameterIndex(name);
        if (paramIndex >= 0) {
            coreModel.setParameterValueByIndex(paramIndex, value);
        }
    }

    /**
     * まばたき
     */
    blink(): void {
        if (!this.model) return;

        this.setParameter('ParamEyeLOpen', 0);
        this.setParameter('ParamEyeROpen', 0);

        setTimeout(() => {
            this.setParameter('ParamEyeLOpen', 1);
            this.setParameter('ParamEyeROpen', 1);
        }, 150);
    }

    /**
     * 視線を向ける
     */
    lookAt(x: number, y: number): void {
        if (!this.model) return;

        const normalizedX = (x - 0.5) * 2;
        const normalizedY = (y - 0.5) * 2;

        this.setParameter('ParamAngleX', normalizedX * 30);
        this.setParameter('ParamAngleY', normalizedY * 30);
        this.setParameter('ParamBodyAngleX', normalizedX * 10);
        this.setParameter('ParamEyeBallX', normalizedX);
        this.setParameter('ParamEyeBallY', normalizedY);
    }

    /**
     * リサイズ処理
     */
    resize(): void {
        if (!this.app) return;
        this.app.resize();
        this.adjustModelTransform();
    }

    /**
     * モデルがロードされているか？
     */
    hasModel(): boolean {
        return this.model !== null;
    }

    /**
     * 現在の感情を取得
     */
    getCurrentEmotion(): EmotionType {
        return this.expressionController.getCurrentEmotion();
    }

    /**
     * 破棄
     */
    destroy(): void {
        if (this.model) {
            this.model.destroy();
            this.model = null;
        }
        if (this.app) {
            this.app.destroy();
            this.app = null;
        }
        this.isInitialized = false;
    }
}