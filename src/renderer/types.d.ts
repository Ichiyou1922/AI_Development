import { StreamCallbacks } from "../main/llm/types";

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
  getProviderPreference: () => Promise<ProviderPreference>;
  setProviderPreference: (preference: ProviderPreference) => Promise<{ success: boolean }>;
  clearHistory: () => Promise<{ success: boolean }>;

  sendMessageStream: (message: string) => Promise<{ started: boolean }>;
  onLLMToken: (callback: (token: string) => void) => void;
  onLLMDone: (callback: (fullText: string) => void) => void;
  onLLMError: (callback: (error: string) => void) => void;
  removeAllLLMListeners: () => void;
}

interface Window {
  electronAPI: ElectronAPI;
}