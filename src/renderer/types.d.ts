interface ElectronAPI {
  ping: () => string;
  sendMessage: (message: string) => Promise<{
    success: boolean;
    text?: string;
    error?: string;
  }>;
}

interface Window {
  electronAPI: ElectronAPI;
}