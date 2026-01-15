/**
 * 感情タイプ
 */
export type EmotionType = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking';

/**
 * 表情パラメータセット
 */
interface ExpressionParams {
    browLY: number;      // 左眉
    browRY: number;      // 右眉
    eyeLOpen: number;    // 左目開閉
    eyeROpen: number;    // 右目開閉
    eyeLSmile: number;   // 左目笑い
    eyeRSmile: number;   // 右目笑い
    mouthForm: number;   // 口の形
}

/**
 * 感情ごとのパラメータ定義
 */
const EMOTION_PRESETS: Record<EmotionType, ExpressionParams> = {
    neutral: {
        browLY: 0, browRY: 0,
        eyeLOpen: 1, eyeROpen: 1,
        eyeLSmile: 0, eyeRSmile: 0,
        mouthForm: 0,
    },
    happy: {
        browLY: 0.3, browRY: 0.3,
        eyeLOpen: 0.8, eyeROpen: 0.8,
        eyeLSmile: 0.7, eyeRSmile: 0.7,
        mouthForm: 0.8,
    },
    sad: {
        browLY: -0.5, browRY: -0.5,
        eyeLOpen: 0.7, eyeROpen: 0.7,
        eyeLSmile: 0, eyeRSmile: 0,
        mouthForm: -0.5,
    },
    angry: {
        browLY: -0.7, browRY: -0.7,
        eyeLOpen: 0.9, eyeROpen: 0.9,
        eyeLSmile: 0, eyeRSmile: 0,
        mouthForm: -0.3,
    },
    surprised: {
        browLY: 0.8, browRY: 0.8,
        eyeLOpen: 1.2, eyeROpen: 1.2,
        eyeLSmile: 0, eyeRSmile: 0,
        mouthForm: 0.2,
    },
    thinking: {
        browLY: 0.2, browRY: -0.2,
        eyeLOpen: 0.9, eyeROpen: 0.9,
        eyeLSmile: 0, eyeRSmile: 0,
        mouthForm: -0.1,
    },
};

/**
 * 表情・リップシンクコントローラ
 */
export class ExpressionController {
    private currentEmotion: EmotionType = 'neutral';
    private targetParams: ExpressionParams;
    private currentParams: ExpressionParams;

    // リップシンク
    private mouthOpenTarget: number = 0;
    private mouthOpenCurrent: number = 0;

    // スムージング係数
    private expressionSmoothing: number = 0.1;  // 表情変化（ゆっくり）
    private lipSyncSmoothing: number = 0.4;     // リップシンク（速く）

    // コールバック
    private onParameterUpdate: ((name: string, value: number) => void) | null = null;

    constructor() {
        this.targetParams = { ...EMOTION_PRESETS.neutral };
        this.currentParams = { ...EMOTION_PRESETS.neutral };
    }

    /**
     * パラメータ更新コールバックを設定
     */
    setParameterCallback(callback: (name: string, value: number) => void): void {
        this.onParameterUpdate = callback;
    }

    /**
     * 感情を設定
     */
    setEmotion(emotion: EmotionType): void {
        if (this.currentEmotion === emotion) return;

        console.log(`[Expression] Emotion: ${this.currentEmotion} -> ${emotion}`);
        this.currentEmotion = emotion;
        this.targetParams = { ...EMOTION_PRESETS[emotion] };
    }

    /**
     * テキストから感情を推定
     */
    detectEmotionFromText(text: string): EmotionType {
        const lowerText = text.toLowerCase();

        // 簡易的なキーワードマッチング
        if (/[😊😄🎉嬉しい|楽しい|ありがとう|素晴らしい|良い|いいね|わーい|やった]/.test(text)) {
            return 'happy';
        }
        if (/[😢😭悲しい|残念|辛い|寂しい|ごめん]/.test(text)) {
            return 'sad';
        }
        if (/[😠😤怒|ムカ|イライラ|許せない]/.test(text)) {
            return 'angry';
        }
        if (/[😲😮驚|びっくり|まさか|えっ|本当]/.test(text)) {
            return 'surprised';
        }
        if (/[🤔考え|思う|かな|だろう|でしょう|...]/.test(text) || text.includes('...')) {
            return 'thinking';
        }

        return 'neutral';
    }

    /**
     * 口の開き具合を設定（リップシンク用）
     */
    setMouthOpen(value: number): void {
        this.mouthOpenTarget = Math.max(0, Math.min(1, value));
    }

    /**
     * 音量からリップシンク値を計算
     */
    calculateLipSyncFromVolume(volume: number): number {
        // 音量を0-1に正規化（閾値調整）
        const minVolume = 0.01;
        const maxVolume = 0.3;

        const normalized = (volume - minVolume) / (maxVolume - minVolume);
        return Math.max(0, Math.min(1, normalized));
    }

    /**
     * 毎フレーム呼び出す更新処理
     */
    update(): void {
        // 表情パラメータの補間
        this.interpolateExpression();

        // リップシンクの補間
        this.interpolateLipSync();

        // パラメータを適用
        this.applyParameters();
    }

    /**
     * 表情パラメータの補間
     */
    private interpolateExpression(): void {
        const s = this.expressionSmoothing;

        this.currentParams.browLY += (this.targetParams.browLY - this.currentParams.browLY) * s;
        this.currentParams.browRY += (this.targetParams.browRY - this.currentParams.browRY) * s;
        this.currentParams.eyeLOpen += (this.targetParams.eyeLOpen - this.currentParams.eyeLOpen) * s;
        this.currentParams.eyeROpen += (this.targetParams.eyeROpen - this.currentParams.eyeROpen) * s;
        this.currentParams.eyeLSmile += (this.targetParams.eyeLSmile - this.currentParams.eyeLSmile) * s;
        this.currentParams.eyeRSmile += (this.targetParams.eyeRSmile - this.currentParams.eyeRSmile) * s;
        this.currentParams.mouthForm += (this.targetParams.mouthForm - this.currentParams.mouthForm) * s;
    }

    /**
     * リップシンクの補間
     */
    private interpolateLipSync(): void {
        const s = this.lipSyncSmoothing;
        this.mouthOpenCurrent += (this.mouthOpenTarget - this.mouthOpenCurrent) * s;
    }

    /**
     * パラメータをLive2Dに適用
     */
    private applyParameters(): void {
        if (!this.onParameterUpdate) return;

        // 表情パラメータ
        this.onParameterUpdate('ParamBrowLY', this.currentParams.browLY);
        this.onParameterUpdate('ParamBrowRY', this.currentParams.browRY);
        this.onParameterUpdate('ParamEyeLOpen', this.currentParams.eyeLOpen);
        this.onParameterUpdate('ParamEyeROpen', this.currentParams.eyeROpen);
        this.onParameterUpdate('ParamEyeLSmile', this.currentParams.eyeLSmile);
        this.onParameterUpdate('ParamEyeRSmile', this.currentParams.eyeRSmile);
        this.onParameterUpdate('ParamMouthForm', this.currentParams.mouthForm);

        // リップシンク（口の開き）
        this.onParameterUpdate('ParamMouthOpenY', this.mouthOpenCurrent);
    }

    /**
     * 現在の感情を取得
     */
    getCurrentEmotion(): EmotionType {
        return this.currentEmotion;
    }

    /**
     * リセット
     */
    reset(): void {
        this.setEmotion('neutral');
        this.mouthOpenTarget = 0;
        this.mouthOpenCurrent = 0;
    }
}