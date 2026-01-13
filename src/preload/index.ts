import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    sendMessage: (message: string) => ipcRenderer.invoke('send-message', message),
    getProviderPreference: () => ipcRenderer.invoke('get-provider-preference'),
    setProviderPreference: (preference: string) => ipcRenderer.invoke('set-provider-preference', preference),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
    sendMessageStream: (message: string) => ipcRenderer.invoke('send-message-stream', message),
    onLLMToken: (callback: (token: string) => void) => {
        ipcRenderer.on('llm-token', (_event, data) => callback(data.token));
    },
    onLLMDone: (callback: (fullText: string) => void) => {
        ipcRenderer.on('llm-done', (_event, data) => callback(data.fullText));
    },
    onLLMError: (callback: (error: string) => void) => {
        ipcRenderer.on('llm-error', (_event, data) => callback(data.error));
    },
    // リスナー削除（メモリリーク防止のため）
    removeLLMListeners: () => {
        ipcRenderer.removeAllListeners('llm-token');
        ipcRenderer.removeAllListeners('llm-done');
        ipcRenderer.removeAllListeners('llm-error');
    },
    // 互換性のための別名
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('llm-token');
        ipcRenderer.removeAllListeners('llm-done');
        ipcRenderer.removeAllListeners('llm-error');
    },
});