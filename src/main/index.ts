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
import { MicrophoneCapture } from './voice/microphoneCapture.js';
import { CaptureState } from './voice/types.js';
import { VoicevoxProvider } from './voice/voicevoxProvider.js';
import { AudioPlayer } from './voice/audioPlayer.js';
import { VoiceDialogueController, DialogueState } from './voice/voiceDialogueController.js';
import { StreamingTTSController } from './voice/streamingTTSController.js';
import { DiscordBot, DiscordMessageContext, IdentifiedAudio } from './discord/index.js';
import { getDiscordUserManager, DiscordUser } from './memory/discordUsers.js';
import { MascotWindow } from './windows/MascotWindow.js';
import {
    eventBus,
    timerTrigger,
    idleDetector,
    EventPriority,
    AgentEvent,
} from './events/index.js';
import { autonomousController } from './agent/index.js';
// 設定システム
import { initConfig, config, getIdleDetectorConfig, getIgnoreDetectorConfig } from './config/index.js';
import { screenshotCapture, ScreenContext, screenRecognitionController, activeWindowMonitor } from './screen/index.js';
import { AlwaysOnListener, ListenerConfig } from './mascot/alwaysOnListener.js';
import { STTRouter } from './voice/sttRouter.js';

let userProfile: UserProfile;
let memoryLifecycle: MemoryLifecycle;
// let whisperProvider: WhisperProvider;
let microphoneCapture: MicrophoneCapture;
let voiceEnabled: boolean = false;
let voicevoxProvider: VoicevoxProvider;
let audioPlayer: AudioPlayer;
let ttsEnabled: boolean = false;
let voiceDialogue: VoiceDialogueController | null = null as VoiceDialogueController | null;
let discordBot: DiscordBot | null = null;
let sttRouter: STTRouter;
let alwaysOnListener: AlwaysOnListener | null = null;
let discordStreamingTTS: StreamingTTSController | null = null;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

// グローバルエラーハンドラ（アプリ終了時のwrite EIOエラーを無視）
process.on('uncaughtException', (error) => {
    // アプリ終了時のI/Oエラーは無視
    if (error.message?.includes('write EIO') || error.message?.includes('write EPIPE')) {
        return;
    }
    console.error('[App] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    // アプリ終了時のI/Oエラーは無視
    if (reason instanceof Error && (reason.message?.includes('write EIO') || reason.message?.includes('write EPIPE'))) {
        return;
    }
    console.error('[App] Unhandled Rejection:', reason);
});

// app.isQuittingはelectronTypes.d.tsで定義

let mascotWindow: MascotWindow | null = null;

// read .env
dotenv.config();

// LLMRouterは設定読み込み後に初期化するため、letで宣言
let llmRouter: LLMRouter;
let vectorStore: VectorStore;
let memoryManager: MemoryManager;

// ストレージのインスタンス
let conversationStorage: ConversationStorage;
// 現在アクティブな会話ID
let activeConversationId: string | null = null;

let mainWindow: BrowserWindow | null = null;

// ============================================================
// 会話コンテキストマネージャ（多人数会話の文脈管理）
// ============================================================

interface SpeakerEntry {
    discordUserId: string;
    displayName: string;
    lastSpeakTime: number;
}

class ConversationContextManager {
    // 現在の会話参加者（最近発言した順）
    private participants: Map<string, SpeakerEntry> = new Map();
    // 発言履歴（最新10件）
    private speakerHistory: Array<{ userId: string; displayName: string; content: string; timestamp: number }> = [];
    // 参加者の最大保持数
    private readonly MAX_PARTICIPANTS = 10;
    // 履歴の最大保持数
    private readonly MAX_HISTORY = 10;
    // 参加者の有効期限（30分）
    private readonly PARTICIPANT_TTL_MS = 30 * 60 * 1000;

    /**
     * 発言を記録
     */
    recordSpeaker(discordUserId: string, displayName: string, content: string): void {
        const now = Date.now();

        // 参加者リストを更新
        this.participants.set(discordUserId, {
            discordUserId,
            displayName,
            lastSpeakTime: now,
        });

        // 発言履歴に追加
        this.speakerHistory.push({
            userId: discordUserId,
            displayName,
            content: content.substring(0, 100), // 最初の100文字のみ
            timestamp: now,
        });

        // 履歴が最大を超えたら古いものを削除
        if (this.speakerHistory.length > this.MAX_HISTORY) {
            this.speakerHistory.shift();
        }

        // 古い参加者を削除
        this.cleanupOldParticipants();
    }

    /**
     * 古い参加者を削除
     */
    private cleanupOldParticipants(): void {
        const now = Date.now();
        const threshold = now - this.PARTICIPANT_TTL_MS;

        for (const [userId, entry] of this.participants) {
            if (entry.lastSpeakTime < threshold) {
                this.participants.delete(userId);
            }
        }
    }

    /**
     * 現在の参加者リストを取得
     */
    getParticipants(): SpeakerEntry[] {
        return Array.from(this.participants.values())
            .sort((a, b) => b.lastSpeakTime - a.lastSpeakTime);
    }

    /**
     * 直近の発言者を取得
     */
    getRecentSpeakers(count: number = 3): Array<{ userId: string; displayName: string; content: string }> {
        return this.speakerHistory.slice(-count).reverse();
    }

    /**
     * LLMプロンプト用のコンテキストを生成
     */
    formatForPrompt(): string {
        const parts: string[] = [];

        // 現在の会話参加者
        const participants = this.getParticipants();
        if (participants.length > 0) {
            parts.push('【現在の会話参加者】');
            for (const p of participants) {
                parts.push(`- ${p.displayName}`);
            }
        }

        // 直近の発言履歴
        const recent = this.getRecentSpeakers(5);
        if (recent.length > 0) {
            parts.push('\n【直近の発言】');
            for (const s of recent) {
                parts.push(`- ${s.displayName}: 「${s.content}」`);
            }
        }

        return parts.join('\n');
    }

    /**
     * 会話をリセット
     */
    reset(): void {
        this.participants.clear();
        this.speakerHistory = [];
    }
}

// グローバルインスタンス
const conversationContext = new ConversationContextManager();

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

function createMascotWindow(): void {
    mascotWindow = new MascotWindow();
    mascotWindow.create();

    mascotWindow.setOpenMainWindowCallback(() => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

async function processVoiceMessage(userText: string): Promise<string> {
    if (!activeConversationId) {
        const newConv = await conversationStorage.create();
        activeConversationId = newConv.id;
    }

    // ユーザーメッセージを保存
    await conversationStorage.addMessage(activeConversationId, 'user', userText);

    let context = '';
    try {
        context = await memoryManager.buildContextForPrompt(userText);
    } catch (error) {
        console.error('[Voice] Context building failed:', error);
    }

    // conversation load
    const conversation = await conversationStorage.load(activeConversationId);
    if (!conversation) {
        throw new Error('Conversation not found');
    }

    const history: LLMMessage[] = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    // LLM call (ローカル音声対話は無効化 - Discord専用)
    let fullResponse = '';

    await new Promise<void>((resolve, reject) => {
        llmRouter.sendMessageStream(history, {
            onToken: (token) => {
                fullResponse += token;
                mainWindow?.webContents.send('llm-token', { token });
                mascotWindow?.getWindow()?.webContents.send('llm-token', { token });
            },
            onDone: async (fullText) => {
                fullResponse = fullText;

                // reserve assistant messages
                await conversationStorage.addMessage(activeConversationId!, 'assistant', fullText);

                // information input, memory update
                try {
                    const extractedInfo = memoryManager.extractInfoFromMessage(userText, fullText);
                    if (extractedInfo) {
                        await memoryManager.saveExtractedInfo(extractedInfo, activeConversationId!);
                    }
                } catch (error) {
                    console.error('{Voice} Memory extraction failed:', error);
                }

                mainWindow?.webContents.send('llm-done', { fullText });
                mascotWindow?.getWindow()?.webContents.send('llm-done', { fullText });

                resolve();
            },
            onError: (error) => {
                mainWindow?.webContents.send('llm-error', { error });
                reject(new Error(error));
            },
        });
    });

    return fullResponse;
}

async function processDiscordMessage(ctx: DiscordMessageContext): Promise<string> {
    // ユーザーからのメッセージがあったので無視判定タイマーをリセット
    voiceDialogue?.notifyUserActive();

    // デバッグログ
    console.log('[Discord] Message context:', {
        userId: ctx.userId,
        username: ctx.username,
        displayName: ctx.displayName,
        isAdmin: ctx.isAdmin,
        userContext: ctx.userContext,
    });

    // 発言者名を決定
    const speakerName = ctx.displayName || ctx.username;

    // 会話コンテキストに発言を記録
    conversationContext.recordSpeaker(ctx.userId, speakerName, ctx.content);

    // アクティブ会話がなければ新規作成（Discord用に別管理も可能）
    if (!activeConversationId) {
        const newConv = await conversationStorage.create(`Discord: ${speakerName}`);
        activeConversationId = newConv.id;
    }

    // ユーザーメッセージを保存（Discord userIdと表示名を紐付け）
    await conversationStorage.addMessage(activeConversationId, 'user', ctx.content, ctx.userId, speakerName);

    // 記憶検索（全体 + ユーザー別）
    let memoryContext = '';
    try {
        memoryContext = await memoryManager.buildContextForPrompt(ctx.content);
        // ユーザー別の記憶も検索
        const userMemories = await memoryManager.searchUserMemories(ctx.content, ctx.userId, 3, 0.4);
        if (userMemories.length > 0) {
            const userMemoryText = userMemories.map(m => `- ${m.entry.content}`).join('\n');
            memoryContext += `\n\n【${speakerName}に関する記憶】\n${userMemoryText}`;
        }
    } catch (error) {
        console.error('[Discord] Context building failed:', error);
    }

    // 会話履歴を取得
    const conversation = await conversationStorage.load(activeConversationId);
    if (!conversation) {
        throw new Error('Conversation not found');
    }

    // システムプロンプトを構築（発言者情報 + 記憶コンテキスト）
    const systemPromptParts: string[] = [config.prompts.system];

    // AIの名前を追加（言語モデルが自分の名前を間違えないように）
    const aiName = config.prompts.character.name;
    systemPromptParts.push(`\n\n【あなたの名前】\nあなたの名前は「${aiName}」です。自分の名前を聞かれたら「${aiName}」と答えてください。`);
    systemPromptParts.push(`\n名前と一人称（私、僕など）を明確に区別してください。「私」は名前ではありません。`);

    // adminの場合、親として認識
    if (ctx.isAdmin) {
        systemPromptParts.push(`\n\n【重要な関係】\n${speakerName}はあなたの「開発者」です。親しみを込めて接してください。`);
    }

    // 会話参加者コンテキストを追加
    const participantContext = conversationContext.formatForPrompt();
    if (participantContext) {
        systemPromptParts.push(`\n\n${participantContext}`);
    }

    // 発言者情報を追加
    console.log('[Discord] Speaker name resolved to:', speakerName);
    systemPromptParts.push(`\n\n【現在の発言者】\n${ctx.userContext}`);
    systemPromptParts.push(`この人の名前は「${speakerName}」です。名前を呼んで話しかけてください。`);

    // 記憶コンテキストを追加
    if (memoryContext) {
        systemPromptParts.push(`\n\n${memoryContext}`);
    }

    const fullSystemPrompt = systemPromptParts.join('');

    // 会話履歴をLLMメッセージ形式に変換（システムプロンプトを先頭に）
    const history: LLMMessage[] = [
        { role: 'user', content: fullSystemPrompt },
        { role: 'assistant', content: 'わかった！' },
        ...conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
        })),
    ];

    // LLM呼び出し
    let fullResponse = '';

    await new Promise<void>((resolve, reject) => {
        llmRouter.sendMessageStream(history, {
            onToken: (token) => {
                fullResponse += token;
                mascotWindow?.getWindow()?.webContents.send('llm-token', { token });
            },
            onDone: async (fullText) => {
                fullResponse = fullText;

                // アシスタントメッセージを保存
                await conversationStorage.addMessage(activeConversationId!, 'assistant', fullText);

                // 情報抽出・記憶保存（Discord userIdを紐付け）
                try {
                    const extractedInfo = memoryManager.extractInfoFromMessage(ctx.content, fullText);
                    if (extractedInfo) {
                        await memoryManager.saveExtractedInfo(extractedInfo, activeConversationId!, ctx.userId, speakerName);
                    }
                } catch (error) {
                    console.error('[Discord] Memory extraction failed:', error);
                }

                mascotWindow?.getWindow()?.webContents.send('llm-done', { fullText });
                resolve();
            },
            onError: (error) => {
                reject(new Error(error));
            },
        });
    });

    return fullResponse;
}

// Discord音声メッセージを処理
async function processDiscordVoiceMessage(audio: IdentifiedAudio): Promise<string> {
    // 自律発話中は処理をスキップ（競合防止）
    if (autonomousController.isCurrentlySpeaking()) {
        console.log('[Discord Voice] Skipped: autonomous speech in progress');
        return '';
    }

    // whisper
    const transcription = await sttRouter.transcribe(audio.audioBuffer, 16000);
    const userText = transcription.text.trim();

    if (!userText) {
        console.log('[Discord Voice] Empty transcription');
        return '';
    }

    console.log((`[Discord Voice] ${audio.username}: "${userText}"`));

    // ユーザー情報を取得（discordBotが初期化されている場合）
    let speakerName = audio.username;
    let userContext = `発言者: ${audio.username}`;
    let isAdmin = false;
    console.log(`[Discord Voice] Looking up user: userId=${audio.userId}, username=${audio.username}`);
    console.log(`[Discord Voice] Admin config: id=${config.discord.admin?.id}, name=${config.discord.admin?.name}`);

    if (discordBot) {
        const name = discordBot.getUserName(audio.userId);
        console.log(`[Discord Voice] getUserName returned: ${name}`);
        if (name) {
            speakerName = name;
            isAdmin = config.discord.admin?.id === audio.userId;
            userContext = isAdmin ? `発言者: ${name}（管理者/お父さん）` : `発言者: ${name}`;
        }
    }

    console.log(`[Discord Voice] Speaker resolved to: ${speakerName}`);

    // 会話コンテキストに発言を記録
    conversationContext.recordSpeaker(audio.userId, speakerName, userText);

    // message process
    // if active conversation is not set, create new conversation
    if (!activeConversationId) {
        const newConv = await conversationStorage.create(`Discord Voice: ${speakerName}`);
        activeConversationId = newConv.id;
    }

    // user message save（Discord userIdと表示名を紐付け）
    await conversationStorage.addMessage(activeConversationId, 'user', userText, audio.userId, speakerName);

    // memory search（全体 + ユーザー別）
    let memoryContext = '';
    try {
        memoryContext = await memoryManager.buildContextForPrompt(userText);
        // ユーザー別の記憶も検索
        const userMemories = await memoryManager.searchUserMemories(userText, audio.userId, 3, 0.4);
        if (userMemories.length > 0) {
            const userMemoryText = userMemories.map(m => `- ${m.entry.content}`).join('\n');
            memoryContext += `\n\n【${speakerName}に関する記憶】\n${userMemoryText}`;
        }
    } catch (error) {
        console.log('[Discord Voice] Context building failed:', error);
    }

    // get conversation history
    const conversation = await conversationStorage.load(activeConversationId);
    if (!conversation) {
        throw new Error('Conversation not found');
    }

    // システムプロンプトを構築（発言者情報 + 記憶コンテキスト）
    const systemPromptParts: string[] = [config.prompts.system];

    // AIの名前を追加（言語モデルが自分の名前を間違えないように）
    const aiName = config.prompts.character.name;
    systemPromptParts.push(`\n\n【あなたの名前】\nあなたの名前は「${aiName}」です。自分の名前を聞かれたら「${aiName}」と答えてください。`);
    systemPromptParts.push(`\n名前と一人称（私、僕など）を明確に区別してください。「私」は名前ではありません。`);

    // adminの場合、親として認識
    if (isAdmin) {
        systemPromptParts.push(`\n\n【重要な関係】\n${speakerName}はあなたの「お父さん」（親/保護者）です。親しみを込めて接してください。`);
    }

    // 会話参加者コンテキストを追加
    const participantContext = conversationContext.formatForPrompt();
    if (participantContext) {
        systemPromptParts.push(`\n\n${participantContext}`);
    }

    // 発言者情報を追加
    systemPromptParts.push(`\n\n【現在の発言者】\n${userContext}`);
    systemPromptParts.push(`この人の名前は「${speakerName}」です。名前を呼んで話しかけてください。`);
    systemPromptParts.push(`\n【重要】\n相手の名前がわからない場合でも、「〇〇さん」や「ユーザーさん」といったプレースホルダーは絶対に使わないでください。その場合は「あなた」と呼ぶか、名前を呼ばずに話しかけてください。`);

    // 記憶コンテキストがあれば追加
    if (memoryContext) {
        systemPromptParts.push(`\n\n${memoryContext}`);
    }

    const fullSystemPrompt = systemPromptParts.join('');

    // 会話履歴をLLMメッセージ形式に変換（システムプロンプトを先頭に）
    const history: LLMMessage[] = [
        { role: 'user', content: fullSystemPrompt },
        { role: 'assistant', content: 'わかった！' },
        ...conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
        })),
    ];

    // LLM呼び出し
    let fullResponse = '';

    // ストリーミングTTSを開始（Discord用）
    if (discordStreamingTTS && ttsEnabled) {
        discordStreamingTTS.start();
        // 再生開始通知
        mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'playing' });
    }

    // ユーザーが発話したのでアクティブ状態として通知
    eventBus.publish({
        type: 'system:active',
        priority: EventPriority.HIGH,
        timestamp: Date.now(),
        data: {
            source: 'discord_voice',
            userId: audio.userId,
            username: audio.username
        }
    });

    await new Promise<void>((resolve, reject) => {
        llmRouter.sendMessageStream(history, {
            onToken: (token) => {
                fullResponse += token;
                mascotWindow?.getWindow()?.webContents.send('llm-token', { token });

                // ストリーミングTTSにトークンを送信
                if (discordStreamingTTS && ttsEnabled) {
                    discordStreamingTTS.onToken(token);
                }
            },
            onDone: async (fullText) => {
                fullResponse = fullText;

                // assistant message save
                await conversationStorage.addMessage(activeConversationId!, 'assistant', fullText);

                // MemoryManager: 情報抽出・記憶保存（Discord userIdを紐付け）
                try {
                    const extractedInfo = memoryManager.extractInfoFromMessage(userText, fullText);
                    if (extractedInfo) {
                        await memoryManager.saveExtractedInfo(extractedInfo, activeConversationId!, audio.userId, speakerName);
                        console.log('[Discord Voice] Saved memory:', extractedInfo.content, `(User: ${audio.userId})`);
                    }
                } catch (error) {
                    console.error('[Discord Voice] Memory extraction failed:', error);
                }

                mascotWindow?.getWindow()?.webContents.send('llm-done', { fullText });

                // ストリーミングTTSを終了（再生完了まで待つ）
                if (discordStreamingTTS && ttsEnabled) {
                    await discordStreamingTTS.onDone();
                    // 再生終了通知
                    mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'idle' });
                }

                resolve();
            },
            onError: (error) => {
                // ストリーミングTTSを停止
                if (discordStreamingTTS) {
                    discordStreamingTTS.stop();
                    mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'idle' });
                }
                reject(new Error(error));
            },
        });
    });

    return fullResponse;
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

// IPC: ログ転送
ipcMain.on('log', (_event, message: string) => {
    console.log(message);
});

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
            mascotWindow?.getWindow()?.webContents.send('llm-token', { token });
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
            mascotWindow?.getWindow()?.webContents.send('llm-done', { fullText });
        },
        onError: (error) => {
            // Rendererにエラー通知
            mainWindow?.webContents.send('llm-error', { error });
            mascotWindow?.getWindow()?.webContents.send('llm-error', { error });
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

// memory関連
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

// voicevox関連
// IPC: 音声認識開始
ipcMain.handle('voice-start', async () => {
    if (!voiceEnabled) {
        return { success: false, error: 'Voice system not enabled' };
    }
    microphoneCapture.startListening();
    return { success: true };
});

// IPC: 音声認識停止
ipcMain.handle('voice-stop', async () => {
    if (!voiceEnabled) {
        return { success: false, error: 'Voice system not enabled' };
    }
    microphoneCapture.stop();
    return { success: true };
});

// IPC: 音声認識状態取得
ipcMain.handle('voice-status', async () => {
    return {
        enabled: voiceEnabled,
        state: voiceEnabled ? microphoneCapture.getState() : 'disabled',
    };
});

// voicevox関連
// IPC: テキスト読み上げ
ipcMain.handle('tts-speak', async (_event, text: string) => {
    if (!ttsEnabled) {
        return { success: false, error: 'TTS not available' };
    }

    try {
        const audioBuffer = await voicevoxProvider.synthesize(text);
        await audioPlayer.play(audioBuffer);
        return { success: true };
    } catch (error) {
        console.error('[TTS] Speak failed:', error);
        return { success: false, error: String(error) };
    }
});

// IPC: 読み上げ停止
ipcMain.handle('tts-stop', () => {
    if (audioPlayer) {
        audioPlayer.stop();
    }
    return { success: true };
});

// IPC: TTS状態取得
ipcMain.handle('tts-status', () => {
    return {
        enabled: ttsEnabled,
        state: ttsEnabled ? audioPlayer.getState() : 'disabled',
        speakerId: ttsEnabled ? voicevoxProvider.getSpeakerId() : null,
    };
});

// IPC: 話者一覧取得
ipcMain.handle('tts-speakers', async () => {
    if (!ttsEnabled) {
        return [];
    }
    return await voicevoxProvider.getSpeakers();
});

// IPC: 話者変更
ipcMain.handle('tts-set-speaker', (_event, speakerId: number) => {
    if (!ttsEnabled) {
        return { success: false, error: 'TTS not available' };
    }
    voicevoxProvider.setSpeaker(speakerId);
    return { success: true };
});

// IPC: 音声対話 - メインウィンドウでは無効化（Discord専用）
ipcMain.handle('dialogue-start', async () => {
    if (!voiceDialogue) {
        return { success: false, error: 'Voice dialogue not available (Discord only)' };
    }
    voiceDialogue.start();
    return { success: true };
});

ipcMain.handle('dialogue-stop', async () => {
    if (!voiceDialogue) {
        return { success: false, error: 'Voice dialogue not available (Discord only)' };
    }
    voiceDialogue.stop();
    return { success: true };
});

ipcMain.handle('dialogue-interrupt', async () => {
    if (!voiceDialogue) {
        return { success: false, error: 'Voice dialogue not available (Discord only)' };
    }
    voiceDialogue.interrupt();
    return { success: true };
});

ipcMain.handle('dialogue-status', async () => {
    if (!voiceDialogue) {
        return {
            available: false,
            active: false,
            state: 'unavailable',
        };
    }
    return {
        available: true,
        active: voiceDialogue.isDialogueActive(),
        state: voiceDialogue.getState(),
    };
});

ipcMain.handle('dialogue-set-auto-listen', async (_event, enabled: boolean) => {
    if (!voiceDialogue) {
        return { success: false, error: 'Voice dialogue not available (Discord only)' };
    }
    voiceDialogue.setAutoListen(enabled);
    return { success: true };
});

// IPC: Discord Bot state
ipcMain.handle('discord-status', () => {
    if (!discordBot) {
        return { available: false, state: 'disabled' };
    }
    return {
        available: true,
        state: discordBot.getState(),
    };
});

// IPC: Discord Bot start
ipcMain.handle('discord-start', async () => {
    if (!discordBot) {
        return { success: false, error: 'Discord Bot not configured' };
    }
    try {
        await discordBot.start();
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// IPC: Discord Bot stop
ipcMain.handle('discord-stop', async () => {
    if (!discordBot) {
        return { success: false, error: 'Discord Bot not configured' };
    }
    try {
        await discordBot.stop();
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// IPC: Message send to Discord
ipcMain.handle('discord-send', async (_event, channelId: string, content: string) => {
    if (!discordBot) {
        return { success: false, error: 'Discord Bot not configured' };
    }
    try {
        await discordBot.sendMessage(channelId, content);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// IPC: Discord音声チャンネルに参加
ipcMain.handle('discord-voice-join', async (_event, channelId: string, guildId: string) => {
    if (!discordBot) {
        return { success: false, error: 'Discord Bot not configured' };
    }
    try {
        await discordBot.joinVoiceChannel(channelId, guildId);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// IPC: Discord音声チャンネルから退出
ipcMain.handle('discord-voice-leave', () => {
    if (!discordBot) {
        return { success: false, error: 'Discord Bot not configured' };
    }
    discordBot.leaveVoiceChannel();
    return { success: true };
});

// IPC: Discord音声チャンネル情報取得
ipcMain.handle('discord-voice-info', async () => {
    if (!discordBot) {
        return null;
    }
    return await discordBot.getVoiceChannelInfo();
});

// IPC: Discord音声接続状態
ipcMain.handle('discord-voice-status', () => {
    if (!discordBot) {
        return { connected: false };
    }
    return { connected: discordBot.isVoiceConnected() };
});

// IPC: マスコット関連
ipcMain.handle('mascot-open-main', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
    // マスコットウィンドウを非表示にする
    if (mascotWindow) {
        mascotWindow.hide();
    }
});

ipcMain.handle('mascot-hide', () => {
    if (mascotWindow) {
        mascotWindow.hide();
    }
});

ipcMain.handle('mascot-toggle', () => {
    if (mascotWindow) {
        mascotWindow.toggle();
    }
});

ipcMain.handle('mascot-show', () => {
    if (!mascotWindow) {
        createMascotWindow();
    } else {
        mascotWindow.show();
    }
    // メインウィンドウを非表示にする
    if (mainWindow) {
        mainWindow.hide();
    }
});

// IPC: イベントシステム統計
ipcMain.handle('events-stats', () => {
    return {
        bus: eventBus.getStats(),
        idle: idleDetector.getState(),
        timers: timerTrigger.list(),
    };
});

// IPC: イベント発行（デバッグ用）
ipcMain.handle('events-publish', (_event, type: string, data: any) => {
    eventBus.publish({
        type: type as any,
        priority: EventPriority.NORMAL,
        timestamp: Date.now(),
        data,
    });
    return { success: true };
});

// IPC: 自律行動統計
ipcMain.handle('autonomous-stats', () => {
    return autonomousController.getStats();
});

// IPC: 自律行動有効/無効
ipcMain.handle('autonomous-set-enabled', (_event, enabled: boolean) => {
    autonomousController.setEnabled(enabled);
    return { success: true };
});

// IPC: 画面認識統計
ipcMain.handle('screen-stats', () => {
    return screenRecognitionController.getStats();
});

// IPC: 画面認識設定
ipcMain.handle('screen-set-enabled', (_event, enabled: boolean) => {
    screenRecognitionController.updateConfig({ enabled });
    if (enabled) {
        screenRecognitionController.start();
    } else {
        screenRecognitionController.stop();
    }
    return { success: true };
});

// IPC: 現在のコンテキスト取得
ipcMain.handle('screen-get-context', () => {
    return screenRecognitionController.getCurrentContext();
});

// IPC: 常時リスニング制御
ipcMain.handle('always-on-start', async () => {
    if (!alwaysOnListener) {
        return { success: false, error: 'AlwaysOnListener not available' };
    }
    try {
        await alwaysOnListener.start();
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle('always-on-stop', async () => {
    if (!alwaysOnListener) {
        return { success: false, error: 'AlwaysOnListener not available' };
    }
    alwaysOnListener.stop();
    return { success: true };
})

ipcMain.handle('always-on-status', () => {
    if (!alwaysOnListener) {
        return { available: false };
    }
    return {
        available: true,
        ...alwaysOnListener.getStatus(),
    };
});

ipcMain.handle('stt-switch-provider', async (_event, type: 'whisper-cpp' | 'faster-whisper') => {
    if (!sttRouter) {
        return { success: false, error: 'STTRouter not available' };
    }
    const success = await sttRouter.switchProvider(type);
    return { success, activeProvider: sttRouter.getActiveProvider() };
});

// ============================================================
// Discord ユーザー管理
// ============================================================

ipcMain.handle('discord-users-get-all', () => {
    try {
        const userManager = getDiscordUserManager();
        return userManager.getAllUsers();
    } catch (error) {
        console.error('[IPC] discord-users-get-all error:', error);
        return [];
    }
});

ipcMain.handle('discord-users-stats', () => {
    try {
        const userManager = getDiscordUserManager();
        const stats = userManager.getStats();
        return {
            totalUsers: stats.total,
            namedUsers: stats.named,
            admin: stats.admin,
        };
    } catch (error) {
        console.error('[IPC] discord-users-stats error:', error);
        return { totalUsers: 0, namedUsers: 0, admin: null };
    }
});

ipcMain.handle('discord-users-get', (_event, discordId: string) => {
    try {
        const userManager = getDiscordUserManager();
        return userManager.getUser(discordId);
    } catch (error) {
        console.error('[IPC] discord-users-get error:', error);
        return null;
    }
});

ipcMain.handle('discord-users-set-name', (_event, discordId: string, name: string) => {
    try {
        const userManager = getDiscordUserManager();
        const success = userManager.setName(discordId, name);
        return { success };
    } catch (error) {
        console.error('[IPC] discord-users-set-name error:', error);
        return { success: false, error: String(error) };
    }
});

app.whenReady().then(async () => {
    // ============================================================
    // 設定システムの初期化（最初に実行）
    // ============================================================
    // config/default.json と config/config.json を読み込み、
    // 環境変数で上書きした設定を生成します。
    // 以降のモジュール初期化で config オブジェクトを参照します。
    await initConfig();
    console.log('[App] Configuration loaded');

    // LLMルーター初期化（設定を使用）
    llmRouter = new LLMRouter(config.llm);
    console.log(`[App] LLM Router initialized(preference: ${config.llm.preference})`);

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
    // マスコットウィンドウを最初に作成・表示
    createMascotWindow();
    // メインウィンドウは非表示で起動（管理モード用）
    if (mainWindow) {
        mainWindow.hide();
    }
    // 定期メンテナンス（設定ファイルで間隔を変更可能）
    maintenanceTimer = setInterval(async () => {
        try {
            await memoryLifecycle.runMaintenance();
        } catch (error) {
            console.error('[App] Maintenance failed:', error);
        }
    }, config.memory.lifecycle.maintenanceIntervalMs);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    try {
        // whisperProvider = new WhisperProvider('base');
        // await whisperProvider.initialize();
        sttRouter = new STTRouter('faster-whisper');
        await sttRouter.initialize();



        microphoneCapture = new MicrophoneCapture();
        microphoneCapture.initialize();

        // 音声認識開始
        microphoneCapture.on('audioCapture', async (audioBuffer: Buffer) => {
            try {
                const result = await sttRouter.transcribe(audioBuffer, 16000);

                // Rendererに音声認識結果を送信
                mainWindow?.webContents.send('voice-transcription', { text: result.text });
            } catch (error) {
                console.error(`[Voice] Transcription failed: ${error} `);
                mainWindow?.webContents.send('voice-error', { error: String(error) });
            }
        });

        microphoneCapture.on('stateChange', (state: CaptureState) => {
            mainWindow?.webContents.send('voice-state', { state });
        });

        voiceEnabled = true;
        console.log('[App] Voice system initialized');
    } catch (error) {
        console.error('[App] Voice system initialization failed:', error);
        voiceEnabled = false;
    }

    try {
        // 設定ファイルからVOICEVOX設定を読み込み
        voicevoxProvider = new VoicevoxProvider(config.tts.voicevox);
        await voicevoxProvider.initialize();

        audioPlayer = new AudioPlayer();

        audioPlayer.on('stateChange', (state) => {
            mainWindow?.webContents.send('tts-state', { state });
            mascotWindow?.getWindow()?.webContents.send('tts-state', { state });
        });

        ttsEnabled = true;
        console.log('[App] TTS system initialized');
    } catch (error) {
        console.log('[App] TTS system not available:', error);
        ttsEnabled = false;
    }

    // 音声対話コントローラの初期化 - 無効化（Discord専用に変更）
    // メインウィンドウはテキストチャットのみ、音声機能はDiscord/マスコットウィンドウで使用
    // 音声対話コントローラの初期化 - (Discord連携のために有効化)
    // if (voiceEnabled && ttsEnabled) {
    voiceDialogue = new VoiceDialogueController(
        microphoneCapture,
        sttRouter,
        voicevoxProvider,
        audioPlayer,
    );

    // LLMハンドラー設定
    voiceDialogue.setLLMHandler(async (userText: string) => {
        return await processVoiceMessage(userText);
    });

    // Rendererに音声認識結果を送信
    voiceDialogue.on('stateChange', (state: DialogueState) => {
        mainWindow?.webContents.send('voice-dialogue-state', { state });
    });

    voiceDialogue.on('userSpeech', (text: string) => {
        mainWindow?.webContents.send('dialogue-user-speech', { text });
    });

    voiceDialogue.on('assistantResponse', (text: string) => {
        mainWindow?.webContents.send('dialogue-assistant-response', { text });
    });

    voiceDialogue.on('error', (error: string) => {
        mainWindow?.webContents.send('dialogue-error', { error });
    });

    console.log('[App] Voice dialogue controller initialized');
    // }
    console.log('[App] Main window: Text chat only (voice disabled)');

    // Discord Botの初期化
    const discordToken = process.env.DISCORD_BOT_TOKEN;
    if (discordToken) {
        try {
            discordBot = new DiscordBot({
                token: discordToken,
                prefix: config.discord.prefix,
            });

            // admin設定を注入
            if (config.discord.admin && config.discord.admin.id && config.discord.admin.name) {
                discordBot.setAdminConfig(config.discord.admin);
            }

            // text message handler setting
            discordBot.setMessageHandler(processDiscordMessage);
            // voice message handler setting
            discordBot.setVoiceMessageHandler(processDiscordVoiceMessage);

            // Discord用ストリーミングTTSコントローラの初期化
            if (ttsEnabled) {
                discordStreamingTTS = new StreamingTTSController(
                    voicevoxProvider,
                    undefined, // ローカルプレイヤーは使わない
                    async (buffer) => {
                        if (discordBot) {
                            await discordBot.playAudio(buffer);
                        }
                    }
                );
                discordStreamingTTS.on('sentenceDetected', (data) => {
                    console.log(`[DiscordStreamingTTS] Sentence: "${data.text}"`);
                });
                discordStreamingTTS.on('error', (data) => {
                    console.error('[DiscordStreamingTTS] Error:', data.error);
                });
                console.log('[App] Discord StreamingTTS initialized');
            }

            // voice response event - ストリーミングTTSで処理するため無効化
            // Note: processDiscordVoiceMessage内でストリーミングTTSを使用するため、
            // このイベントハンドラは不要になりました
            /*
            discordBot.on('voiceResponse', async (data: { text: string; targetUserId: string; targetUsername: string }) => {
                if (ttsEnabled && discordBot) {
                    try {
                        const audioBuffer = await voicevoxProvider.synthesize(data.text);

                        // 再生開始通知
                        const playingState = { state: 'playing' };
                        mascotWindow?.getWindow()?.webContents.send('tts-state', playingState);

                        await discordBot.playAudio(audioBuffer);

                        // 再生終了通知
                        const idleState = { state: 'idle' };
                        mascotWindow?.getWindow()?.webContents.send('tts-state', idleState);
                    } catch (error) {
                        console.error('[Discord] TTS failed:', error);
                        // エラー時もidleに戻す
                        mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'idle' });
                    }
                }
            });
            */

            // transport event to Renderer
            discordBot.on('ready', (tag: string) => {
                mainWindow?.webContents.send('discord-ready', { tag });
                // initialize voice function
                discordBot?.initializeVoice();
            });

            discordBot.on('message', (ctx: DiscordMessageContext) => {
                mainWindow?.webContents.send('discord-message', ctx);
            });

            discordBot.on('voiceReceived', (audio: IdentifiedAudio) => {
                mainWindow?.webContents.send('discord-voice-received', {
                    userId: audio.userId,
                    username: audio.username,
                    audioLength: audio.audioBuffer.length,
                });
            });

            discordBot.on('voiceConnected', (info) => {
                mainWindow?.webContents.send('discord-voice-connected', info);
            });

            discordBot.on('voiceDisconnected', (info) => {
                mainWindow?.webContents.send('discord-voice-disconnected', info);
            });

            discordBot.on('error', (error: Error) => {
                mainWindow?.webContents.send('discord-error', { error: error.message });
            });

            // execute Bot
            await discordBot.start();
            console.log('[App] Discord Bot initialized');
        } catch (error) {
            console.error('[App] Discord Bot initialization failed:', error);
            discordBot = null;
        }
    } else {
        console.log('[App] DISCORD_BOT_TOKEN not set, Discord Bot disabled');
        discordBot = null;
    }

    // ============================================================
    // イベント駆動システムの初期化
    // ============================================================

    // イベントハンドラの登録（全イベントをログ）
    eventBus.register('*', (event: AgentEvent) => {
        console.log(`[Event] ${event.type}: `, event.data);
    }, EventPriority.LOW);

    // アイドル検出の開始
    const idleConfig = getIdleDetectorConfig();
    idleDetector.start(idleConfig);

    // アイドルイベントをRendererに転送
    eventBus.register('system:idle', (event: AgentEvent) => {
        mainWindow?.webContents.send('system-idle', event.data);
        console.log('[App] User is idle, notifying renderer');
    }, EventPriority.NORMAL);

    eventBus.register('system:active', (event: AgentEvent) => {
        mainWindow?.webContents.send('system-active', event.data);
        console.log('[App] User is active again, notifying renderer');
    }, EventPriority.NORMAL);

    // 定期タイマーの例（1時間ごと）
    timerTrigger.register({
        name: 'hourly-check',
        intervalMs: 60 * 60 * 1000,
        priority: EventPriority.LOW,
    });

    console.log('[App] Event system initialized');

    // ============================================================
    // 自律行動コントローラの初期化
    // ============================================================

    // システムプロンプトを設定
    // システムプロンプトを設定（プレースホルダー禁止を明示）
    const autonomousSystemPrompt = config.prompts.system + `
\n【重要】
相手の名前がわからない場合でも、「〇〇さん」や「ユーザーさん」といったプレースホルダーは絶対に使わないでください。
その場合は「きみ」や「あなた」と呼ぶか、名前を呼ばずに話しかけてください。
固有名詞が不明な場合も「〇〇」と表現せず、「それ」や「あれ」などの代名詞を使ってください。`;
    autonomousController.setSystemPrompt(autonomousSystemPrompt);

    // LLMハンドラを設定（新形式：システムプロンプト + ユーザーメッセージ）
    autonomousController.setLLMHandler(async (systemPrompt: string, userMessage: string) => {
        return new Promise((resolve, reject) => {
            let response = '';
            llmRouter.sendMessageStream(
                [
                    { role: 'user', content: `${systemPrompt} \n\n${userMessage} ` }
                ],
                {
                    onToken: (token) => { response += token; },
                    onDone: () => resolve(response),
                    onError: (error) => reject(new Error(error)),
                }
            );
        });
    });

    // 発話状態チェッカーを設定
    autonomousController.setIsSpeakingChecker(() => {
        // Discordでの発話チェック
        if (discordBot && discordBot.isSpeaking()) {
            return true;
        }

        // ストリーミングTTSでの発話チェック
        if (discordStreamingTTS && discordStreamingTTS.isSpeaking()) {
            return true;
        }

        return false;
    });

    // 自律行動イベントをRendererに転送
    autonomousController.on('action', (data) => {
        mainWindow?.webContents.send('autonomous-action', data);

        // TTSが有効なら読み上げ
        if (ttsEnabled && data.message) {
            voicevoxProvider.synthesize(data.message)
                .then(audio => {
                    audioPlayer.play(audio);
                    // 音声対話コントローラに通知（無視検出タイマー開始、ソース=voice）
                    voiceDialogue?.notifyAgentSpoke('voice');
                })
                .catch(err => console.error('[Autonomous] TTS failed:', err));
        }
    });

    // デバッグイベントをRendererに転送
    autonomousController.on('debug', (data) => {
        mainWindow?.webContents.send('autonomous-debug', data);
    });

    // DiscordハンドラをautonomousControllerに設定
    if (discordBot) {
        // Discordへの自律発話送信ハンドラ
        autonomousController.setDiscordHandler(async (message: string, options?: { channelId?: string }) => {
            if (!discordBot) return;

            // チャンネルIDはDiscordBot側で適切に解決させる（指定がなければ最後のアクティブチャンネル）
            await discordBot.sendAutonomousMessage(message, { channelId: options?.channelId });

            // 自律発話を行ったので無視判定タイマーを開始（ソース=discord）
            voiceDialogue?.notifyAgentSpoke('discord');
        });

        // Discord音声チャンネルでの自律発話TTS
        discordBot.on('autonomousVoice', async (data: { text: string }) => {
            if (ttsEnabled && discordBot) {
                try {
                    const audioBuffer = await voicevoxProvider.synthesize(data.text);

                    // 再生開始通知
                    mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'playing' });

                    await discordBot.playAudio(audioBuffer);
                    console.log('[App] Autonomous voice played in Discord');

                    // 再生終了通知
                    mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'idle' });
                } catch (error) {
                    console.error('[App] Autonomous Discord TTS failed:', error);
                    mascotWindow?.getWindow()?.webContents.send('tts-state', { state: 'idle' });
                }
            }
        });

        console.log('[App] Autonomous controller connected to Discord');
    }

    // 自律チェック用タイマー（10分ごと）
    timerTrigger.register({
        name: 'autonomous-check',
        intervalMs: 10 * 60 * 1000,
        priority: EventPriority.LOW,
    });

    console.log('[App] Autonomous controller initialized');

    // ============================================================
    // 画面認識システムの初期化
    // ============================================================

    // LLMテキストハンドラを設定
    screenRecognitionController.setLLMTextHandler(async (prompt: string) => {
        return new Promise((resolve, reject) => {
            let response = '';
            llmRouter.sendMessageStream(
                [{ role: 'user', content: prompt }],
                {
                    onToken: (token) => { response += token; },
                    onDone: () => resolve(response),
                    onError: (error) => reject(new Error(error)),
                }
            );
        });
    });

    // 画面認識イベントをRendererに転送
    screenRecognitionController.on('contextChange', (context: ScreenContext) => {
        mainWindow?.webContents.send('screen-context-change', context);
    });

    screenRecognitionController.on('reaction', (data) => {
        mainWindow?.webContents.send('screen-reaction', data);

        // TTSが有効なら読み上げ
        if (ttsEnabled && data.message) {
            voicevoxProvider.synthesize(data.message)
                .then(audio => audioPlayer.play(audio))
                .catch(err => console.error('[ScreenRecognition] TTS failed:', err));
        }
    });

    // 画面認識を開始（ウィンドウ監視のみ，スクリーンショットは無効）
    screenRecognitionController.start({
        windowMonitorEnabled: true,
        screenshotEnabled: false,
        reactToWindowChange: true,
    });

    console.log('[App] Screen recognition initialized');

    // ============================================================
    // STTルーターの初期化
    // ============================================================
    try {
        sttRouter = new STTRouter('faster-whisper');
        await sttRouter.initialize();
        console.log(`[App] ATT initialized: ${sttRouter.getActiveProvider()} `);
    } catch (error) {
        console.error('[App] ATT initialization failed:', error);
    }

    // 常時リスニングを設定（DiscordBot起動後）
    if (discordBot && sttRouter && voicevoxProvider) {
        const listenerConfig: ListenerConfig = {
            enabled: true,
            respondToAllUsers: true,
        };

        alwaysOnListener = new AlwaysOnListener(
            discordBot,
            sttRouter,
            voicevoxProvider,
            listenerConfig
        );

        // LLMハンドラを設定
        alwaysOnListener.setLLMHandler(async (text, UserContextMenuCommandInteraction, username) => {
            // 会話履歴に追加
            if (!activeConversationId) {
                const conv = await conversationStorage.create(`Discord: ${username} `);
                activeConversationId = conv.id;
            }

            const messageWithSpeaker = `[${username}]: ${text} `;
            await conversationStorage.addMessage(activeConversationId, 'user', messageWithSpeaker);

            // 記憶検索+LLM呼び出し
            const context = await memoryManager.buildContextForPrompt(text);
            const conversation = await conversationStorage.load(activeConversationId);
            const history: LLMMessage[] = conversation!.messages.map(m => ({
                role: m.role,
                content: m.content,
            }));

            // システムプロンプトに発言者情報を追加
            const systemPrompt = config.prompts.system + `
【現在の対話相手】
名前: ${username}
この人の名前は「${username}」です。名前の代わりに「あなた」や「きみ」と呼んでも構いません。状況に合わせてあなたが面白いと思う対応をしてください。

【重要】
相手の名前がわからない場合でも、「〇〇さん」や「ゼロゼロさん」といったプレースホルダーは絶対に使わないでください。
その場合は「きみ」と呼ぶか、名前を呼ばずに話しかけてください。
固有名詞が不明な場合も「〇〇」と表現せず、「それ」や「あれ」などの代名詞を使ってください。`;

            // 履歴の先頭にシステムプロンプトを追加
            history.unshift({ role: 'user', content: systemPrompt });
            history.unshift({ role: 'assistant', content: 'わかりました。' });

            let response = '';
            await new Promise<void>((resolve, reject) => {
                llmRouter.sendMessageStream(history, {
                    onToken: (token) => {
                        response += token;
                        mascotWindow?.getWindow()?.webContents.send('llm-token', { token });
                    },
                    onDone: async (fullText) => {
                        response = fullText;
                        await conversationStorage.addMessage(activeConversationId!, 'assistant', fullText);
                        mascotWindow?.getWindow()?.webContents.send('llm-done', { fullText });
                        resolve();
                    },
                    onError: (error) => reject(new Error(error)),
                });
            });

            return response;
        });

        // イベントをrendererに転送
        alwaysOnListener.on('transcribed', (data: any) => {
            mainWindow?.webContents.send('always-on-transcribed', data);
        });

        alwaysOnListener.on('response', (data: any) => {
            mainWindow?.webContents.send('always-on-response', data);
        });

        alwaysOnListener.on('spoken', (data: any) => {
            mainWindow?.webContents.send('always-on-spoken', data);
        });

        console.log('[App] AlwaysOnListener initialized');
    }
});

app.on('before-quit', async () => {
    console.log('[App] Stopping background services...');

    // メンテナンスタイマーを停止
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
    }

    // イベント発生源を停止
    idleDetector.stop();
    timerTrigger.stopAll();

    // 監視系を停止
    activeWindowMonitor.stop();
    screenRecognitionController.stop();

    if (voiceDialogue) {
        voiceDialogue.stop();
    }

    if (microphoneCapture) {
        microphoneCapture.stop();
    }

    if (discordBot) {
        await discordBot.stop();
    }

    mascotWindow?.destroy();

    console.log('[App] Cleanup complete');
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
