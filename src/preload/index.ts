import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    ping: () => 'pong',
    sendMessage: (message: string) => ipcRenderer.invoke('send-message', message),
});