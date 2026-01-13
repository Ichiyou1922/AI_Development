import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, StreamCallbacks } from './types.js';

export class AnthropicProvider implements LLMProvider {
    name = 'anthropic';
    private client: Anthropic;

    constructor(apiKey: string | undefined) {
        this.client = new Anthropic({ apiKey });
    }

    // 非ストリーミング sendMessage を削除。ストリーミング sendMessageStream を使用。

    async sendMessageStream(
        messages: LLMMessage[], 
        callbacks: StreamCallbacks, 
        signal?: AbortSignal
    ): Promise<void> {
        try {
            const stream = await this.client.messages.stream({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                })),
            });

            if(signal) {
                signal.addEventListener('abort', () => {
                    stream.abort();
                });
            }

            stream.on('text', (text) => {
                callbacks.onToken(text);
            });

            const finalMessage = await stream.finalMessage();
            const content = finalMessage.content[0];
            const fullText = content.type === 'text' ? content.text : '';
            callbacks.onDone(fullText);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            callbacks.onError(message);
            throw error;
        }
    }

    async isAvailable(): Promise<boolean> {
        // APIキーが設定されているかチェック
        return !!process.env.ANTHROPIC_API_KEY;
    }
}