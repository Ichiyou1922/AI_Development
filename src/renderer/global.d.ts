declare global {
  type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';

  interface ElectronAPI {
    // 会話管理
    conversationCreate: (title?: string) => Promise<Conversation>;
    conversationList: () => Promise<ConversationMeta[]>;
    conversationLoad: (id: string) => Promise<Conversation | null>;
    conversationDelete: (id: string) => Promise<{ success: boolean }>;
    conversationGetActive: () => Promise<string | null>;

    // メッセージ送信
    sendMessageStream: (message: string) => Promise<{ started: boolean }>;
    onLLMToken: (callback: (token: string) => void) => void;
    onLLMDone: (callback: (fullText: string) => void) => void;
    onLLMError: (callback: (error: string) => void) => void;
    removeLLMListeners: (channel: string) => void;

    // プロバイダ設定
    getProviderPreference: () => Promise<ProviderPreference>;
    setProviderPreference: (preference: ProviderPreference) => Promise<{ success: boolean }>;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }

  interface ConversationMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }

  interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
  }
}

export { };
