export interface StoredMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    // Discord連携用
    discordUserId?: string;    // Discord User ID
    displayName?: string;      // 表示名（!callmeで登録された名前）
}

export interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: StoredMessage[];
}

export interface ConversationMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
}