export interface LLMMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface LLMResponse {
    success: boolean;
    text?: string;
    error?: string;
    provider?: 'anthropic' | 'ollama';
}

export interface LLMProvider {
    name: string;
    sendMessage(messages: LLMMessage[]): Promise<LLMResponse>;
    isAvailable(): Promise<boolean>;
}