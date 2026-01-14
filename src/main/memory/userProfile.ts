import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

/**
 * プロファイル項目の型
 */
export interface ProfileItem {
    id: number;
    category: ProfileCategory;
    key: string;
    value: string;
    confidence: number;      // 0.0 ~ 1.0（情報の確信度）
    source: string;          // 'explicit' | 'inferred' | 'corrected'
    createdAt: number;
    updatedAt: number;
}

export type ProfileCategory = 
    | 'identity'      // 名前，年齢，性別等
    | 'location'      // 住所，出身地等
    | 'occupation'    // 職業，会社，役職等
    | 'preference'    // 好み，趣味等
    | 'relationship'  // 家族，友人等
    | 'goal'          // 目標，計画等
    | 'context'       // 現在の状況，プロジェクト等
    | 'other';        // その他

/**
 * ユーザープロファイル管理（SQLite）
 */
export class UserProfile {
    private db: Database.Database;
    private dbPath: string;

    constructor() {
        this.dbPath = path.join(app.getPath('userData'), 'user_profile.db');
        this.db = new Database(this.dbPath);
        this.initialize();
    }

    /**
     * テーブル初期化
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                confidence REAL DEFAULT 0.8,
                source TEXT DEFAULT 'inferred',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(category, key)
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_profile_category ON profile(category)
        `);

        console.log(`[UserProfile] Initialized at ${this.dbPath}`);
    }

    /**
     * プロファイル項目の追加・更新
     */
    set(
        category: ProfileCategory,
        key: string,
        value: string,
        options?: {
            confidence?: number;
            source?: string;
        }
    ): ProfileItem {
        const now = Date.now();
        const confidence = options?.confidence ?? 0.8;
        const source = options?.source ?? 'inferred';

        const stmt = this.db.prepare(`
            INSERT INTO profile (category, key, value, confidence, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(category, key) DO UPDATE SET
                value = excluded.value,
                confidence = excluded.confidence,
                source = excluded.source,
                updated_at = excluded.updated_at
        `);

        const result = stmt.run(category, key, value, confidence, source, now, now);

        console.log(`[UserProfile] Set: ${category}.${key} = ${value}`);

        return {
            id: result.lastInsertRowid as number,
            category,
            key,
            value,
            confidence,
            source,
            createdAt: now,
            updatedAt: now,
        };
    }

    /**
     * プロファイル項目の取得
     */
    get(category: ProfileCategory, key: string): ProfileItem | null {
        const stmt = this.db.prepare(`
            SELECT id, category, key, value, confidence, source, 
                   created_at as createdAt, updated_at as updatedAt
            FROM profile
            WHERE category = ? AND key = ?
        `);

        const row = stmt.get(category, key) as any;
        return row || null;
    }

    /**
     * カテゴリ別の全項目取得
     */
    getByCategory(category: ProfileCategory): ProfileItem[] {
        const stmt = this.db.prepare(`
            SELECT id, category, key, value, confidence, source,
                   created_at as createdAt, updated_at as updatedAt
            FROM profile
            WHERE category = ?
            ORDER BY key
        `);

        return stmt.all(category) as ProfileItem[];
    }

    /**
     * 全プロファイル取得
     */
    getAll(): ProfileItem[] {
        const stmt = this.db.prepare(`
            SELECT id, category, key, value, confidence, source,
                   created_at as createdAt, updated_at as updatedAt
            FROM profile
            ORDER BY category, key
        `);

        return stmt.all() as ProfileItem[];
    }

    /**
     * プロファイル項目の削除
     */
    delete(category: ProfileCategory, key: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM profile WHERE category = ? AND key = ?
        `);

        const result = stmt.run(category, key);
        return result.changes > 0;
    }

    /**
     * カテゴリ全体の削除
     */
    deleteCategory(category: ProfileCategory): number {
        const stmt = this.db.prepare(`
            DELETE FROM profile WHERE category = ?
        `);

        const result = stmt.run(category);
        return result.changes;
    }

    /**
     * 全削除
     */
    clear(): void {
        this.db.exec('DELETE FROM profile');
        console.log('[UserProfile] Cleared all entries');
    }

    /**
     * プロンプト用にフォーマット
     */
    formatForPrompt(): string {
        const items = this.getAll();
        if (items.length === 0) return '';

        const grouped: Record<string, ProfileItem[]> = {};
        for (const item of items) {
            if (!grouped[item.category]) {
                grouped[item.category] = [];
            }
            grouped[item.category].push(item);
        }

        const categoryLabels: Record<ProfileCategory, string> = {
            identity: '基本情報',
            location: '場所',
            occupation: '職業',
            preference: '好み',
            relationship: '人間関係',
            goal: '目標',
            context: '現在の状況',
            other: 'その他',
        };

        const lines: string[] = ['【ユーザープロファイル】'];
        
        for (const [category, categoryItems] of Object.entries(grouped)) {
            const label = categoryLabels[category as ProfileCategory] || category;
            lines.push(`\n[${label}]`);
            for (const item of categoryItems) {
                lines.push(`- ${item.key}: ${item.value}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * 統計情報
     */
    getStats(): { total: number; byCategory: Record<string, number> } {
        const items = this.getAll();
        const byCategory: Record<string, number> = {};

        for (const item of items) {
            byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        }

        return {
            total: items.length,
            byCategory,
        };
    }

    /**
     * データベースを閉じる
     */
    close(): void {
        this.db.close();
    }
}