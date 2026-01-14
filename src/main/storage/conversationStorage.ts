import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { Conversation, ConversationMeta, StoredMessage } from './types.js';

export class ConversationStorage {
    private storageDir: string;

    constructor() {
        this.storageDir = path.join(app.getPath('userData'), 'conversations');
    }

    // ストレージディレクトリの初期化
    // アプリ起動時 一度だけ呼び出す
    async initialize(): Promise<void> {
        try {
            await fs.mkdir(this.storageDir, { recursive: true });
        } catch (error) {
            console.error('[ConversationStorage] Failed to create storage directory:', error);
            throw error;
        }
    }

    // 一意なIDを生成
    // 形式: conv_<rimestamp>_<random>
    private generateId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `conv_${timestamp}_${random}`;
    }

    // 会話ファイルのパスを取得
    private getFilePath(id: string): string {
        return path.join(this.storageDir, `${id}.json`);
    }

    // 新規会話を作成
    async create(title?: string): Promise<Conversation> {
        const now = Date.now();
        const conversation: Conversation = {
            id: this.generateId(),
            title: title || `会話 ${new Date(now).toLocaleString('ja-JP')}`,
            createdAt: now,
            updatedAt: now,
            messages: [],
        };

        await this.save(conversation);
        return conversation;
    }

    // 会話を保存（作成・更新）
    async save(conversation: Conversation): Promise<void> {
        const filePath = this.getFilePath(conversation.id);
        const data = JSON.stringify(conversation, null, 2);

        // Atomicな書き込み: 一次ファイルに書いてからリネーム
        const tempPath = `${filePath}.tmp`;
        try {
            await fs.writeFile(tempPath, data, 'utf-8');
            await fs.rename(tempPath, filePath);
        } catch (error) {
            // 一時ファイルがアレば削除
            try {
                await fs.unlink(tempPath);
            } catch {
                // 無視
            }
            throw error;
        }
    }

    // 会話を読み込み
    async load(id: string): Promise<Conversation | null> {
        const filePath = this.getFilePath(id);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as Conversation;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    // 会話を削除
    async delete(id: string): Promise<boolean> {
        const filePath = this.getFilePath(id);
        try {
            await fs.unlink(filePath);
            return true;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }

    // メッセージを追加
    async addMessage(
        id: string,
        role: StoredMessage['role'],
        content: string
    ): Promise<Conversation | null> {
        const conversation = await this.load(id);
        if (!conversation) {
            return null;
        }

        const message: StoredMessage = {
            role,
            content,
            timestamp: Date.now(),
        };

        conversation.messages.push(message);
        conversation.updatedAt = Date.now();

        if (
            role === 'user' &&
            conversation.messages.filter(m => m.role === 'user').length === 1
        ) {
            conversation.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
        }

        await this.save(conversation);
        return conversation;
    }

    // 全会話のメタ情報を取得（一覧表示）
    async listAll(): Promise<ConversationMeta[]> {
        try {
            const files = await fs.readdir(this.storageDir, { withFileTypes: true });
            const metas: ConversationMeta[] = [];

            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith('.json')) {
                    continue;
                }

                if (file.name.endsWith('.tmp')) {
                    continue;
                }

                const filePath = path.join(this.storageDir, file.name);
                try {
                    const data = await fs.readFile(filePath, 'utf-8');
                    const conv = JSON.parse(data) as Conversation;
                    metas.push({
                        id: conv.id,
                        title: conv.title,
                        createdAt: conv.createdAt,
                        updatedAt: conv.updatedAt,
                        messageCount: conv.messages.length,
                    });
                } catch {
                    //読み込み失敗したファイルは無視
                    continue;
                }
            }

            metas.sort((a, b) => b.updatedAt - a.updatedAt);
            return metas;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
}
