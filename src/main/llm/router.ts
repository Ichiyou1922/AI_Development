import { LLMMessage, LLMProvider, StreamCallbacks } from "./types.js";
import { OllamaProvider } from "./ollama.js";
import { AnthropicBeta } from "@anthropic-ai/sdk/resources";
import { AnthropicProvider } from "./anthropic.js";

export type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';

export class LLMRouter {
    private providers: LLMProvider[] = [];
    private preference: ProviderPreference;

    constructor(preference: ProviderPreference = 'local-first') {
        this.preference = preference;

        // プロバイダ登録
        this.providers.push(new OllamaProvider());
        this.providers.push(new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    }

    // 非ストリーミング sendMessage は削除。ストリーミングのみ使用。

    async sendMessageStream(
        messages: LLMMessage[],
        callbacks: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<void> {
        const orderedProviders = this.getOrderedProviders();

        for (const provider of orderedProviders) {
            if (!await provider.isAvailable()) continue;
            if (!provider.sendMessageStream) {
                console.log(`[LLMRouter] ${provider.name} is not available, skipping`);
                continue;
            }

            try {
                await provider.sendMessageStream(messages, callbacks, signal);
                return;
            } catch (error) {
                console.log(`[LLMRouter] ${provider.name} streaming failed`, error);
            }
        }

        callbacks.onError('All providers failed or no streaming support');
    }

    private getOrderedProviders(): LLMProvider[] {
        const ollama = this.providers.find(p => p.name === 'ollama')!;
        const anthropic = this.providers.find(p => p.name === 'anthropic')!;

        switch (this.preference) {
            case 'local-first':
                return [ollama, anthropic];
            case 'api-first':
                return[anthropic, ollama];
            case 'local-only':
                return [ollama];
            case 'api-only':
                return [anthropic];
        }
    }

    setPreference(preference: ProviderPreference): void {
        this.preference = preference;
    }

    getPreference(): ProviderPreference {
        return this.preference;
    }
}