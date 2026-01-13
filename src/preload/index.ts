import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    sendMessage: (message: string) => ipcRenderer.invoke('send-message', message),
    getProviderPreference: () => ipcRenderer.invoke('get-provider-preference'),
    setProviderPreference: (preference: string) => ipcRenderer.invoke('set-provider-preference', preference),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
});