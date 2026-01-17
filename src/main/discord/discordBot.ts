import { EventEmitter } from 'events';
import {
    Client,
    GatewayIntentBits,
    Message,
    TextChannel,
    Events,
    Partials,
} from 'discord.js';
import {
    DiscordBotConfig,
    DiscordBotState,
    DiscordMessageContext,
    IdentifiedAudio,
    VoiceChannelInfo,
} from './types.js';
import { DiscordVoice } from './discordVoice.js';
import { getDiscordUserManager, DiscordUserManager } from '../memory/discordUsers.js';


/**
 * Discord Bot管理クラス
 */
export class DiscordBot extends EventEmitter {
    private client: Client;
    private config: DiscordBotConfig;
    private state: DiscordBotState = 'disconnected';
    private voice: DiscordVoice | null = null;
    private voiceMessageHandler: ((audio: IdentifiedAudio) => Promise<string>) | null = null;
    private userManager: DiscordUserManager;

    // 外部から注入されるメッセージ処理関数
    private messageHandler: ((ctx: DiscordMessageContext) => Promise<string>) | null = null;

    // 最後にアクティブだったチャンネル
    private lastActiveChannelId: string | null = null;

    constructor(config: DiscordBotConfig) {
        super();
        this.config = config;
        this.userManager = getDiscordUserManager();

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
            ],
            partials: [Partials.Channel],
        });

        this.setupEventHandlers();
    }

    /**
     * イベントハンドラのセットアップ
     */
    private setupEventHandlers(): void {
        // 起動完了
        this.client.once(Events.ClientReady, (readyClient) => {
            console.log(`[DiscordBot] Logged in as ${readyClient.user.tag}`);
            this.state = 'ready';
            this.emit('ready', readyClient.user.tag);
        });

        // メッセージ受信
        this.client.on(Events.MessageCreate, async (message) => {
            await this.handleMessage(message);
        });

        // エラー
        this.client.on(Events.Error, (error) => {
            console.error('[DiscordBot] Error:', error);
            this.state = 'error';
            this.emit('error', error);
        });

        // 切断
        this.client.on(Events.ShardDisconnect, () => {
            console.log('[DiscordBot] Disconnected');
            this.state = 'disconnected';
            this.emit('disconnected');
        });
    }

    /**
     * メッセージ処理
     */
    private async handleMessage(message: Message): Promise<void> {
        // Bot自身のメッセージは無視
        if (message.author.bot) return;

        // チャンネル制限がある場合はチェック
        if (this.config.allowedChannels &&
            this.config.allowedChannels.length > 0 &&
            !this.config.allowedChannels.includes(message.channelId)) {
            return;
        }

        // アクティブなチャンネルを更新
        this.lastActiveChannelId = message.channelId;

        // コマンド処理: !join
        if (message.content === '!join') {
            if (message.member?.voice.channel && message.guildId) {
                try {
                    await this.joinVoiceChannel(message.member.voice.channel.id, message.guildId);
                    await message.reply('音声チャンネルに参加しました。');
                } catch (error) {
                    console.error('[DiscordBot] Join error:', error);
                    await message.reply('参加できませんでした。権限などを確認してください。');
                }
            } else {
                await message.reply('先に音声チャンネルに参加してください。');
            }
            return;
        }

        // コマンド処理: !leave
        if (message.content === '!leave') {
            if (this.isVoiceConnected()) {
                this.leaveVoiceChannel();
                await message.reply('音声チャンネルから退出しました。');
            } else {
                await message.reply('音声チャンネルに参加していません。');
            }
            return;
        }

        // 実験的にすべてのチャットに返信（返信しないこともある）-> 一旦キャンセル

        // メンションまたはプレフィックスで始まるメッセージのみ応答
        const isMentioned = message.mentions.has(this.client.user!);
        const hasPrefix = this.config.prefix &&
            message.content.startsWith(this.config.prefix);

        if (!isMentioned && !hasPrefix) return;

        // メッセージ内容を抽出（メンションやプレフィックスを除去）
        let content = message.content;
        if (isMentioned) {
            content = content.replace(/<@!?\d+>/g, '').trim();
        }
        if (hasPrefix && this.config.prefix) {
            content = content.slice(this.config.prefix.length).trim();
        }

        if (!content) return;

        // コマンド処理: !callme (呼び名設定)
        if (content.startsWith('!callme ')) {
            const name = content.slice(8).trim();
            if (name.length > 0 && name.length <= 20) {
                if (this.setUserName(message.author.id, name)) {
                    await message.reply(`これからは「${name}」とお呼びします！`);
                } else {
                    await message.reply('名前の設定に失敗しました。');
                }
            } else {
                await message.reply('名前は1〜20文字で指定してください。');
            }
            return;
        }

        // コマンド処理: !whoami (登録名確認)
        if (content === '!whoami') {
            const name = this.getUserName(message.author.id);
            const displayName = message.author.displayName;
            if (name) {
                await message.reply(`現在は「${name}」として認識しています。（Discord表示名: ${displayName}）`);
            } else {
                await message.reply(`まだ呼び名は設定されていません。「${displayName}」とお呼びします。\n` +
                    `変更したい場合は \`!ai !callme [名前]\` と入力してください。`);
            }
            return;
        }

        // ユーザー情報を記録・取得
        this.userManager.recordUser(message.author.id, message.author.displayName);
        const displayName = this.userManager.getName(message.author.id);
        const isAdmin = this.userManager.isAdmin(message.author.id);
        const userContext = this.userManager.formatUserContext(message.author.id, message.author.displayName);

        const ctx: DiscordMessageContext = {
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
            userId: message.author.id,
            username: message.author.username,
            displayName,
            userContext,
            isAdmin,
            content,
            timestamp: message.createdAt,
        };

        console.log(`[DiscordBot] Message from ${displayName || ctx.username} (${isAdmin ? 'admin' : 'user'}): ${ctx.content}`);
        this.emit('message', ctx);

        // メッセージハンドラが設定されていれば応答
        if (this.messageHandler) {
            try {
                // タイピング表示
                if ('sendTyping' in message.channel) {
                    await (message.channel as any).sendTyping();
                }

                const response = await this.messageHandler(ctx);

                if (response) {
                    // 長いメッセージは分割
                    await this.sendLongMessage(message.channel as TextChannel, response);
                }
            } catch (error) {
                console.error('[DiscordBot] Handler error:', error);
                await message.reply('エラーが発生しました。');
            }
        }
    }

    /**
     * 長いメッセージを分割して送信
     */
    private async sendLongMessage(channel: TextChannel, content: string): Promise<void> {
        const maxLength = 2000;  // Discordの制限

        if (content.length <= maxLength) {
            await channel.send(content);
            return;
        }

        // 分割して送信
        const chunks: string[] = [];
        let remaining = content;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            // 最後の改行または空白で分割
            let splitIndex = remaining.lastIndexOf('\n', maxLength);
            if (splitIndex === -1) {
                splitIndex = remaining.lastIndexOf(' ', maxLength);
            }
            if (splitIndex === -1) {
                splitIndex = maxLength;
            }

            chunks.push(remaining.slice(0, splitIndex));
            remaining = remaining.slice(splitIndex).trim();
        }

        for (const chunk of chunks) {
            await channel.send(chunk);
        }
    }

    /**
     * メッセージハンドラを設定
     */
    setMessageHandler(handler: (ctx: DiscordMessageContext) => Promise<string>): void {
        this.messageHandler = handler;
    }

    /**
     * Botを起動
     */
    async start(): Promise<void> {
        if (this.state === 'ready' || this.state === 'connecting') {
            console.log('[DiscordBot] Already started or connecting');
            return;
        }

        console.log('[DiscordBot] Starting...');
        this.state = 'connecting';

        try {
            await this.client.login(this.config.token);
        } catch (error) {
            console.error('[DiscordBot] Login failed:', error);
            this.state = 'error';
            throw error;
        }
    }

    /**
     * Botを停止
     */
    async stop(): Promise<void> {
        console.log('[DiscordBot] Stopping...');
        await this.client.destroy();
        this.state = 'disconnected';
    }

    /**
     * 状態取得
     */
    getState(): DiscordBotState {
        return this.state;
    }

    /**
     * Clientインスタンスを取得（音声機能用）
     */
    getClient(): Client {
        return this.client;
    }

    /**
     * 特定のチャンネルにメッセージを送信
     */
    async sendMessage(channelId: string, content: string): Promise<void> {
        const channel = await this.client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            await (channel as TextChannel).send(content);
        }
    }

    /**
     * 音声機能を初期化
     */
    initializeVoice(): void {
        if (this.state !== 'ready') {
            console.error('[DiscordBot] Cannot initialize voice before ready')
            return;
        }

        this.voice = new DiscordVoice(this.client);

        // 音声データを受け取った際のイベントハンドラ
        this.voice.on('audioReceived', async (audio: IdentifiedAudio) => {
            console.log(`[DiscordBot] Audio received from ${audio.username}`);
            this.emit('voiceReceived', audio);

            // 
            if (this.voiceMessageHandler) {
                try {
                    const response = await this.voiceMessageHandler(audio);
                    if (response && this.voice) {
                        // TTS Response
                        this.emit('voiceResponse', {
                            text: response,
                            targetUsername: audio.username,
                            targetUserId: audio.userId,
                        });
                    }
                } catch (error) {
                    console.error('[DiscordBot] Voice handler error:', error);
                }
            }
        });

        this.voice.on('connected', (info) => {
            this.emit('voiceConnected', info);
        });

        this.voice.on('disconnected', (info) => {
            this.emit('voiceDisconnected', info);
        });

        this.voice.on('error', (error) => {
            this.emit('voiceError', error);
        });

        console.log('[DiscordBot] Voice initialized');
    }

    /**
     * 音声チャンネルに参加
     */
    async joinVoiceChannel(channelId: string, guildId: string): Promise<void> {
        if (!this.voice) {
            this.initializeVoice();
        }
        await this.voice!.joinChannel(channelId, guildId);
    }

    /**
     * 音声チャンネルから退出
     */
    leaveVoiceChannel(): void {
        if (this.voice) {
            this.voice.leaveChannel();
        }
    }

    /**
     * 音声を再生
     */
    async playAudio(wavBuffer: Buffer): Promise<void> {
        if (this.voice && this.voice.isConnected()) {
            await this.voice.playAudio(wavBuffer);
        }
    }

    /**
     * 音声メッセージハンドラを設定
     */
    setVoiceMessageHandler(handler: (audio: IdentifiedAudio) => Promise<string>): void {
        this.voiceMessageHandler = handler;
    }

    /**
     * 音声チャンネル情報を取得
     */
    async getVoiceChannelInfo(): Promise<VoiceChannelInfo | null> {
        return this.voice?.getChannelInfo() ?? null;
    }

    /**
     * 音声チャンネル接続状態
     */
    isVoiceConnected(): boolean {
        return this.voice?.isConnected() ?? false;
    }

    /**
     * 音声再生中かどうか
     */
    isSpeaking(): boolean {
        return this.voice?.isPlaybackActive() ?? false;
    }

    /**
     * 自律発話をDiscordに送信
     * テキストチャンネルへの送信 + 音声チャンネルでのTTS再生
     * @param message 送信するメッセージ
     * @param options オプション
     */
    async sendAutonomousMessage(
        message: string,
        options?: {
            channelId?: string;      // 送信先チャンネル（省略時は最後にメッセージを受信したチャンネル）
            speakInVoice?: boolean;  // 音声チャンネルでも発話するか（デフォルト: true）
        }
    ): Promise<void> {
        const { speakInVoice = true } = options ?? {};

        // チャンネルIDの決定: 指定 > 最新のアクティブチャンネル > 許可リストの最初
        const targetChannelId = options?.channelId ??
            this.lastActiveChannelId ??
            this.config.allowedChannels?.[0];

        // テキストチャンネルに送信
        if (targetChannelId) {
            try {
                await this.sendMessage(targetChannelId, message);
                console.log(`[DiscordBot] Autonomous message sent to channel ${targetChannelId}`);
            } catch (error) {
                console.error('[DiscordBot] Failed to send autonomous message:', error);
            }
        }

        // 音声チャンネルに参加中なら音声でも発話
        if (speakInVoice && this.isVoiceConnected()) {
            this.emit('autonomousVoice', { text: message });
        }
    }

    /**
     * 設定されたチャンネルリストを取得（autonomous用）
     */
    getAllowedChannels(): string[] | undefined {
        return this.config.allowedChannels;
    }

    /**
     * 管理者設定をセット
     */
    setAdminConfig(admin: { id: string; name: string } | null): void {
        this.userManager.setAdminConfig(admin);
    }

    /**
     * ユーザーの呼び名を設定
     */
    setUserName(discordId: string, name: string): boolean {
        return this.userManager.setName(discordId, name);
    }

    /**
     * ユーザーの呼び名を取得
     */
    getUserName(discordId: string): string | null {
        return this.userManager.getName(discordId);
    }

    /**
     * ユーザー管理の統計情報
     */
    getUserStats(): { total: number; named: number; admin: string | null } {
        return this.userManager.getStats();
    }
}