import { LLMProvider, LLMMessage, StreamCallbacks } from "./types.js";
import { OllamaConfig } from "../config/index.js";

/**
 * Ollama プロバイダ
 *
 * ローカルで動作するLLMサーバー（Ollama）との通信を担当します。
 *
 * 設定の変更方法:
 * - config/config.json の llm.ollama セクションを編集
 * - または環境変数 OLLAMA_BASE_URL, OLLAMA_MODEL を設定
 */
export class OllamaProvider implements LLMProvider {
    name = 'ollama';
    private baseUrl: string;
    private model: string;
    private healthCheckTimeoutMs: number;

    /**
     * @param config - 設定オブジェクト（configLoader から取得）
     *
     * 使用例:
     * ```typescript
     * import { config } from '../config/index.js';
     * const provider = new OllamaProvider(config.llm.ollama);
     * ```
     */
    constructor(config?: Partial<OllamaConfig>) {
        // デフォルト値（configLoader が初期化される前のフォールバック）
        this.baseUrl = config?.baseUrl ?? 'http://localhost:11434';
        this.model = config?.model ?? 'gemma3:latest';
        this.healthCheckTimeoutMs = config?.healthCheckTimeoutMs ?? 2000;
    }

    /**
     * ストリーミングでメッセージを送信
     *
     * Ollamaの /api/chat エンドポイントを使用し、
     * トークンごとにコールバックを呼び出します。
     */
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

    /**
     * Ollamaサーバーが利用可能かチェック
     *
     * /api/tags エンドポイントにリクエストを送り、
     * 応答があれば利用可能と判断します。
     */
    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /** 現在のモデル名を取得（デバッグ用） */
    getModel(): string {
        return this.model;
    }

    /** 現在のベースURLを取得（デバッグ用） */
    getBaseUrl(): string {
        return this.baseUrl;
    }
}