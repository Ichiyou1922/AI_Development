import { LLMMessage, LLMProvider, StreamCallbacks } from "./types.js";
import { OllamaProvider } from "./ollama.js";
import { AnthropicProvider } from "./anthropic.js";
import { ToolRegistry } from "./tools/index.js";
import { LLMConfig } from "../config/index.js";

export type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';

/**
 * LLMルーター
 *
 * 複数のLLMプロバイダを管理し、設定に基づいて適切なプロバイダを選択します。
 *
 * 設定の変更方法:
 * - config/config.json の llm セクションを編集
 * - llm.preference でプロバイダの優先順位を設定
 */
export class LLMRouter {
    private providers: LLMProvider[] = [];
    private preference: ProviderPreference;
    private toolRegistry: ToolRegistry;

    /**
     * @param llmConfig - LLM設定（configLoader から取得）
     *
     * 使用例:
     * ```typescript
     * import { config } from '../config/index.js';
     * const router = new LLMRouter(config.llm);
     * ```
     *
     * 後方互換性のため、文字列でも初期化可能:
     * ```typescript
     * const router = new LLMRouter('local-first');
     * ```
     */
    constructor(configOrPreference?: LLMConfig | ProviderPreference) {
        this.toolRegistry = new ToolRegistry();

        // 後方互換性: 文字列が渡された場合は従来の動作
        if (typeof configOrPreference === 'string' || configOrPreference === undefined) {
            this.preference = configOrPreference ?? 'local-first';
            // デフォルト設定でプロバイダを初期化
            this.providers.push(new OllamaProvider());
            this.providers.push(new AnthropicProvider(process.env.ANTHROPIC_API_KEY, this.toolRegistry));
        } else {
            // 新しい設定オブジェクトからプロバイダを初期化
            const llmConfig = configOrPreference;
            this.preference = llmConfig.preference;
            this.providers.push(new OllamaProvider(llmConfig.ollama));
            this.providers.push(new AnthropicProvider(process.env.ANTHROPIC_API_KEY, this.toolRegistry, llmConfig.anthropic));
        }
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