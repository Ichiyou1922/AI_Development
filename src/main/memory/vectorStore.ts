import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { 
    MemoryEntry, 
    MemoryMetadata, 
    MemoryType, 
    SearchResult,
    EmbeddingProvider 
} from './types.js';

/**
 * コサイン類似度の計算
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vector dimensions do not match');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    
    if (magnitude === 0) return 0;
    
    return dotProduct / magnitude;
}

/**
 * JSONファイルベースのベクトルストア
 */
export class VectorStore {
    private memories: Map<string, MemoryEntry> = new Map();
    private embeddingProvider: EmbeddingProvider;
    private storagePath: string;
    private initialized: boolean = false;

    constructor(embeddingProvider: EmbeddingProvider) {
        this.embeddingProvider = embeddingProvider;
        this.storagePath = path.join(app.getPath('userData'), 'memory_store.json');
    }

    /**
     * ストアの初期化
     */
    async initialize(): Promise<void> {
        console.log(`[VectorStore] Initializing at ${this.storagePath}`);
        
        try {
            const data = await fs.readFile(this.storagePath, 'utf-8');
            const entries: MemoryEntry[] = JSON.parse(data);
            
            for (const entry of entries) {
                this.memories.set(entry.id, entry);
            }
            
            console.log(`[VectorStore] Loaded ${this.memories.size} memories`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log(`[VectorStore] No existing store, starting fresh`);
            } else {
                console.error(`[VectorStore] Load error:`, error);
            }
        }
        
        this.initialized = true;
    }

    /**
     * ストアの永続化
     */
    private async save(): Promise<void> {
        const entries = Array.from(this.memories.values());
        const data = JSON.stringify(entries, null, 2);
        
        const tempPath = `${this.storagePath}.tmp`;
        await fs.writeFile(tempPath, data, 'utf-8');
        await fs.rename(tempPath, this.storagePath);
    }

    /**
     * 記憶の追加
     */
    async add(
        content: string,
        metadata: Omit<MemoryMetadata, 'accessCount'>
    ): Promise<MemoryEntry> {
        if (!this.initialized) {
            throw new Error('VectorStore not initialized');
        }

        const id = this.generateId();
        const vector = await this.embeddingProvider.embed(content);
        const now = Date.now();

        const entry: MemoryEntry = {
            id,
            content,
            vector,
            metadata: {
                ...metadata,
                accessCount: 0,
            },
            createdAt: now,
            updatedAt: now,
        };

        this.memories.set(id, entry);
        await this.save();

        console.log(`[VectorStore] Added memory: ${id}`);
        return entry;
    }

    /**
     * 類似検索
     */
    async search(
        query: string,
        limit: number = 5,
        filter?: Partial<MemoryMetadata>
    ): Promise<SearchResult[]> {
        if (!this.initialized) {
            throw new Error('VectorStore not initialized');
        }

        if (this.memories.size === 0) {
            return [];
        }

        const queryVector = await this.embeddingProvider.embed(query);

        // 全記憶との類似度を計算
        const scored: SearchResult[] = [];

        for (const entry of this.memories.values()) {
            // フィルタ適用
            if (filter) {
                if (filter.type && entry.metadata.type !== filter.type) continue;
                if (filter.source && entry.metadata.source !== filter.source) continue;
                if (filter.importance !== undefined && 
                    entry.metadata.importance < filter.importance) continue;
            }

            const score = cosineSimilarity(queryVector, entry.vector);
            scored.push({ entry, score });
        }

        // スコア降順でソートしてlimit件取得
        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, limit);

        // アクセスカウント更新
        for (const result of results) {
            await this.incrementAccessCount(result.entry.id);
        }

        return results;
    }

    /**
     * IDによる取得
     */
    async get(id: string): Promise<MemoryEntry | null> {
        return this.memories.get(id) || null;
    }

    /**
     * 記憶の更新
     */
    async update(
        id: string, 
        updates: Partial<Pick<MemoryEntry, 'content' | 'metadata'>>
    ): Promise<MemoryEntry | null> {
        const entry = this.memories.get(id);
        if (!entry) return null;

        if (updates.content) {
            entry.content = updates.content;
            entry.vector = await this.embeddingProvider.embed(updates.content);
        }

        if (updates.metadata) {
            entry.metadata = { ...entry.metadata, ...updates.metadata };
        }

        entry.updatedAt = Date.now();
        
        this.memories.set(id, entry);
        await this.save();

        return entry;
    }

    /**
     * 記憶の削除
     */
    async delete(id: string): Promise<boolean> {
        const existed = this.memories.delete(id);
        
        if (existed) {
            await this.save();
            console.log(`[VectorStore] Deleted memory: ${id}`);
        }
        
        return existed;
    }

    /**
     * アクセスカウントの更新
     */
    async incrementAccessCount(id: string): Promise<void> {
        const entry = this.memories.get(id);
        if (!entry) return;

        entry.metadata.accessCount += 1;
        entry.updatedAt = Date.now();
        
        // 保存は呼び出し元でバッチ処理可能にするため，ここでは行わない
    }

    /**
     * 全記憶数の取得
     */
    async count(): Promise<number> {
        return this.memories.size;
    }

    /**
     * 低重要度の記憶を取得（忘却候補）
     */
    async getLowImportanceMemories(
        threshold: number = 0.3,
        limit: number = 10
    ): Promise<MemoryEntry[]> {
        const candidates: MemoryEntry[] = [];

        for (const entry of this.memories.values()) {
            if (entry.metadata.importance < threshold) {
                candidates.push(entry);
            }
        }

        // 重要度昇順（低い方が先）
        candidates.sort((a, b) => a.metadata.importance - b.metadata.importance);
        
        return candidates.slice(0, limit);
    }

    /**
     * 古い記憶を取得（圧縮候補）
     */
    async getOldMemories(
        olderThanMs: number,
        limit: number = 10
    ): Promise<MemoryEntry[]> {
        const threshold = Date.now() - olderThanMs;
        const candidates: MemoryEntry[] = [];

        for (const entry of this.memories.values()) {
            if (entry.createdAt < threshold) {
                candidates.push(entry);
            }
        }

        // 古い順
        candidates.sort((a, b) => a.createdAt - b.createdAt);
        
        return candidates.slice(0, limit);
    }

    /**
     * タイプ別の記憶を取得
     */
    async getByType(type: MemoryType): Promise<MemoryEntry[]> {
        const results: MemoryEntry[] = [];

        for (const entry of this.memories.values()) {
            if (entry.metadata.type === type) {
                results.push(entry);
            }
        }

        return results;
    }

    /**
     * 全記憶の取得（デバッグ用）
     */
    async getAll(): Promise<MemoryEntry[]> {
        return Array.from(this.memories.values());
    }

    /**
     * ストアのクリア（デバッグ用）
     */
    async clear(): Promise<void> {
        this.memories.clear();
        await this.save();
        console.log(`[VectorStore] Cleared all memories`);
    }

    /**
     * ID生成
     */
    private generateId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `mem_${timestamp}_${random}`;
    }
}