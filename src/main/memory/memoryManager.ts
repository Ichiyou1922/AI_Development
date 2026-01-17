import { VectorStore } from './vectorStore.js';
import { UserProfile, ProfileCategory } from './userProfile.js';
import {
    MemoryEntry,
    MemoryMetadata,
    MemoryType,
    SearchResult,
    EmbeddingProvider
} from './types.js';

/**
 * 情報抽出の結果
 */
interface ExtractedInfo {
    shouldSave: boolean;
    type: MemoryType;
    content: string;
    importance: number;
    tags: string[];
}

/**
 * 記憶管理の統合レイヤー
 * - 会話からの情報抽出
 * - 記憶の保存・検索
 * - プロンプトへの注入
 */
export class MemoryManager {
    private vectorStore: VectorStore;
    private userProfile: UserProfile;
    private extractionEnabled: boolean = true;

    constructor(vectorStore: VectorStore, userProfile: UserProfile) {
        this.vectorStore = vectorStore;
        this.userProfile = userProfile;
    }

    /**
     * ユーザーメッセージから保存すべき情報を抽出
     * 簡易ルールベース実装（後でLLM判断に拡張予定）
     */
    extractInfoFromMessage(
        userMessage: string,
        assistantResponse: string
    ): ExtractedInfo | null {
        if (!this.extractionEnabled) return null;

        const lowerMessage = userMessage.toLowerCase();

        // パターンマッチングによる情報抽出
        const patterns: Array<{
            regex: RegExp;
            type: MemoryType;
            importance: number;
            tags: string[];
            extractor: (match: RegExpMatchArray, msg: string) => string;
            profileUpdate?: (match: RegExpMatchArray) => { category: ProfileCategory; key: string; value: string };
        }> = [
                // 名前の自己紹介
                {
                    regex: /(?:私の名前は|僕の名前は|名前は|私は)([^、。\n]+?)(?:です|だよ|と申します|といいます|っていいます)/,
                    type: 'fact',
                    importance: 0.9,
                    tags: ['user', 'name', 'identity'],
                    extractor: (match) => `ユーザーの名前は「${match[1].trim()}」である`,
                    profileUpdate: (match) => ({
                        category: 'identity',
                        key: '名前',
                        value: match[1].trim(),
                    }),
                },
                // 年齢
                {
                    regex: /(?:私は|僕は)?(\d+)歳(?:です|だよ)?/,
                    type: 'fact',
                    importance: 0.7,
                    tags: ['user', 'age', 'identity'],
                    extractor: (match) => `ユーザーは${match[1]}歳である`,
                    profileUpdate: (match) => ({
                        category: 'identity',
                        key: '年齢',
                        value: `${match[1]}歳`,
                    }),
                },
                // 職業
                {
                    regex: /(?:私は|僕は)([^、。\n]+?)(?:として働いて|で働いて|をして|の仕事をして)/,
                    type: 'fact',
                    importance: 0.8,
                    tags: ['user', 'job', 'identity'],
                    extractor: (match) => `ユーザーの職業は「${match[1].trim()}」である`,
                    profileUpdate: (match) => ({
                        category: 'occupation',
                        key: '職業',
                        value: match[1].trim(),
                    }),
                },
                // 趣味
                {
                    regex: /(?:趣味は|好きなことは)([^、。\n]+?)(?:です|だよ|かな)/,
                    type: 'preference',
                    importance: 0.6,
                    tags: ['user', 'hobby', 'preference'],
                    extractor: (match) => `ユーザーの趣味は「${match[1].trim()}」である`,
                    profileUpdate: (match) => ({
                        category: 'preference',
                        key: '趣味',
                        value: match[1].trim(),
                    }),
                },
                // 好み（好き）
                {
                    regex: /(?:私は|僕は)?([^、。\n]+?)が(?:好き|大好き)(?:です|だよ|なんだ)?/,
                    type: 'preference',
                    importance: 0.5,
                    tags: ['user', 'like', 'preference'],
                    extractor: (match) => `ユーザーは「${match[1].trim()}」が好きである`,
                    profileUpdate: (match) => ({
                        category: 'preference',
                        key: `好き_${match[1].trim()}`,
                        value: match[1].trim(),
                    }),
                },
                // 好み（嫌い）
                {
                    regex: /(?:私は|僕は)?([^、。\n]+?)が(?:嫌い|苦手)(?:です|だよ|なんだ)?/,
                    type: 'preference',
                    importance: 0.5,
                    tags: ['user', 'dislike', 'preference'],
                    extractor: (match) => `ユーザーは「${match[1].trim()}」が嫌い/苦手である`,
                    profileUpdate: (match) => ({
                        category: 'preference',
                        key: `嫌い_${match[1].trim()}`,
                        value: match[1].trim(),
                    }),
                },
                // 住んでいる場所
                {
                    regex: /(?:私は|僕は)?([^、。\n]+?)に住んで(?:います|いる|るよ)/,
                    type: 'fact',
                    importance: 0.7,
                    tags: ['user', 'location', 'identity'],
                    extractor: (match) => `ユーザーは「${match[1].trim()}」に住んでいる`,
                    profileUpdate: (match) => ({
                        category: 'location',
                        key: '居住地',
                        value: match[1].trim(),
                    }),
                },
                // 覚えておいて系
                {
                    regex: /(?:覚えておいて|忘れないで|記憶して)[：:、]?(.+)/,
                    type: 'fact',
                    importance: 0.9,
                    tags: ['user', 'explicit_memory'],
                    extractor: (match) => match[1].trim(),
                },
            ];

        for (const pattern of patterns) {
            const match = userMessage.match(pattern.regex);
            if (match) {
                if (pattern.profileUpdate) {
                    const update = pattern.profileUpdate(match);
                    this.userProfile.set(update.category, update.key, update.value, {
                        confidence: pattern.importance,
                        source: 'explicit',
                    });
                }

                return {
                    shouldSave: true,
                    type: pattern.type,
                    content: pattern.extractor(match, userMessage),
                    importance: pattern.importance,
                    tags: pattern.tags,
                };
            }
        }

        return null;
    }
    // プロファイル情報を取得
    getProfile(): UserProfile {
        return this.userProfile;
    }
    // プロンプト用のコンテキスト生成（プロファイル + 関連記憶）
    async buildContextForPrompt(query: string): Promise<string> {
        const parts: string[] = [];

        // プロファイル情報
        const profileContext = this.userProfile.formatForPrompt();
        if (profileContext) {
            parts.push(profileContext);
            console.log('[MemoryManager] Injected profile context:', profileContext.substring(0, 100) + '...');
        } else {
            console.log('[MemoryManager] No profile context to inject');
        }

        // 関連記憶
        const memories = await this.searchRelevantMemories(query, 3, 0.4);
        if (memories.length > 0) {
            const memoryContext = this.formatMemoriesForPrompt(memories);
            parts.push(memoryContext);
            console.log('[MemoryManager] Injected relevant memories:', memories.length);
            memories.forEach(m => console.log(`  - [${m.score.toFixed(2)}] ${m.entry.content}`));
        } else {
            console.log('[MemoryManager] No relevant memories found');
        }

        return parts.join('\n\n');
    }
    /**
     * 抽出した情報を記憶に保存
     */
    async saveExtractedInfo(
        info: ExtractedInfo,
        conversationId?: string,
        discordUserId?: string,
        displayName?: string
    ): Promise<MemoryEntry | null> {
        if (!info.shouldSave) return null;

        // 重複チェック（類似の記憶が既にあるか）
        const existing = await this.vectorStore.search(info.content, 1);
        if (existing.length > 0 && existing[0].score > 0.9) {
            console.log(`[MemoryManager] Similar memory exists, skipping: ${info.content} (score: ${existing[0].score})`);
            // 既存の記憶の重要度を上げる
            await this.vectorStore.update(existing[0].entry.id, {
                metadata: {
                    ...existing[0].entry.metadata,
                    importance: Math.min(1.0, existing[0].entry.metadata.importance + 0.1),
                },
            });
            return existing[0].entry;
        }

        const entry = await this.vectorStore.add(info.content, {
            type: info.type,
            source: 'conversation',
            conversationId,
            importance: info.importance,
            tags: info.tags,
            discordUserId,
            displayName,
        });

        console.log(`[MemoryManager] Saved memory: ${info.content}${discordUserId ? ` (User: ${discordUserId})` : ''}`);
        return entry;
    }

    /**
     * クエリに関連する記憶を検索
     */
    async searchRelevantMemories(
        query: string,
        limit: number = 3,
        minScore: number = 0.5
    ): Promise<SearchResult[]> {
        const results = await this.vectorStore.search(query, limit);

        // スコアでフィルタリング
        return results.filter(r => r.score >= minScore);
    }

    /**
     * 特定ユーザーの記憶を検索
     */
    async searchUserMemories(
        query: string,
        discordUserId: string,
        limit: number = 5,
        minScore: number = 0.4
    ): Promise<SearchResult[]> {
        const results = await this.vectorStore.search(query, limit, { discordUserId });
        return results.filter(r => r.score >= minScore);
    }

    /**
     * 特定ユーザーの全記憶を取得
     */
    async getUserMemories(discordUserId: string): Promise<MemoryEntry[]> {
        const all = await this.vectorStore.getAll();
        return all.filter(m => m.metadata.discordUserId === discordUserId);
    }

    /**
     * ユーザー別の記憶統計
     */
    async getUserMemoryStats(discordUserId: string): Promise<{
        total: number;
        byType: Record<MemoryType, number>;
    }> {
        const memories = await this.getUserMemories(discordUserId);
        const byType: Record<MemoryType, number> = {
            fact: 0,
            episode: 0,
            skill: 0,
            preference: 0,
            relationship: 0,
        };

        for (const entry of memories) {
            byType[entry.metadata.type]++;
        }

        return {
            total: memories.length,
            byType,
        };
    }

    /**
     * 記憶をプロンプトに注入するためのテキスト生成
     */
    formatMemoriesForPrompt(memories: SearchResult[]): string {
        if (memories.length === 0) return '';

        const lines = memories.map((m, i) => {
            const typeLabel = this.getTypeLabel(m.entry.metadata.type);
            return `- [${typeLabel}] ${m.entry.content}`;
        });

        return `\n【関連する記憶】\n${lines.join('\n')}\n`;
    }

    /**
     * タイプのラベル変換
     */
    private getTypeLabel(type: MemoryType): string {
        const labels: Record<MemoryType, string> = {
            fact: '事実',
            episode: 'エピソード',
            skill: 'スキル',
            preference: '好み',
            relationship: '関係性',
        };
        return labels[type] || type;
    }

    /**
     * 情報抽出の有効/無効切り替え
     */
    setExtractionEnabled(enabled: boolean): void {
        this.extractionEnabled = enabled;
    }

    /**
     * 記憶の統計情報
     */
    async getStats(): Promise<{
        total: number;
        byType: Record<MemoryType, number>;
    }> {
        const all = await this.vectorStore.getAll();
        const byType: Record<MemoryType, number> = {
            fact: 0,
            episode: 0,
            skill: 0,
            preference: 0,
            relationship: 0,
        };

        for (const entry of all) {
            byType[entry.metadata.type]++;
        }

        return {
            total: all.length,
            byType,
        };
    }
}