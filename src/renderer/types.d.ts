// グローバルな型定義（モジュールにしない）
type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';

interface LLMResponse {
  success: boolean;
  text?: string;
  error?: string;
  provider?: 'anthropic' | 'ollama';
}

// 型だけ
interface ElectronAPI {
  sendMessage: (message: string) => Promise<LLMResponse>;
  getProviderPreference: () => Promise<ProviderPreference>;
  setProviderPreference: (preference: ProviderPreference) => Promise<{ success: boolean }>;
  clearHistory: () => Promise<{ success: boolean }>;
}

interface Window {
  electronAPI: ElectronAPI;
}