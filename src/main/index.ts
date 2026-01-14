import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LLMRouter, ProviderPreference } from './llm/router.js';
import { LLMMessage, StreamCallbacks } from './llm/types.js';
import { ConversationStorage } from './storage/conversationStorage.js';
import { 
    VectorStore, 
    createEmbeddingProvider, 
    MemoryManager,
    UserProfile,
    MemoryLifecycle, 
} from './memory/index.js';

let userProfile: UserProfile;
let memoryLifecycle: MemoryLifecycle;

// read .env
dotenv.config();

const llmRouter = new LLMRouter('local-first');
let vectorStore: VectorStore;
let memoryManager: MemoryManager;

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

    // ユーザーメッセージに関連する記憶を検索
    let relevantMemories: string = '';
    try {
        const memoryResults = await memoryManager.searchRelevantMemories(message, 5, 0.5);
        if (memoryResults.length > 0) {
            relevantMemories = memoryManager.formatMemoriesForPrompt(memoryResults);
            console.log('[Main] Found relevant memories:', memoryResults.length);
        }
    } catch (error) {
        console.error('[Main] Failed to search memories:', error);
    }

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

    // 記憶がある場合、最初のユーザーメッセージの前にシステムメッセージとして注入
    if (relevantMemories && history.length > 0) {
        // 最後のユーザーメッセージ（今送信したメッセージ）に記憶情報を追加
        const lastMessage = history[history.length - 1];
        if (lastMessage.role === 'user') {
            lastMessage.content = relevantMemories + '\n' + lastMessage.content;
        }
    }

    // プロファイル + 記憶を含むコンテキスト生成
    let context = '';
    try {
        context = await memoryManager.buildContextForPrompt(message);
        if (context) {
            console.log(`[LAG] Context built for prompt`);
        }
    } catch (error) {
        console.error('[RAG] Context building failed:', error);
    }

    const systemPrompt = `あなたは親切なAIアシスタントです．
    ユーザーとの過去のやり取りから得た情報を活用して，パーソナライズされた応答をおこなってください．
    ${context}
    上記の情報がある場合は，自然な形で活用してください．`;

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

            // ユーザーメッセージから重要な情報を抽出して記憶に保存
            try {
                const extractedInfo = memoryManager.extractInfoFromMessage(message, fullText);
                if (extractedInfo) {
                    await memoryManager.saveExtractedInfo(extractedInfo, activeConversationId || undefined);
                    console.log('[Main] Saved memory from conversation:', extractedInfo.content);
                }
            } catch (error) {
                console.error('[Main] Failed to extract/save memory:', error);
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

// IPC: 記憶のついか
ipcMain.handle('memory-add', async (_event, content: string, metadata: any) => {
    const entry = await vectorStore.add(content, metadata);
    return entry;
});

// IPC: 記憶の検索
ipcMain.handle('memory-search', async (_event, query: string, limit?: number) => {
    const results = await vectorStore.search(query, limit);
    return results;
});

// IPC: 記憶数の取得
ipcMain.handle('memory-count', async () => {
    return await vectorStore.count();
});

// IPC: 記憶の統計情報取得
ipcMain.handle('memory-stats', async () => {
    return await memoryManager.getStats();
});

// IPC: 全記憶の取得
ipcMain.handle('memory-get-all', async () => {
    return await vectorStore.getAll();
});

// IPC: 記憶のクリア
ipcMain.handle('memory-clear', async () => {
    await vectorStore.clear();
    return { success: true };
});

// IPC: プロファイル関連を追加
ipcMain.handle('profile-get-all', () => {
    return userProfile.getAll();
});

ipcMain.handle('profile-set', (_event, category: string, key: string, value: string) => {
    return userProfile.set(category as any, key, value);
});

ipcMain.handle('profile-delete', (_event, category: string, key: string) => {
    return userProfile.delete(category as any, key);
});

ipcMain.handle('profile-clear', () => {
    userProfile.clear();
    return { success: true };
});

ipcMain.handle('profile-stats', () => {
    return userProfile.getStats();
});

// IPC: メンテナンス手動実行
ipcMain.handle('memory-maintenance', async () => {
    return await memoryLifecycle.runMaintenance();
});

app.whenReady().then(async () => {
    // 会話ストレージ初期化
    conversationStorage = new ConversationStorage();
    await conversationStorage.initialize();

    // ユーザープロファイルの初期化
    userProfile = new UserProfile();

    // ベクトルストア初期化
    const embeddingProvider = createEmbeddingProvider('xenova');
    vectorStore = new VectorStore(embeddingProvider);
    await vectorStore.initialize();

    // メモリマネージャ初期化
    memoryManager = new MemoryManager(vectorStore, userProfile);

    // ライフサイクル管理初期化
    memoryLifecycle = new MemoryLifecycle(vectorStore, llmRouter);

    console.log('[App] Memory system initialized');

    await createWindow();

    // 定期メンテ（1時間ごと）
    setInterval(async () => {
        try {
            await memoryLifecycle.runMaintenance();
        } catch (error) {
            console.error('[App] Mintenance failed:', error);
        }
    }, 60 * 60 * 1000); // 1時間

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
