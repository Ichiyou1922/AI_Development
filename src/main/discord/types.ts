/**
 * Discord Bot設定
 */
export interface DiscordBotConfig {
    token: string;
    prefix?: string;          // コマンドプレフィックス（例: "!"）
    allowedChannels?: string[];  // 応答を許可するチャンネルID
    adminUsers?: string[];    // 管理者ユーザーID
}

/**
 * Discord Botの状態
 */
export type DiscordBotState =
    | 'disconnected'
    | 'connecting'
    | 'ready'
    | 'error';

/**
 * Discordからのメッセージ情報
 */
export interface DiscordMessageContext {
    messageId: string;
    channelId: string;
    guildId: string | null;
    userId: string;
    username: string;
    /** ユーザーが設定した呼び名（設定されていればusernameより優先） */
    displayName: string | null;
    /** ユーザーコンテキスト（LLMに渡す用） */
    userContext: string;
    /** 管理者かどうか */
    isAdmin: boolean;
    content: string;
    timestamp: Date;
}

/**
 * Discord音声チャンネル情報
 */
export interface VoiceChannelInfo {
    channelId: string;
    guildId: string;
    channelName: string;
    members: VoiceChannelMember[];
}

export interface VoiceChannelMember {
    userId: string;
    username: string;
    isSpeaking: boolean;
}

/**
 * 話者識別付き音声データ
 */
export interface IdentifiedAudio {
    userId: string;
    username: string;
    audioBuffer: Buffer;
    timestamp: number;
}