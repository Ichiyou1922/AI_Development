export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' ;
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
    sendMessageStream?(
        messages: LLMMessage[],
        callback: StreamCallbacks,
        signal?: AbortSignal
    ): Promise<void>;
    isAvailable(): Promise<boolean>;
}

export interface StreamCallbacks {
    onToken: (token: string) => void;
    onDone: (fullText: string) => void;
    onError: (error: string) => void;
}
