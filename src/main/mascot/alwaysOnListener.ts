import { EventEmitter } from 'events';
import { DiscordBot, IdentifiedAudio } from '../discord/index.js';
import { STTRouter } from '../voice/sttRouter.js';
import { VoicevoxProvider } from '../voice/voicevoxProvider.js';

export interface ListenerConfig {
    enabled: boolean;
    autoJoinChannel?: {
        channelId: string;
        guildId: string;
    };
    respondToAllUsers: boolean;  // false: 特定ユーザーのみ
    allowedUserIds?: string[];
}

/**
 * マスコットモード用の常時リスニングコントローラ
 */
export class AlwaysOnListener extends EventEmitter {
    private discordBot: DiscordBot;
    private sttRouter: STTRouter;
    private voicevox: VoicevoxProvider;
    private config: ListenerConfig;
    private llmHandler: ((text: string, userId: string, username: string) => Promise<string>) | null = null;

    private isListening: boolean = false;

    constructor(
        discordBot: DiscordBot,
        sttRouter: STTRouter,
        voicevox: VoicevoxProvider,
        config: ListenerConfig
    ) {
        super();
        this.discordBot = discordBot;
        this.sttRouter = sttRouter;
        this.voicevox = voicevox;
        this.config = config;

        this.setupEventListeners();
    }

    /**
     * イベントリスナーを設定
     */
    private setupEventListeners(): void {
        // Discord音声受信
        this.discordBot.on('voiceReceived', async (audio: IdentifiedAudio) => {
            if (!this.isListening) return;
            await this.handleVoiceInput(audio);
        });

        // 接続・切断イベント
        this.discordBot.on('voiceConnected', (info) => {
            console.log(`[AlwaysOn] Connected to voice channel: ${info.channelId}`);
            this.emit('connected', info);
        });

        this.discordBot.on('voiceDisconnected', () => {
            console.log('[AlwaysOn] Disconnected from voice channel');
            this.emit('disconnected');
        });
    }

    /**
     * LLMハンドラを設定
     */
    setLLMHandler(handler: (text: string, userId: string, username: string) => Promise<string>): void {
        this.llmHandler = handler;
    }

    /**
     * 常時リスニングを開始
     */
    async start(): Promise<void> {
        if (this.isListening) {
            console.log('[AlwaysOn] Already listening');
            return;
        }

        // 自動参加設定がある場合
        if (this.config.autoJoinChannel) {
            const { channelId, guildId } = this.config.autoJoinChannel;
            try {
                await this.discordBot.joinVoiceChannel(channelId, guildId);
            } catch (error) {
                console.error('[AlwaysOn] Failed to join channel:', error);
                throw error;
            }
        }

        this.isListening = true;
        console.log('[AlwaysOn] Started listening');
        this.emit('started');
    }

    /**
     * 常時リスニングを停止
     */
    stop(): void {
        this.isListening = false;
        this.discordBot.leaveVoiceChannel();
        console.log('[AlwaysOn] Stopped listening');
        this.emit('stopped');
    }

    /**
     * 音声入力を処理
     */
    private async handleVoiceInput(audio: IdentifiedAudio): Promise<void> {
        // ユーザーフィルタ
        if (!this.config.respondToAllUsers) {
            if (!this.config.allowedUserIds?.includes(audio.userId)) {
                console.log(`[AlwaysOn] Ignoring user: ${audio.username}`);
                return;
            }
        }

        console.log(`[AlwaysOn] Processing voice from ${audio.username}`);
        this.emit('processing', { userId: audio.userId, username: audio.username });

        try {
            // STT
            const startSTT = Date.now();
            const transcription = await this.sttRouter.transcribe(audio.audioBuffer, 16000);
            const sttTime = Date.now() - startSTT;

            const userText = transcription.text.trim();
            if (!userText) {
                console.log('[AlwaysOn] Empty transcription');
                return;
            }

            console.log(`[AlwaysOn] STT (${sttTime}ms): "${userText}"`);
            this.emit('transcribed', {
                userId: audio.userId,
                username: audio.username,
                text: userText,
                sttTime,
            });

            // LLM
            if (!this.llmHandler) {
                console.warn('[AlwaysOn] No LLM handler set');
                return;
            }

            const startLLM = Date.now();
            const response = await this.llmHandler(userText, audio.userId, audio.username);
            const llmTime = Date.now() - startLLM;

            console.log(`[AlwaysOn] LLM (${llmTime}ms): "${response.substring(0, 50)}..."`);
            this.emit('response', {
                userId: audio.userId,
                username: audio.username,
                userText,
                response,
                llmTime,
            });

            // TTS + 再生
            const startTTS = Date.now();
            const audioBuffer = await this.voicevox.synthesize(response);
            const ttsTime = Date.now() - startTTS;

            await this.discordBot.playAudio(audioBuffer);

            console.log(`[AlwaysOn] TTS (${ttsTime}ms), total: ${sttTime + llmTime + ttsTime}ms`);
            this.emit('spoken', {
                userId: audio.userId,
                username: audio.username,
                response,
                timing: { sttTime, llmTime, ttsTime },
            });

        } catch (error) {
            console.error('[AlwaysOn] Error:', error);
            this.emit('error', error);
        }
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<ListenerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 状態を取得
     */
    getStatus(): {
        isListening: boolean;
        sttProvider: string;
        isVoiceConnected: boolean;
    } {
        return {
            isListening: this.isListening,
            sttProvider: this.sttRouter.getActiveProvider(),
            isVoiceConnected: this.discordBot.isVoiceConnected(),
        };
    }
}