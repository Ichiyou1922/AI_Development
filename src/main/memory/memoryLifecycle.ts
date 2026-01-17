import { VectorStore } from './vectorStore.js';
import { MemoryEntry, MemoryType, SearchResult } from './types.js';
import { LLMRouter } from '../llm/router.js';

/**
 * 圧縮結果
 */
interface CompressionResult {
    originalIds: string[];
    summary: string;
    newEntryId: string;
}

/**
 * 忘却判定結果
 */
interface ForgetDecision {
    id: string;
    content: string;
    shouldForget: boolean;
    reason: string;
}

/**
 * 記憶のライフサイクル管理
 * - 圧縮: 古いエピソード記憶を要約
 * - 忘却: 不要な記憶を削除// Live2D初期化
 */
export class MemoryLifecycle {
    private vectorStore: VectorStore;
    private llmRouter: LLMRouter;

    constructor(vectorStore: VectorStore, llmRouter: LLMRouter) {
        this.vectorStore = vectorStore;
        this.llmRouter = llmRouter;
    }

    /**
     * 安全なログ出力（I/Oエラーを無視）
     */
    private safeLog(message: string): void {
        try {
            console.log(message);
        } catch {
            // ストリームが閉じられている場合は無視
        }
    }

    private safeError(message: string, error?: any): void {
        try {
            console.error(message, error);
        } catch {
            // ストリームが閉じられている場合は無視
        }
    }

    /**
     * 古い記憶を圧縮（要約）
     */
    async compressOldMemories(
        olderThanDays: number = 7,
        minCount: number = 3
    ): Promise<CompressionResult | null> {
        const olderThanMs = olderThanDays * 24 * 60 * 60 * 1000;
        const oldMemories = await this.vectorStore.getOldMemories(olderThanMs, 10);

        // エピソード記憶のみを対象
        const episodes = oldMemories.filter(m => m.metadata.type === 'episode');

        if (episodes.length < minCount) {
            this.safeLog(`[MemoryLifecycle] Not enough old episodes to compress: ${episodes.length}`);
            return null;
        }

        // LLMで要約生成
        const contentsToSummarize = episodes.map(e => `- ${e.content}`).join('\n');
        
        const prompt = `以下は過去の会話から抽出された記録です。これらを1〜2文の簡潔な要約に圧縮してください。重要な事実や出来事のみを残し、冗長な部分は削除してください。

【記録】
${contentsToSummarize}

【要約】`;

        let summary = '';
        
        await this.llmRouter.sendMessageStream(
            [{ role: 'user', content: prompt }],
            {
                onToken: (token) => { summary += token; },
                onDone: () => {},
                onError: (error) => { this.safeError('[MemoryLifecycle] Compression error:', error); },
            }
        );

        if (!summary.trim()) {
            this.safeError('[MemoryLifecycle] Failed to generate summary');
            return null;
        }

        // 元の記憶を削除
        const originalIds = episodes.map(e => e.id);
        for (const id of originalIds) {
            await this.vectorStore.delete(id);
        }

        // 圧縮された記憶を追加
        const newEntry = await this.vectorStore.add(summary.trim(), {
            type: 'episode',
            source: 'compressed',
            importance: 0.6,
            tags: ['compressed', 'summary'],
        });

        this.safeLog(`[MemoryLifecycle] Compressed ${episodes.length} memories into 1`);

        return {
            originalIds,
            summary: summary.trim(),
            newEntryId: newEntry.id,
        };
    }

    /**
     * 忘却判定（LLMによる判断）
     */
    async evaluateForForgetting(
        limit: number = 5
    ): Promise<ForgetDecision[]> {
        // 低重要度・低アクセス数の記憶を候補として取得
        const candidates = await this.vectorStore.getLowImportanceMemories(0.4, limit);

        if (candidates.length === 0) {
            return [];
        }

        const decisions: ForgetDecision[] = [];

        for (const memory of candidates) {
            const decision = await this.evaluateSingleMemory(memory);
            decisions.push(decision);
        }

        return decisions;
    }

    /**
     * 単一の記憶を評価
     */
    private async evaluateSingleMemory(memory: MemoryEntry): Promise<ForgetDecision> {
        const prompt = `以下の記憶情報を評価してください。この情報は今後のユーザーとの会話で役立つ可能性がありますか？

【記憶内容】
${memory.content}

【メタデータ】
- 種類: ${memory.metadata.type}
- 重要度: ${memory.metadata.importance}
- 参照回数: ${memory.metadata.accessCount}
- 作成日: ${new Date(memory.createdAt).toLocaleDateString('ja-JP')}

以下の形式で回答してください：
判定: [保持/削除]
理由: [1文で説明]`;

        let response = '';

        await this.llmRouter.sendMessageStream(
            [{ role: 'user', content: prompt }],
            {
                onToken: (token) => { response += token; },
                onDone: () => {},
                onError: (error) => { this.safeError('[MemoryLifecycle] Evaluation error:', error); },
            }
        );

        // レスポンスをパース
        const shouldForget = response.includes('削除');
        const reasonMatch = response.match(/理由[:：]\s*(.+)/);
        const reason = reasonMatch ? reasonMatch[1].trim() : '判定不能';

        return {
            id: memory.id,
            content: memory.content,
            shouldForget,
            reason,
        };
    }

    /**
     * 忘却の実行
     */
    async executeForget(decisions: ForgetDecision[]): Promise<number> {
        let deletedCount = 0;

        for (const decision of decisions) {
            if (decision.shouldForget) {
                const success = await this.vectorStore.delete(decision.id);
                if (success) {
                    deletedCount++;
                    this.safeLog(`[MemoryLifecycle] Forgot: ${decision.content} (${decision.reason})`);
                }
            }
        }

        return deletedCount;
    }

    /**
     * 重要度の自動調整
     * - アクセス頻度が高い → 重要度UP
     * - 長期間アクセスなし → 重要度DOWN
     */
    async adjustImportance(): Promise<void> {
        const allMemories = await this.vectorStore.getAll();
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

        for (const memory of allMemories) {
            let newImportance = memory.metadata.importance;

            // アクセス頻度による調整
            if (memory.metadata.accessCount > 10) {
                newImportance = Math.min(1.0, newImportance + 0.1);
            } else if (memory.metadata.accessCount === 0 && 
                       now - memory.updatedAt > oneWeekMs) {
                newImportance = Math.max(0.1, newImportance - 0.1);
            }

            // 変更があれば更新
            if (newImportance !== memory.metadata.importance) {
                await this.vectorStore.update(memory.id, {
                    metadata: {
                        ...memory.metadata,
                        importance: newImportance,
                    },
                });
            }
        }
    }

    /**
     * 定期メンテナンスの実行
     */
    async runMaintenance(): Promise<{
        compressed: number;
        forgotten: number;
        adjusted: number;
    }> {
        this.safeLog('[MemoryLifecycle] Starting maintenance...');

        // 1. 重要度調整
        await this.adjustImportance();
        const allMemories = await this.vectorStore.getAll();

        // 2. 圧縮
        const compressionResult = await this.compressOldMemories(7, 3);
        const compressed = compressionResult ? compressionResult.originalIds.length : 0;

        // 3. 忘却判定と実行
        const forgetDecisions = await this.evaluateForForgetting(5);
        const forgotten = await this.executeForget(forgetDecisions);

        this.safeLog(`[MemoryLifecycle] Maintenance complete: compressed=${compressed}, forgotten=${forgotten}`);

        return {
            compressed,
            forgotten,
            adjusted: allMemories.length,
        };
    }
}