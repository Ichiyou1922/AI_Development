import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

/**
 * Discordユーザー情報
 */
export interface DiscordUser {
    discordId: string;
    name: string | null;       // ユーザーが教えた呼び名（nullなら未設定）
    displayName: string;       // Discordの表示名（フォールバック用）
    firstSeen: number;         // 初めて見た日時
    lastSeen: number;          // 最後に見た日時
    messageCount: number;      // メッセージ数
}

/**
 * Discordユーザー管理
 *
 * Discord IDに紐付けてユーザー情報を管理します。
 * - admin: config.jsonで設定された管理者は常に名前で呼ぶ
 * - 他ユーザー: 自己紹介後は名前で呼ぶ
 */
export class DiscordUserManager {
    private db: Database.Database;
    private dbPath: string;
    private adminConfig: { id: string; name: string } | null = null;

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
            CREATE TABLE IF NOT EXISTS discord_users (
                discord_id TEXT PRIMARY KEY,
                name TEXT,
                display_name TEXT NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                message_count INTEGER DEFAULT 0
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_discord_users_last_seen
            ON discord_users(last_seen)
        `);

        console.log('[DiscordUsers] Initialized');
    }

    /**
     * admin設定をセット
     */
    setAdminConfig(admin: { id: string; name: string } | null): void {
        this.adminConfig = admin;
        if (admin) {
            console.log(`[DiscordUsers] Admin configured: ${admin.name} (${admin.id})`);
        }
    }

    /**
     * ユーザーがadminかどうか
     */
    isAdmin(discordId: string): boolean {
        return this.adminConfig?.id === discordId;
    }

    /**
     * ユーザーの呼び名を取得
     * 優先順位: admin設定 > DB保存の名前 > Discord表示名 > null
     */
    getName(discordId: string): string | null {
        // adminの場合は設定から
        if (this.adminConfig && this.adminConfig.id === discordId) {
            return this.adminConfig.name;
        }

        // DBから取得
        const user = this.getUser(discordId);
        if (user) {
            return user.name || user.displayName;
        }

        return null;
    }

    /**
     * ユーザー情報を取得
     */
    getUser(discordId: string): DiscordUser | null {
        const stmt = this.db.prepare(`
            SELECT discord_id as discordId, name, display_name as displayName,
                   first_seen as firstSeen, last_seen as lastSeen, message_count as messageCount
            FROM discord_users
            WHERE discord_id = ?
        `);

        return stmt.get(discordId) as DiscordUser | null;
    }

    /**
     * ユーザーを記録（メッセージ受信時に呼ぶ）
     */
    recordUser(discordId: string, displayName: string): DiscordUser {
        const now = Date.now();
        const existing = this.getUser(discordId);

        if (existing) {
            // 既存ユーザー: last_seenとmessage_countを更新
            const stmt = this.db.prepare(`
                UPDATE discord_users
                SET display_name = ?, last_seen = ?, message_count = message_count + 1
                WHERE discord_id = ?
            `);
            stmt.run(displayName, now, discordId);

            return {
                ...existing,
                displayName,
                lastSeen: now,
                messageCount: existing.messageCount + 1,
            };
        } else {
            // 新規ユーザー
            const stmt = this.db.prepare(`
                INSERT INTO discord_users (discord_id, name, display_name, first_seen, last_seen, message_count)
                VALUES (?, NULL, ?, ?, ?, 1)
            `);
            stmt.run(discordId, displayName, now, now);

            console.log(`[DiscordUsers] New user recorded: ${displayName} (${discordId})`);

            return {
                discordId,
                name: null,
                displayName,
                firstSeen: now,
                lastSeen: now,
                messageCount: 1,
            };
        }
    }

    /**
     * ユーザーの呼び名を設定
     */
    setName(discordId: string, name: string): boolean {
        const stmt = this.db.prepare(`
            UPDATE discord_users SET name = ? WHERE discord_id = ?
        `);
        const result = stmt.run(name, discordId);

        if (result.changes > 0) {
            console.log(`[DiscordUsers] Name set: ${discordId} -> ${name}`);
            return true;
        }
        return false;
    }

    /**
     * ユーザーの呼び名をクリア
     */
    clearName(discordId: string): boolean {
        const stmt = this.db.prepare(`
            UPDATE discord_users SET name = NULL WHERE discord_id = ?
        `);
        const result = stmt.run(discordId);
        return result.changes > 0;
    }

    /**
     * 全ユーザー取得
     */
    getAllUsers(): DiscordUser[] {
        const stmt = this.db.prepare(`
            SELECT discord_id as discordId, name, display_name as displayName,
                   first_seen as firstSeen, last_seen as lastSeen, message_count as messageCount
            FROM discord_users
            ORDER BY last_seen DESC
        `);

        return stmt.all() as DiscordUser[];
    }

    /**
     * 名前が設定されているユーザー一覧
     */
    getNamedUsers(): DiscordUser[] {
        const stmt = this.db.prepare(`
            SELECT discord_id as discordId, name, display_name as displayName,
                   first_seen as firstSeen, last_seen as lastSeen, message_count as messageCount
            FROM discord_users
            WHERE name IS NOT NULL
            ORDER BY last_seen DESC
        `);

        return stmt.all() as DiscordUser[];
    }

    /**
     * LLMコンテキスト用にユーザー情報をフォーマット
     */
    formatUserContext(discordId: string, displayName: string): string {
        const name = this.getName(discordId);
        const isAdmin = this.isAdmin(discordId);
        const user = this.getUser(discordId);

        if (isAdmin && name) {
            return `発言者: ${name}（管理者）`;
        } else if (name) {
            return `発言者: ${name}`;
        } else if (user) {
            // 名前未設定だが以前見たことがある
            return `発言者: ${displayName}（名前未設定、${user.messageCount}回目の発言）`;
        } else {
            // 初めてのユーザー
            return `発言者: ${displayName}（初めての人）`;
        }
    }

    /**
     * 統計情報
     */
    getStats(): { total: number; named: number; admin: string | null } {
        const allUsers = this.getAllUsers();
        const namedUsers = allUsers.filter(u => u.name !== null);

        return {
            total: allUsers.length,
            named: namedUsers.length,
            admin: this.adminConfig?.name || null,
        };
    }

    /**
     * データベースを閉じる
     */
    close(): void {
        this.db.close();
    }
}

// シングルトンインスタンス
let discordUserManagerInstance: DiscordUserManager | null = null;

export function getDiscordUserManager(): DiscordUserManager {
    if (!discordUserManagerInstance) {
        discordUserManagerInstance = new DiscordUserManager();
    }
    return discordUserManagerInstance;
}
