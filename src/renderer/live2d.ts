// グローバルに公開されたPIXIとLive2DModelを使用
declare const PIXI: any;
declare const PIXI_LIVE2D_DISPLAY: any;

const Live2DModel = PIXI_LIVE2D_DISPLAY.Live2DModel;

// Live2DModelをPIXIに登録
Live2DModel.registerTicker(PIXI.Ticker);

let live2dApp: any = null;
let live2dModel: any = null;

async function initLive2D(): Promise<void> {
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
        live2dModel = await Live2DModel.from('assets/live2d/Hiyori/Hiyori.model3.json');

        // サイズ調整
        const scale = Math.min(
            container.clientWidth / live2dModel.width * 0.8,
            container.clientHeight / live2dModel.height * 0.9
        );
        live2dModel.scale.set(scale);
        live2dModel.anchor.set(0.5, 0.5);
        live2dModel.position.set(
            container.clientWidth / 2,
            container.clientHeight / 2
        );

        live2dApp.stage.addChild(live2dModel);

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

function blinkLive2D(): void {
    if (!live2dModel) return;
    const cm = live2dModel.internalModel.coreModel;
    const eyeLIndex = cm.getParameterIndex('ParamEyeLOpen');
    const eyeRIndex = cm.getParameterIndex('ParamEyeROpen');

    if (eyeLIndex >= 0) cm.setParameterValueByIndex(eyeLIndex, 0);
    if (eyeRIndex >= 0) cm.setParameterValueByIndex(eyeRIndex, 0);

    setTimeout(() => {
        if (eyeLIndex >= 0) cm.setParameterValueByIndex(eyeLIndex, 1);
        if (eyeRIndex >= 0) cm.setParameterValueByIndex(eyeRIndex, 1);
    }, 150);
}

function setMouthOpen(value: number): void {
    if (!live2dModel) return;
    const cm = live2dModel.internalModel.coreModel;
    const mouthIndex = cm.getParameterIndex('ParamMouthOpenY');
    if (mouthIndex >= 0) {
        cm.setParameterValueByIndex(mouthIndex, value);
    }
}

// グローバルに公開
(window as any).initLive2D = initLive2D;
(window as any).setMouthOpen = setMouthOpen;
(window as any).blinkLive2D = blinkLive2D;