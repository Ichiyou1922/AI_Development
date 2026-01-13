import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LLMRouter, ProviderPreference } from './llm/router.js';
import { LLMMessage } from './llm/types.js';

// read .env
dotenv.config();

const llmRouter = new LLMRouter('local-first');

const conversationHistory: LLMMessage[] = [];

function createWindow(): void {
    const mainWindow = new BrowserWindow({
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
}

// IPC: メッセージ送信
ipcMain.handle('send-message', async (_event, message: string) => {
    conversationHistory.push({ role: 'user', content: message });

    const response = await llmRouter.sendMessage(conversationHistory);

    if (response.success && response.text) {
        conversationHistory.push({ role: 'assistant', content: response.text });
    }

    return response;
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
