// マスコットモード専用スクリプト

// Live2D初期化
// Live2D初期化
document.addEventListener('DOMContentLoaded', async () => {
    // コンソールログをMainプロセスに転送
    if ((window as any).electronAPI?.log) {
        const originalLog = console.log;
        console.log = (...args) => {
            originalLog(...args);
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
            (window as any).electronAPI.log(`[Renderer:Mascot] ${message}`);
        };
        const originalError = console.error;
        console.error = (...args) => {
            originalError(...args);
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
            (window as any).electronAPI.log(`[Renderer:Mascot:Error] ${message}`);
        };
    }

    try {
        await (window as any).initLive2D();
        console.log('Live2D initialized');
    } catch (error) {
        console.error('Failed to initialize Live2D:', error);
    }
});

// チャットボタン
const chatBtn = document.getElementById('chat-btn');
if (chatBtn) {
    chatBtn.addEventListener('click', () => {
        // メインウィンドウを開く（IPC経由）
        if ((window as any).electronAPI?.openMainWindow) {
            (window as any).electronAPI.openMainWindow();
        }
    });
}

// 閉じるボタン
const closeBtn = document.getElementById('close-btn');
if (closeBtn) {
    closeBtn.addEventListener('click', () => {
        // ウィンドウを非表示（IPC経由）
        if ((window as any).electronAPI?.hideMascot) {
            (window as any).electronAPI.hideMascot();
        }
    });
}

// LLMイベントのリスナー設定
if ((window as any).electronAPI) {
    const api = (window as any).electronAPI;
    let textBuffer = '';

    // トークン受信（テキスト生成中）
    api.onLLMToken((token: string) => {
        textBuffer += token;
        // マスコットの口パクを開始
        if ((window as any).startLipSync && !(window as any).isLipSyncActive?.()) {
            (window as any).startLipSync();
        }
    });

    // 生成完了
    api.onLLMDone((fullText: string) => {
        console.log('[Mascot] LLM Response done:', fullText.substring(0, 20) + '...');

        // 口パク停止
        if ((window as any).stopLipSync) {
            (window as any).stopLipSync();
        }

        // 感情判定と反映
        if ((window as any).setEmotionFromText) {
            (window as any).setEmotionFromText(fullText);
        }
    });

    // エラー時
    api.onLLMError((error: string) => {
        console.error('[Mascot] LLM Error:', error);
        if ((window as any).stopLipSync) {
            (window as any).stopLipSync();
        }
        if ((window as any).setEmotion) {
            (window as any).setEmotion('sad');
        }
    });

    // TTS状態変化
    if (api.onTTSState) {
        api.onTTSState((data: { state: string }) => {
            console.log('[Mascot] TTS State:', data.state);
            if (data.state === 'idle') {
                // 話し終わったら表情を戻す（少し遅延させると自然かも）
                setTimeout(() => {
                    if ((window as any).setEmotion) {
                        (window as any).setEmotion('neutral');
                    }
                }, 1000);
            }
        });
    }
}