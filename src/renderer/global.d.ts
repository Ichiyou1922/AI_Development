declare global {
  type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';
  type CaptureState = 'idle' | 'listening' | 'recording' | 'processing' | 'disabled';
  interface ElectronAPI {
    // 会話管理
    conversationCreate: (title?: string) => Promise<Conversation>;
    conversationList: () => Promise<ConversationMeta[]>;
    conversationLoad: (id: string) => Promise<Conversation | null>;
    conversationDelete: (id: string) => Promise<{ success: boolean }>;
    conversationGetActive: () => Promise<string | null>;

    // メッセージ送信
    sendMessageStream: (message: string) => Promise<{ started: boolean }>;
    onLLMToken: (callback: (token: string) => void) => void;
    onLLMDone: (callback: (fullText: string) => void) => void;
    onLLMError: (callback: (error: string) => void) => void;
    removeLLMListeners: (channel: string) => void;

    // プロバイダ設定
    getProviderPreference: () => Promise<ProviderPreference>;
    setProviderPreference: (preference: ProviderPreference) => Promise<{ success: boolean }>;

    // 記憶管理
    memoryAdd: (content: string, metadata: any) => Promise<any>;
    memorySearch: (query: string, limit?: number) => Promise<any[]>;
    memoryCount: () => Promise<number>;
    memoryStats: () => Promise<any>;
    memoryGetAll: () => Promise<any[]>;
    memoryClear: () => Promise<{ success: boolean }>;
    memoryMaintenance: () => Promise<any>;

    // プロファイル管理
    profileGetAll: () => Promise<any[]>;
    profileSet: (category: string, key: string, value: string) => Promise<any>;
    profileDelete: (category: string, key: string) => Promise<boolean>;
    profileClear: () => Promise<{ success: boolean }>;
    profileStats: () => Promise<any>;

    // 音声認識
    voiceStart: () => Promise<{ success: boolean; error?: string }>;
    voiceStop: () => Promise<{ success: boolean; error?: string }>;
    voiceStatus: () => Promise<{ enabled: boolean; state: CaptureState }>;
    onVoiceTranscription: (callback: (data: { text: string }) => void) => void;
    onVoiceState: (callback: (data: { state: CaptureState }) => void) => void;
    onVoiceError: (callback: (data: { error: string }) => void) => void;

    // 音声合成
    ttsSpeak: (text: string) => Promise<{ success: boolean }>;
    ttsStop: () => Promise<{ success: boolean }>;
    ttsStatus: () => Promise<{ enabled: boolean }>;
    ttsSpeakers: () => Promise<{ speakers: any[] }>;
    ttsSetSpeaker: (speakerId: number) => Promise<{ success: boolean }>;
    onTTSState: (callback: (data: { state: string }) => void) => void;
    onTTSError: (callback: (data: { error: string }) => void) => void;

    // 音声対話
    dialogueStart: () => Promise<{ success: boolean; error?: string }>;
    dialogueStop: () => Promise<{ success: boolean; error?: string }>;
    dialogueInterrupt: () => Promise<{ success: boolean; error?: string }>;
    dialogueStatus: () => Promise<{ available: boolean; active: boolean; state: string }>;
    dialogueSetAutoListen: (enabled: boolean) => Promise<{ success: boolean }>;
    onDialogueState: (callback: (data: { state: string }) => void) => void;
    onDialogueUserSpeech: (callback: (data: { text: string }) => void) => void;
    onDialogueAssistantResponse: (callback: (data: { text: string }) => void) => void;
    onDialogueError: (callback: (data: { error: string }) => void) => void;

    // Discord Bot
    discordStatus: () => Promise<{ available: boolean; state: string }>;
    discordStart: () => Promise<{ success: boolean; error?: string }>;
    discordStop: () => Promise<{ success: boolean; error?: string }>;
    discordSend: (channelId: string, content: string) => Promise<{ success: boolean; error?: string }>;
    onDiscordReady: (callback: (data: { tag: string }) => void) => void;
    onDiscordMessage: (callback: (data: any) => void) => void;
    onDiscordError: (callback: (data: { error: string }) => void) => void;

    // Discord Voice
    discordVoiceJoin: (channelId: string, guildId: string) => Promise<{ success: boolean; error?: string }>;
    discordVoiceLeave: () => Promise<{ success: boolean }>;
    discordVoiceInfo: () => Promise<any>;
    discordVoiceStatus: () => Promise<{ connected: boolean }>;
    onDiscordVoiceReceived: (callback: (data: any) => void) => void;
    onDiscordVoiceConnected: (callback: (data: any) => void) => void;
    onDiscordVoiceDisconnected: (callback: () => void) => void;

    // Live2D
    initLive2D: () => Promise<void>;
    blinkLive2D: () => void;
    setMouthOpen: (value: number) => void;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }

  interface ConversationMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }

  interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
  }
}

export { };


