// マスコットモード専用スクリプト

// Live2D初期化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await (window as any).initLive2D();
        console.log('[Mascot] Live2D initialized');
    } catch (error) {
        console.error('[Mascot] Failed to initialize Live2D:', error);
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