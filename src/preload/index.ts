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
});