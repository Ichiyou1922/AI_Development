import { LLMProvider, LLMMessage, LLMResponse, StreamCallbacks  } from "./types.js";

export class OllamaProvider implements LLMProvider {
    name = 'ollama';
    private baseUrl: string;
    private model: string;

    constructor(model: string = 'llama3.1:8b', baseUrl: string = 'http://localhost:11434') {
        this.model = model;
        this.baseUrl = baseUrl;
    }

    async sendMessage(messages: LLMMessage[]): Promise<LLMResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: false,
                }),
            });

            if (!response.ok) {
                return { success: false, error: `HTTP ${response.status}` };
            }

            const data = await response.json();
            return {
                success: true,
                text: data.message?.content || '',
                provider: 'ollama',
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    async sendMessageStream(
        messages: LLMMessage[],
        callbacks: StreamCallbacks,
        signal?: AbortSignal
    ): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: true,
                }),
                signal, // キャンセル用
            });

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            // ストリームを読み続ける
            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                // chunkは複数行を含む可能性
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    const data = JSON.parse(line);
                    const token = data.message.content;
                    callbacks.onToken(token);
                    fullText += token;
                }  
            }

            callbacks.onDone(fullText);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            callbacks.onError(message);
            throw error;
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}