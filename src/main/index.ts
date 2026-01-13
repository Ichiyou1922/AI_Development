import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LLMRouter, ProviderPreference } from './llm/router.js';
import { LLMMessage, StreamCallbacks } from './llm/types.js';

// read .env
dotenv.config();

const llmRouter = new LLMRouter('local-first');
const conversationHistory: LLMMessage[] = [];

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false, // to disable Node.js integration in Renderer
            contextIsolation: true // separate Renderer and Preload
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 非ストリーミングのメッセージハンドラは削除（ストリーミングのみ利用）

// IPC: メッセージストリーム
ipcMain.handle('send-message-stream', async (_event, message: string) => {
    // 会話履歴に追加
    conversationHistory.push({ role: 'user', content: message });

    // コールバック定義
    const callbacks: StreamCallbacks = {
        onToken: (token) => {
            // Rendererにトークンを送信
            mainWindow?.webContents.send('llm-token', { token });
        },
        onDone: (fullText) => {
            // 会話履歴に追加
            conversationHistory.push({ role: 'assistant', content: fullText });
            // Rendererに完了通知
            mainWindow?.webContents.send('llmdone', { fullText });
        },
        onError: (error) => {
            // Rendererにエラー通知
            mainWindow?.webContents.send('llm-error', { error });
        }
    };

    // ストリーミング開始
    await llmRouter.sendMessageStream(conversationHistory, callbacks);

    // 戻り値
    return { started: true };
});

// IPC: プロバイダ設定の取得
ipcMain.handle('get-provider-preference', () => {
    return llmRouter.getPreference();
});

// IPC: プロバイダ設定の変更
ipcMain.handle('set-provider-preference', (_event, preference: ProviderPreference) => {
    llmRouter.setPreference(preference);
    return { success: true };
});

// IPC: 会話履歴のクリア
ipcMain.handle('clear-history', () => {
    conversationHistory.length = 0;
    return { success: true };
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
