declare global {
  interface ElectronAPI {
    sendMessageStream(message: string): Promise<{ started: boolean }>;
    getProviderPreference(): Promise<string>;
    setProviderPreference(preference: string): Promise<void>;
    clearHistory(): Promise<void>;
    onLLMToken(callback: (token: string) => void): void;
    onLLMDone(callback: (fullText: string) => void): void;
    onLLMError(callback: (error: string) => void): void;
    removeLLMListeners(): void;
    removeAllListeners(): void;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
