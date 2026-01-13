declare global {
  interface ElectronAPI {
    sendMessage(message: string): Promise<{ success: boolean; text?: string; error?: string; provider?: string }>;
    sendMessageStream(message: string): Promise<void>;
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
