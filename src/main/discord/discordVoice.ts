import { EventEmitter } from 'events';
import {
    joinVoiceChannel,
    VoiceConnection,
    VoiceConnectionStatus,
    entersState,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    EndBehaviorType,
    VoiceReceiver,
} from '@discordjs/voice';
import { Client, VoiceChannel, GuildMember } from 'discord.js';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IdentifiedAudio, VoiceChannelInfo, VoiceChannelMember } from './types.js';

/**
 * Discord音声チャンネル管理クラス
 */
export class DiscordVoice extends EventEmitter {
    private client: Client;
    private connection: VoiceConnection | null = null;
    private audioPlayer = createAudioPlayer();
    private currentChannelId: string | null = null;
    private currentGuildId: string | null = null;

    // 話者ごとの音声バッファ
    private userAudioBuffers: Map<string, Buffer[]> = new Map();
    private userSilenceTimers: Map<string, NodeJS.Timeout> = new Map();

    // 設定
    private silenceDuration: number = 1500;  // 無音判定時間（ms）
    private minAudioLength: number = 16000;  // 最小音声長（サンプル数）

    constructor(client: Client) {
        super();
        this.client = client;
        this.setupAudioPlayer();
    }

    /**
     * AudioPlayerのセットアップ
     */
    private setupAudioPlayer(): void {
        this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
            this.emit('speakingEnd');
        });

        this.audioPlayer.on('error', (error) => {
            console.error('[DiscordVoice] AudioPlayer error:', error);
            this.emit('error', error);
        });
    }

    /**
     * 音声チャンネルに参加
     */
    async joinChannel(channelId: string, guildId: string): Promise<void> {
        console.log(`[DiscordVoice] Joining channel: ${channelId}`);

        // 既存の接続があれば切断
        if (this.connection) {
            this.leaveChannel();
        }

        const guild = await this.client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId) as VoiceChannel;

        if (!channel || channel.type !== 2) {  // 2 = GuildVoice
            throw new Error('Invalid voice channel');
        }

        this.connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,  // 自分の音声を聞く
            selfMute: false,
        });

        // 接続完了を待つ
        try {
            await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
            console.log('[DiscordVoice] Connected to voice channel');

            this.currentChannelId = channelId;
            this.currentGuildId = guildId;

            // AudioPlayerを接続
            this.connection.subscribe(this.audioPlayer);

            // 音声受信を開始
            this.startReceiving();

            this.emit('connected', { channelId, guildId });
        } catch (error) {
            console.error('[DiscordVoice] Connection failed:', error);
            this.connection.destroy();
            this.connection = null;
            throw error;
        }
    }

    /**
     * 音声チャンネルから退出
     */
    leaveChannel(): void {
        if (this.connection) {
            console.log('[DiscordVoice] Leaving voice channel');
            this.connection.destroy();
            this.connection = null;
            this.currentChannelId = null;
            this.currentGuildId = null;

            // バッファをクリア
            this.userAudioBuffers.clear();
            for (const timer of this.userSilenceTimers.values()) {
                clearTimeout(timer);
            }
            this.userSilenceTimers.clear();

            this.emit('disconnected');
        }
    }

    /**
     * 音声受信を開始
     */
    private startReceiving(): void {
        if (!this.connection) return;

        const receiver = this.connection.receiver;

        // 話し始めを検出
        receiver.speaking.on('start', (userId) => {
            console.log(`[DiscordVoice] User ${userId} started speaking`);
            this.handleUserSpeakingStart(userId, receiver);
        });

        // 話し終わりを検出
        receiver.speaking.on('end', (userId) => {
            console.log(`[DiscordVoice] User ${userId} stopped speaking`);
            this.scheduleAudioFlush(userId);
        });
    }

    /**
     * ユーザーが話し始めた時の処理
     */
    private handleUserSpeakingStart(userId: string, receiver: VoiceReceiver): void {
        // 既存のタイマーをクリア
        const existingTimer = this.userSilenceTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.userSilenceTimers.delete(userId);
        }

        // 既に購読中なら何もしない
        if (this.userAudioBuffers.has(userId)) return;

        // 新しいバッファを作成
        this.userAudioBuffers.set(userId, []);

        // 音声ストリームを購読
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: this.silenceDuration,
            },
        });

        audioStream.on('data', (chunk: Buffer) => {
            const buffers = this.userAudioBuffers.get(userId);
            if (buffers) {
                buffers.push(chunk);
            }
        });

        audioStream.on('end', () => {
            this.scheduleAudioFlush(userId);
        });

        audioStream.on('error', (error) => {
            console.error(`[DiscordVoice] Audio stream error for user ${userId}:`, error);
        });
    }

    /**
     * 音声データのフラッシュをスケジュール
     */
    private scheduleAudioFlush(userId: string): void {
        // 既存のタイマーをクリア
        const existingTimer = this.userSilenceTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // 少し待ってからフラッシュ（連続発話を結合）
        const timer = setTimeout(async () => {
            await this.flushUserAudio(userId);
        }, 500);

        this.userSilenceTimers.set(userId, timer);
    }

    /**
     * ユーザーの音声データをフラッシュ
     */
    private async flushUserAudio(userId: string): Promise<void> {
        const buffers = this.userAudioBuffers.get(userId);
        this.userAudioBuffers.delete(userId);
        this.userSilenceTimers.delete(userId);

        if (!buffers || buffers.length === 0) return;

        // バッファを結合
        const audioBuffer = Buffer.concat(buffers);

        // 短すぎる音声は無視
        if (audioBuffer.length < this.minAudioLength) {
            console.log(`[DiscordVoice] Audio too short from user ${userId}, ignoring`);
            return;
        }

        // ユーザー名を取得
        let username = 'Unknown';
        try {
            if (this.currentGuildId) {
                const guild = await this.client.guilds.fetch(this.currentGuildId);
                const member = await guild.members.fetch(userId);
                username = member.displayName;
            }
        } catch (error) {
            console.error('[DiscordVoice] Failed to fetch username:', error);
        }

        console.log(`[DiscordVoice] Received audio from ${username} (${userId}): ${audioBuffer.length} bytes`);

        // PCMに変換（Opusデコード）
        const pcmBuffer = await this.decodeToPCM(audioBuffer);

        const identifiedAudio: IdentifiedAudio = {
            userId,
            username,
            audioBuffer: pcmBuffer,
            timestamp: Date.now(),
        };

        this.emit('audioReceived', identifiedAudio);
    }

    /**
     * OpusをPCMにデコード
     */
    private async decodeToPCM(opusBuffer: Buffer): Promise<Buffer> {
        // @discordjs/voiceはデフォルトでPCMを出力
        // 48kHz stereo → 16kHz monoへの変換
        return this.resampleTo16kMono(opusBuffer);
    }

    /**
     * 48kHz stereo を 16kHz mono にリサンプル
     */
    private resampleTo16kMono(buffer: Buffer): Buffer {
        // 入力: 48kHz, 16bit, stereo (4 bytes per sample)
        // 出力: 16kHz, 16bit, mono (2 bytes per sample)

        const inputSampleRate = 48000;
        const outputSampleRate = 16000;
        const ratio = inputSampleRate / outputSampleRate;  // 3

        const inputSamples = buffer.length / 4;  // stereo 16bit
        const outputSamples = Math.floor(inputSamples / ratio);
        const output = Buffer.alloc(outputSamples * 2);  // mono 16bit

        for (let i = 0; i < outputSamples; i++) {
            const srcIndex = Math.floor(i * ratio) * 4;

            // ステレオをモノラルに（左右の平均）
            const left = buffer.readInt16LE(srcIndex);
            const right = buffer.readInt16LE(srcIndex + 2);
            const mono = Math.round((left + right) / 2);

            output.writeInt16LE(mono, i * 2);
        }

        return output;
    }

    /**
     * 音声を再生（VOICEVOXの出力を流す）
     */
    async playAudio(wavBuffer: Buffer): Promise<void> {
        if (!this.connection) {
            console.error('[DiscordVoice] Not connected to voice channel');
            return;
        }

        // WAVファイルを一時保存
        const tempFile = path.join(os.tmpdir(), `discord_tts_${Date.now()}.wav`);

        try {
            await fs.writeFile(tempFile, wavBuffer);

            const resource = createAudioResource(tempFile);
            this.audioPlayer.play(resource);

            this.emit('speakingStart');

            // 再生完了を待つ
            await new Promise<void>((resolve) => {
                this.audioPlayer.once(AudioPlayerStatus.Idle, () => {
                    resolve();
                });
            });
        } finally {
            // 一時ファイル削除
            try {
                await fs.unlink(tempFile);
            } catch {
                // 無視
            }
        }
    }

    /**
     * 現在のチャンネル情報を取得
     */
    async getChannelInfo(): Promise<VoiceChannelInfo | null> {
        if (!this.currentChannelId || !this.currentGuildId) return null;

        try {
            const guild = await this.client.guilds.fetch(this.currentGuildId);
            const channel = await guild.channels.fetch(this.currentChannelId) as VoiceChannel;

            const members: VoiceChannelMember[] = [];
            for (const [memberId, member] of channel.members) {
                members.push({
                    userId: memberId,
                    username: member.displayName,
                    isSpeaking: false,  // TODO: 発話状態を追跡
                });
            }

            return {
                channelId: this.currentChannelId,
                guildId: this.currentGuildId,
                channelName: channel.name,
                members,
            };
        } catch (error) {
            console.error('[DiscordVoice] Failed to get channel info:', error);
            return null;
        }
    }

    /**
     * 接続状態を取得
     */
    isConnected(): boolean {
        return this.connection !== null &&
            this.connection.state.status === VoiceConnectionStatus.Ready;
    }

    /**
     * 現在のチャンネルID
     */
    getCurrentChannelId(): string | null {
        return this.currentChannelId;
    }
}