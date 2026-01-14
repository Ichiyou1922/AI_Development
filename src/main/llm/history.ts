import * as fs from 'fs';
import * as path from 'path';;
import { app } from 'electron';
import { LLMMessage } from "./types.js";

export interface HistoryManagerConfig {
    maxMessages: number; // 保持する最大メッセージ数
    maxTokensEstimate: number; // 推定最大トークン数
}

export class HistoryManager {
    private history: LLMMessage[] = [];
    private config: HistoryManagerConfig;
    private savePath: string;

    constructor(config?: Partial<HistoryManagerConfig>) {
        this.config = {
            maxMessages: config?.maxMessages ?? 50,
            maxTokensEstimate: config?.maxTokensEstimate ?? 8000,
        };

        // ユーザーデータディレクトリにファイルを配置
        const userDataPath = app.getPath('userData');
        this.savePath = path.join(userDataPath, 'conversation_history.json');
    }

    add (message: LLMMessage): void {
        this.history.push(message);
        this.trim();
    }

    getHistory(): LLMMessage[] {
        return [...this.history];
    }

    clear(): void {
        this.history = [];
    }

    private trim(): void {
        // メッセージ数による制限
        while (this.history.length > this.config.maxMessages) {
            // 最初のメッセージを削除（ただしsystemメッセージは保持）
            const firstNonSystem = this.history.findIndex(m => m.role !== 'system');
            if(firstNonSystem !== -1) {
                this.history.splice(firstNonSystem, 1);
            } else {
                break;
            }
        }

        // トークン数による制限（簡易推定）
        while (this.estimateTokens() > this.config.maxTokensEstimate) {
            const firstNonSystem = this.history.findIndex(m => m.role !== 'system');
            if (firstNonSystem !== -1) {
                this.history.splice(firstNonSystem, 1);
            } else {
                break;
            }
        }
    }

    // 簡易トークン数推定
    private estimateTokens(): number {
        return this.history.reduce((sum, msg) => {
            // EN: 約4文字/トークン，JA: 約2文字/トークン
            return sum + Math.ceil(msg.content.length / 2);
        }, 0);
    }

    getMessageCount(): number {
        return this.history.length;
    }

    getEstimatedTokens(): number {
        return this.estimateTokens();
    }

    async save(): Promise<void> {
        try {
            const data = JSON.stringify(this.history, null, 2);
            await fs.promises.writeFile(this.savePath, data, 'utf-8');
            console.log(`[HistoryManager] Saved ${this.history.length} messages`);
        } catch (error) {
            console.error('[HistoryManager] Failed to save:', error);
        }
    }

    async load(): Promise<void> {
        try {
            if (!fs.existsSync(this.savePath)) {
                console.log('[HistoryManager] No saved History found');
                return;
            }

            const data = await fs.promises.readFile(this.savePath, 'utf-8');
            const loaded = JSON.parse(data) as LLMMessage[];

            if (Array.isArray(loaded) && loaded.every(this.isValidMessage)) {
                this.history = loaded;
                this.trim(); // ロード後に制限を適用
                console.log`[HistoryManager] Loaded ${this.history.length} messages`;
            }
        } catch (error) {
            console.error('[HistoryManager] Failed to load', error);
        }
    }

    private isValidMessage(msg: unknown): msg is LLMMessage {
        if (typeof msg !== 'object' || msg === null) return false;
        const m = msg as Record<string, unknown>;
        return (
            (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
            typeof m.content === 'string'
        );
    }

    getSavePath(): string {
        return this.savePath;
    }
}