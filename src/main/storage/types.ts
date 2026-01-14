export interface StoredMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
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