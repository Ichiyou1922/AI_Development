import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    // ============================================================
    // 会話管理
    // ============================================================
    conversationCreate: (title?: string) =>
        ipcRenderer.invoke('conversation-create', title),

    conversationList: () =>
        ipcRenderer.invoke('conversation-list'),

    conversationLoad: (id: string) =>
        ipcRenderer.invoke('conversation-load', id),

    conversationDelete: (id: string) =>
        ipcRenderer.invoke('conversation-delete', id),

    conversationGetActive: () =>
        ipcRenderer.invoke('conversation-get-active'),

    // ============================================================
    // メッセージ送信
    // ============================================================
    sendMessageStream: (message: string) =>
        ipcRenderer.invoke('send-message-stream', message),

    onLLMToken: (callback: (token: string) => void) => {
        ipcRenderer.on('llm-token', (_event, data) => callback(data.token));
    },
    onLLMDone: (callback: (fullText: string) => void) => {
        ipcRenderer.on('llm-done', (_event, data) => callback(data.fullText));
    },
    onLLMError: (callback: (error: string) => void) => {
        ipcRenderer.on('llm-error', (_event, data) => callback(data.error));
    },
    removeLLMListeners: (channel: string) => {
        ipcRenderer.removeAllListeners(channel);
    },

    // ============================================================
    // 記憶管理
    // ============================================================
    memoryAdd: (content: string, metadata: any) =>
        ipcRenderer.invoke('memory-add', content, metadata),

    memorySearch: (query: string, limit?: number) =>
        ipcRenderer.invoke('memory-search', query, limit),

    memoryCount: () =>
        ipcRenderer.invoke('memory-count'),

    memoryStats: () =>
        ipcRenderer.invoke('memory-stats'),

    memoryGetAll: () =>
        ipcRenderer.invoke('memory-get-all'),

    memoryClear: () =>
        ipcRenderer.invoke('memory-clear'),

    // ============================================================
    // プロバイダ設定
    // ============================================================
    getProviderPreference: () =>
        ipcRenderer.invoke('get-provider-preference'),

    setProviderPreference: (preference: string) =>
        ipcRenderer.invoke('set-provider-preference', preference),

    // ============================================================
    // プロファイル管理
    // ============================================================
    profileGetAll: () =>
        ipcRenderer.invoke('profile-get-all'),

    profileSet: (category: string, key: string, value: string) =>
        ipcRenderer.invoke('profile-set', category, key, value),

    profileDelete: (category: string, key: string) =>
        ipcRenderer.invoke('profile-delete', category, key),

    profileClear: () =>
        ipcRenderer.invoke('profile-clear'),

    profileStats: () =>
        ipcRenderer.invoke('profile-stats'),

    // メンテナンス
    memoryMaintenance: () =>
        ipcRenderer.invoke('memory-maintenance'),

    // ============================================================
    // 音声認識
    // ============================================================
    voiceStart: () =>
        ipcRenderer.invoke('voice-start'),

    voiceStop: () =>
        ipcRenderer.invoke('voice-stop'),

    voiceStatus: () =>
        ipcRenderer.invoke('voice-status'),

    onVoiceTranscription: (callback: (data: { text: string }) => void) => {
        ipcRenderer.on('voice-transcription', (_event, data) => callback(data));
    },

    onVoiceState: (callback: (data: { state: string }) => void) => {
        ipcRenderer.on('voice-state', (_event, data) => callback(data));
    },

    onVoiceError: (callback: (data: { error: string }) => void) => {
        ipcRenderer.on('voice-error', (_event, data) => callback(data));
    },

    // ============================================================
    // 音声合成（TTS）
    // ============================================================
    ttsSpeak: (text: string) =>
        ipcRenderer.invoke('tts-speak', text),

    ttsStop: () =>
        ipcRenderer.invoke('tts-stop'),

    ttsStatus: () =>
        ipcRenderer.invoke('tts-status'),

    ttsSpeakers: () =>
        ipcRenderer.invoke('tts-speakers'),

    ttsSetSpeaker: (speakerId: number) =>
        ipcRenderer.invoke('tts-set-speaker', speakerId),

    onTTSState: (callback: (data: { state: string }) => void) => {
        ipcRenderer.on('tts-state', (_event, data) => callback(data));
    },

    // ============================================================
    // 音声対話
    // ============================================================
    dialogueStart: () =>
        ipcRenderer.invoke('dialogue-start'),

    dialogueStop: () =>
        ipcRenderer.invoke('dialogue-stop'),

    dialogueInterrupt: () =>
        ipcRenderer.invoke('dialogue-interrupt'),

    dialogueStatus: () =>
        ipcRenderer.invoke('dialogue-status'),

    dialogueSetAutoListen: (enabled: boolean) =>
        ipcRenderer.invoke('dialogue-set-auto-listen', enabled),

    onDialogueState: (callback: (data: { state: string }) => void) => {
        ipcRenderer.on('dialogue-state', (_event, data) => callback(data));
    },

    onDialogueUserSpeech: (callback: (data: { text: string }) => void) => {
        ipcRenderer.on('dialogue-user-speech', (_event, data) => callback(data));
    },

    onDialogueAssistantResponse: (callback: (data: { text: string }) => void) => {
        ipcRenderer.on('dialogue-assistant-response', (_event, data) => callback(data));
    },

    onDialogueError: (callback: (data: { error: string }) => void) => {
        ipcRenderer.on('dialogue-error', (_event, data) => callback(data));
    },

    // ============================================================
    // Discord Bot
    // ============================================================
    discordStatus: () =>
        ipcRenderer.invoke('discord-status'),

    discordStart: () =>
        ipcRenderer.invoke('discord-start'),

    discordStop: () =>
        ipcRenderer.invoke('discord-stop'),

    discordSend: (channelId: string, content: string) =>
        ipcRenderer.invoke('discord-send', channelId, content),

    onDiscordReady: (callback: (data: { tag: string }) => void) => {
        ipcRenderer.on('discord-ready', (_event, data) => callback(data));
    },

    onDiscordMessage: (callback: (data: any) => void) => {
        ipcRenderer.on('discord-message', (_event, data) => callback(data));
    },

    onDiscordError: (callback: (data: { error: string }) => void) => {
        ipcRenderer.on('discord-error', (_event, data) => callback(data));
    },

    // Discord Voice
    discordVoiceJoin: (channelId: string, guildId: string) =>
        ipcRenderer.invoke('discord-voice-join', channelId, guildId),

    discordVoiceLeave: () =>
        ipcRenderer.invoke('discord-voice-leave'),

    discordVoiceInfo: () =>
        ipcRenderer.invoke('discord-voice-info'),

    discordVoiceStatus: () =>
        ipcRenderer.invoke('discord-voice-status'),

    onDiscordVoiceReceived: (callback: (data: any) => void) => {
        ipcRenderer.on('discord-voice-received', (_event, data) => callback(data));
    },

    onDiscordVoiceConnected: (callback: (data: any) => void) => {
        ipcRenderer.on('discord-voice-connected', (_event, data) => callback(data));
    },

    onDiscordVoiceDisconnected: (callback: () => void) => {
        ipcRenderer.on('discord-voice-disconnected', () => callback());
    },
});