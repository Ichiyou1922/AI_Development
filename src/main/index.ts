import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LLMRouter, ProviderPreference } from './llm/router.js';
import { LLMMessage, StreamCallbacks } from './llm/types.js';
import { HistoryManager } from './llm/history.js';
import { ConversationStorage } from './storage/conversationStorage.js';
import { Conversation, ConversationMeta, StoredMessage } from './storage/types.js';
// read .env
dotenv.config();

const llmRouter = new LLMRouter('local-first');

// ストレージのインスタンス
let conversationStorage: ConversationStorage;
// 現在アクティブな会話ID
let activeConversationId: string | null = null;

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
    mainWindow = new BrowserWindow({
        width: 10000,
        height: 700,
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

// 新規会話を作成
ipcMain.handle('conversation-create', async (_event, title?: string) => {
    const conversation = await conversationStorage.create(title);
    activeConversationId = conversation.id;
    return conversation;
});

// 会話一覧を取得
ipcMain.handle('conversation-list', async () => {
    return await conversationStorage.listAll();
});

ipcMain.handle('conversation-load', async (_event, id: string) => {
    const conversation = await conversationStorage.load(id);
    if (conversation) {
        activeConversationId = id;
    }
    return conversation;
});

// 会話を削除
ipcMain.handle('conversation-delete', async (_event, id: string) => {
    const success = await conversationStorage.delete(id);
    if (success && activeConversationId === id) {
        activeConversationId = null;
    }
    return { success };
});

// 現在のアクティブ会話IDを取得
ipcMain.handle('conversation-get-active', () => {
    return activeConversationId;
});

// メッセージ送信IPC

// IPC: メッセージストリーム
ipcMain.handle('send-message-stream', async (_event, message: string) => {
    // アクティブ名会話がなければ新規作成
    if (!activeConversationId) {
        const newConv = await conversationStorage.create();
        activeConversationId = newConv.id;
    }

    // ユーザーメッセージを保存
    await conversationStorage.addMessage(activeConversationId, 'user', message);

    // 会話履歴をLLM形式に変換
    const conversation = await conversationStorage.load(activeConversationId);
    if (!conversation) {
        mainWindow?.webContents.send('llm-error', { error: 'Conversation not found' });
        return { started: false };
    }

    const history: LLMMessage[] = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    let fullResponse = '';
    // コールバック定義
    const callbacks: StreamCallbacks = {
        onToken: (token) => {
            fullResponse += token;
            // Rendererにトークンを送信
            mainWindow?.webContents.send('llm-token', { token });
        },
        onDone: async (fullText) => {
            // アシスタントメッセージを保存
            if (activeConversationId) {
                await conversationStorage.addMessage(activeConversationId, 'assistant', fullText);
            }
            // Rendererに完了通知
            mainWindow?.webContents.send('llm-done', { fullText });
        },
        onError: (error) => {
            // Rendererにエラー通知
            mainWindow?.webContents.send('llm-error', { error });
        }
    };

    // ストリーミング開始
    await llmRouter.sendMessageStream(history, callbacks);

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

app.whenReady().then(async () => {
    conversationStorage = new ConversationStorage();
    await conversationStorage.initialize();
    await createWindow();

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
