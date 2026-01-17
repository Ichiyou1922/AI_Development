/**
 * 記憶エントリの型定義
 */
export interface MemoryEntry {
    id: string;
    content: string;
    vector: number[];
    metadata: MemoryMetadata;
    createdAt: number;
    updatedAt: number;
}

export interface MemoryMetadata {
    type: MemoryType;
    source: string;           // 'conversation' | 'user_input' | 'system'
    conversationId?: string;  // 元の会話ID
    importance: number;       // 0.0 ~ 1.0（忘却判定に使用）
    accessCount: number;      // 参照回数（重要度計算に使用）
    tags: string[];           // 検索用タグ
    // Discord連携用
    discordUserId?: string;   // 記憶の所有者（Discord User ID）
    displayName?: string;     // 表示名（!callmeで登録された名前）
}

export type MemoryType = 
    | 'fact'           // ユーザーに関する事実（名前，好み等）
    | 'episode'        // エピソード記憶（過去の会話要約）
    | 'skill'          // 学習したスキル・手順
    | 'preference'     // ユーザーの好み・設定
    | 'relationship';  // 関係性に関する情報

export interface SearchResult {
    entry: MemoryEntry;
    score: number;  // 類似度スコア（0.0 ~ 1.0）
}

export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getDimension(): number;
}