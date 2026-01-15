// グローバルに公開されたPIXIとLive2DModelを使用
declare const PIXI: any;

let Live2DModel: any;
let live2dApp: any = null;
let live2dModel: any = null;

// 初期化を遅延実行
function initializeLive2DModule(): void {
    if (typeof PIXI === 'undefined' || !PIXI.live2d) {
        console.error('[Live2D] PIXI or PIXI.live2d not available');
        return;
    }
    Live2DModel = PIXI.live2d.Live2DModel;
    PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);
    console.log('[Live2D] Module initialized');
}

// 感情プリセット
type EmotionType = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking';

interface ExpressionParams {
    browLY: number;
    browRY: number;
    eyeLSmile: number;
    eyeRSmile: number;
    mouthForm: number;
}

const EMOTION_PRESETS: Record<EmotionType, ExpressionParams> = {
    neutral: { browLY: 0, browRY: 0, eyeLSmile: 0, eyeRSmile: 0, mouthForm: 0 },
    happy: { browLY: 0.3, browRY: 0.3, eyeLSmile: 0.7, eyeRSmile: 0.7, mouthForm: 0.8 },
    sad: { browLY: -0.5, browRY: -0.5, eyeLSmile: 0, eyeRSmile: 0, mouthForm: -0.5 },
    angry: { browLY: -0.7, browRY: -0.7, eyeLSmile: 0, eyeRSmile: 0, mouthForm: -0.3 },
    surprised: { browLY: 0.8, browRY: 0.8, eyeLSmile: 0, eyeRSmile: 0, mouthForm: 0.2 },
    thinking: { browLY: 0.2, browRY: -0.2, eyeLSmile: 0, eyeRSmile: 0, mouthForm: -0.1 },
};

let currentEmotion: EmotionType = 'neutral';
let currentParams: ExpressionParams = { ...EMOTION_PRESETS.neutral };
let targetParams: ExpressionParams = { ...EMOTION_PRESETS.neutral };
let mouthOpenCurrent = 0;
let mouthOpenTarget = 0;

async function initLive2D(): Promise<void> {
    // モジュール初期化
    initializeLive2DModule();

    const canvas = document.getElementById('avatar-canvas') as HTMLCanvasElement;
    const container = document.getElementById('avatar-container') as HTMLDivElement;

    try {
        live2dApp = new PIXI.Application({
            view: canvas,
            autoStart: true,
            backgroundAlpha: 0,
            resizeTo: container,
        });

        // モデルをロード
        live2dModel = await Live2DModel.from('assets/Hiyori/hiyori_pro_t11.model3.json');

        // サイズ調整（上半身アップ表示）
        const scale = Math.min(
            container.clientWidth / live2dModel.width * 2.0,
            container.clientHeight / live2dModel.height * 2.0
        );
        live2dModel.scale.set(scale);
        live2dModel.anchor.set(0.5, 0.3);
        live2dModel.position.set(
            container.clientWidth / 2,
            container.clientHeight * 0.7
        );

        live2dApp.stage.addChild(live2dModel);

        // アニメーションループ開始
        live2dApp.ticker.add(() => {
            updateExpression();
            updateLipSync();
        });

        // まばたき
        setInterval(() => {
            if (live2dModel && Math.random() < 0.3) {
                blinkLive2D();
            }
        }, 3000);

        console.log('[Live2D] Initialized');
    } catch (error) {
        console.error('[Live2D] Failed:', error);
        container.style.display = 'none';
    }
}

function setParameter(name: string, value: number): void {
    if (!live2dModel) return;
    const cm = live2dModel.internalModel.coreModel;
    const index = cm.getParameterIndex(name);
    if (index >= 0) {
        cm.setParameterValueByIndex(index, value);
    }
}

function blinkLive2D(): void {
    if (!live2dModel) return;
    setParameter('ParamEyeLOpen', 0);
    setParameter('ParamEyeROpen', 0);

    setTimeout(() => {
        setParameter('ParamEyeLOpen', 1);
        setParameter('ParamEyeROpen', 1);
    }, 150);
}

function setMouthOpen(value: number): void {
    mouthOpenTarget = Math.max(0, Math.min(1, value));
}

function updateLipSync(): void {
    const smoothing = 0.4;
    mouthOpenCurrent += (mouthOpenTarget - mouthOpenCurrent) * smoothing;
    setParameter('ParamMouthOpenY', mouthOpenCurrent);
}

function setEmotion(emotion: EmotionType): void {
    if (currentEmotion === emotion) return;
    console.log(`[Live2D] Emotion: ${currentEmotion} -> ${emotion}`);
    currentEmotion = emotion;
    targetParams = { ...EMOTION_PRESETS[emotion] };
}

function updateExpression(): void {
    const smoothing = 0.1;

    currentParams.browLY += (targetParams.browLY - currentParams.browLY) * smoothing;
    currentParams.browRY += (targetParams.browRY - currentParams.browRY) * smoothing;
    currentParams.eyeLSmile += (targetParams.eyeLSmile - currentParams.eyeLSmile) * smoothing;
    currentParams.eyeRSmile += (targetParams.eyeRSmile - currentParams.eyeRSmile) * smoothing;
    currentParams.mouthForm += (targetParams.mouthForm - currentParams.mouthForm) * smoothing;

    setParameter('ParamBrowLY', currentParams.browLY);
    setParameter('ParamBrowRY', currentParams.browRY);
    setParameter('ParamEyeLSmile', currentParams.eyeLSmile);
    setParameter('ParamEyeRSmile', currentParams.eyeRSmile);
    setParameter('ParamMouthForm', currentParams.mouthForm);
}

function detectEmotionFromText(text: string): EmotionType {
    if (/[😊😄🎉]|嬉しい|楽しい|ありがとう|素晴らしい|良い|いいね|わーい|やった/.test(text)) {
        return 'happy';
    }
    if (/[😢😭]|悲しい|残念|辛い|寂しい|ごめん/.test(text)) {
        return 'sad';
    }
    if (/[😠😤]|怒|ムカ|イライラ|許せない/.test(text)) {
        return 'angry';
    }
    if (/[😲😮]|驚|びっくり|まさか|えっ|本当/.test(text)) {
        return 'surprised';
    }
    if (/[🤔]|考え|思う|かな|だろう|でしょう|\.\.\./.test(text)) {
        return 'thinking';
    }
    return 'neutral';
}

function setEmotionFromText(text: string): void {
    const emotion = detectEmotionFromText(text);
    setEmotion(emotion);
}

// 自動リップシンクテスト
function testLipSyncAuto(): void {
    let phase = 0;
    const interval = setInterval(() => {
        const value = (Math.sin(phase) + 1) / 2;
        setMouthOpen(value);
        phase += 0.3;
    }, 50);

    setTimeout(() => {
        clearInterval(interval);
        setMouthOpen(0);
    }, 5000);
}

// ============================================================
// 自動リップシンク（TTS再生中用）
// ============================================================

let lipSyncInterval: ReturnType<typeof setInterval> | null = null;
let lipSyncPhase = 0;

function startLipSync(): void {
    if (lipSyncInterval) return; // 既に動作中
    
    lipSyncPhase = 0;
    lipSyncInterval = setInterval(() => {
        // 自然な口の動きをシミュレート（ランダム + サイン波）
        const base = (Math.sin(lipSyncPhase) + 1) / 2;
        const noise = Math.random() * 0.3;
        const value = Math.min(1, base * 0.7 + noise);
        
        setMouthOpen(value);
        lipSyncPhase += 0.4;
    }, 50);
    
    console.log('[Live2D] LipSync started');
}

function stopLipSync(): void {
    if (lipSyncInterval) {
        clearInterval(lipSyncInterval);
        lipSyncInterval = null;
    }
    // 口を閉じる（滑らかに）
    setMouthOpen(0);
    console.log('[Live2D] LipSync stopped');
}

function isLipSyncActive(): boolean {
    return lipSyncInterval !== null;
}

// グローバルに公開
const globalWindow = window as any;
globalWindow.initLive2D = initLive2D;
globalWindow.setMouthOpen = setMouthOpen;
globalWindow.blinkLive2D = blinkLive2D;
globalWindow.setEmotion = setEmotion;
globalWindow.setEmotionFromText = setEmotionFromText;
globalWindow.testLipSync = setMouthOpen;
globalWindow.testEmotion = setEmotion;
globalWindow.testLipSyncAuto = testLipSyncAuto;
globalWindow.startLipSync = startLipSync;
globalWindow.stopLipSync = stopLipSync;
globalWindow.isLipSyncActive = isLipSyncActive;

console.log('[Live2D] Functions exported to window:', {
    initLive2D: typeof globalWindow.initLive2D,
    testEmotion: typeof globalWindow.testEmotion,
    testLipSync: typeof globalWindow.testLipSync,
    testLipSyncAuto: typeof globalWindow.testLipSyncAuto,
});

