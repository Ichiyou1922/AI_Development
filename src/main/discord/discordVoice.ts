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
import * as prism from 'prism-media';

/**
 * Discord音声チャンネル管理クラス
 * 
 * 修正点:
 * 1. 音声バッファの最小長チェックを強化
 * 2. 無音検出のタイミングを調整
 * 3. デバッグログの追加
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
    private userSpeakingStart: Map<string, number> = new Map();

    // TTS再生中フラグ（再生中は音声受信を無視）
    private isSpeaking: boolean = false;

    // 設定（調整済み）
    private silenceDuration: number = 2000;      // 無音判定時間（ms）: 1500 → 2000
    private minAudioDurationMs: number = 500;    // 最小音声長（ms）: 追加
    private minAudioSamples: number = 8000;      // 最小サンプル数（16kHz * 0.5秒）
    private maxAudioDurationMs: number = 30000;  // 最大音声長（ms）: 追加

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
            this.userSpeakingStart.clear();
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
            // TTS再生中は音声受信を無視（エコーバック防止）
            if (this.isSpeaking) {
                console.log(`[DiscordVoice] Ignored speaking start from ${userId} (TTS playing)`);
                return;
            }
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

        // 既に購読中の場合は開始時刻のみ更新
        if (this.userAudioBuffers.has(userId)) {
            console.log(`[DiscordVoice] User ${userId} resuming speech (continuing buffer)`);
            return;
        }

        // 新しいバッファを作成
        this.userAudioBuffers.set(userId, []);
        this.userSpeakingStart.set(userId, Date.now());

        // 音声ストリームを購読
        const opusStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: this.silenceDuration,
            },
        });

        // Opusデコーダーを作成 (48kHz, 2ch)
        const decoder = new prism.opus.Decoder({
            rate: 48000,
            channels: 2,
            frameSize: 960,
        });

        // Opusストリームをデコーダーにパイプ
        const pcmStream = opusStream.pipe(decoder);

        let chunkCount = 0;

        pcmStream.on('data', (chunk: Buffer) => {
            const buffers = this.userAudioBuffers.get(userId);
            if (buffers) {
                buffers.push(chunk);
                chunkCount++;

                // 最大長チェック
                const totalBytes = buffers.reduce((sum, b) => sum + b.length, 0);
                // PCMデータなのでバイト数から時間を計算可能 (48kHz * 2ch * 2bytes = 192000 bytes/sec)
                // totalBytes / 4 (サンプル数) / 48 (kHz) = ms
                const durationMs = (totalBytes / 4) / 48;

                if (durationMs >= this.maxAudioDurationMs) {
                    console.log(`[DiscordVoice] Max duration reached for user ${userId}, flushing`);
                    this.flushUserAudio(userId);
                }
            }
        });

        pcmStream.on('end', () => {
            console.log(`[DiscordVoice] Audio stream ended for user ${userId}, chunks: ${chunkCount}`);
            this.scheduleAudioFlush(userId);
        });

        pcmStream.on('error', (error: any) => {
            console.error(`[DiscordVoice] Audio stream error for user ${userId}:`, error);
        });

        opusStream.on('error', (error: any) => {
            console.error(`[DiscordVoice] Opus stream error for user ${userId}:`, error);
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
        }, 500);  // 500ms に延長

        this.userSilenceTimers.set(userId, timer);
    }

    /**
     * ユーザーの音声データをフラッシュ
     */
    private async flushUserAudio(userId: string): Promise<void> {
        // TTS再生中は処理しない
        if (this.isSpeaking) {
            console.log(`[DiscordVoice] Ignored flush for user ${userId} (TTS playing)`);
            this.userAudioBuffers.delete(userId);
            this.userSpeakingStart.delete(userId);
            this.userSilenceTimers.delete(userId);
            return;
        }

        const buffers = this.userAudioBuffers.get(userId);
        const startTime = this.userSpeakingStart.get(userId);

        this.userAudioBuffers.delete(userId);
        this.userSpeakingStart.delete(userId);
        this.userSilenceTimers.delete(userId);

        if (!buffers || buffers.length === 0) {
            console.log(`[DiscordVoice] No audio data for user ${userId}`);
            return;
        }

        // バッファを結合
        const audioBuffer = Buffer.concat(buffers);
        const durationMs = startTime ? Date.now() - startTime : 0;

        // 最小長チェック（生データで判定）
        // Discord: 48kHz, stereo, 16bit = 4 bytes per sample
        const rawSamples = audioBuffer.length / 4;
        const rawDurationMs = (rawSamples / 48000) * 1000;

        if (rawDurationMs < this.minAudioDurationMs) {
            console.log(`[DiscordVoice] Audio too short from user ${userId}: ${rawDurationMs.toFixed(0)}ms < ${this.minAudioDurationMs}ms, ignoring`);
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

        // PCMに変換（リサンプリング）
        const pcmBuffer = this.resampleTo16kMono(audioBuffer);

        console.log(`[DiscordVoice] Resampled audio: ${pcmBuffer.length} bytes (${(pcmBuffer.length / 2 / 16000 * 1000).toFixed(0)}ms at 16kHz)`);

        // 最終的なサンプル数チェック
        const finalSamples = pcmBuffer.length / 2;  // 16bit mono
        if (finalSamples < this.minAudioSamples) {
            console.log(`[DiscordVoice] Resampled audio too short: ${finalSamples} samples < ${this.minAudioSamples}, ignoring`);
            return;
        }

        const identifiedAudio: IdentifiedAudio = {
            userId,
            username,
            audioBuffer: pcmBuffer,
            timestamp: Date.now(),
        };

        this.emit('audioReceived', identifiedAudio);
    }

    /**
     * 48kHz stereo を 16kHz mono にリサンプル
     * 
     * 入力: 48kHz, 16bit, stereo (4 bytes per sample pair)
     * 出力: 16kHz, 16bit, mono (2 bytes per sample)
     */
    private resampleTo16kMono(buffer: Buffer): Buffer {
        const inputSampleRate = 48000;
        const outputSampleRate = 16000;
        const ratio = inputSampleRate / outputSampleRate;  // 3

        // 入力: stereo なので 4 bytes = 1 sample pair (L + R)
        const inputSamplePairs = Math.floor(buffer.length / 4);
        const outputSamples = Math.floor(inputSamplePairs / ratio);

        if (outputSamples <= 0) {
            console.warn(`[DiscordVoice] Resample resulted in 0 samples (input: ${buffer.length} bytes)`);
            return Buffer.alloc(0);
        }

        const output = Buffer.alloc(outputSamples * 2);  // mono 16bit

        for (let i = 0; i < outputSamples; i++) {
            const srcIndex = Math.floor(i * ratio) * 4;

            if (srcIndex + 3 >= buffer.length) break;

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

        // 再生中フラグをON（音声受信を一時停止）
        this.isSpeaking = true;
        console.log('[DiscordVoice] TTS playback started, receiving paused');

        // 既存のバッファをクリア（再生開始前に溜まった音声を破棄）
        this.clearAllBuffers();

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

            // 再生終了後、少し待ってからリスニング再開（エコー防止）
            await new Promise<void>((resolve) => setTimeout(resolve, 500)); // エコー発生なら1000くらいに

        } finally {
            // 一時ファイル削除
            try {
                await fs.unlink(tempFile);
            } catch {
                // 無視
            }

            // 再生中フラグをOFF
            this.isSpeaking = false;
            console.log('[DiscordVoice] TTS playback ended, receiving resumed');
        }
    }

    /**
     * すべてのユーザーのバッファをクリア
     */
    private clearAllBuffers(): void {
        for (const timer of this.userSilenceTimers.values()) {
            clearTimeout(timer);
        }
        this.userAudioBuffers.clear();
        this.userSpeakingStart.clear();
        this.userSilenceTimers.clear();
        console.log('[DiscordVoice] All audio buffers cleared');
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
                    isSpeaking: false,
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

    /**
     * TTS再生中かどうか
     */
    isPlaybackActive(): boolean {
        return this.isSpeaking;
    }

    /**
     * 設定を更新
     */
    updateConfig(config: {
        silenceDuration?: number;
        minAudioDurationMs?: number;
        maxAudioDurationMs?: number;
    }): void {
        if (config.silenceDuration !== undefined) {
            this.silenceDuration = config.silenceDuration;
        }
        if (config.minAudioDurationMs !== undefined) {
            this.minAudioDurationMs = config.minAudioDurationMs;
            this.minAudioSamples = Math.floor(16000 * config.minAudioDurationMs / 1000);
        }
        if (config.maxAudioDurationMs !== undefined) {
            this.maxAudioDurationMs = config.maxAudioDurationMs;
        }
        console.log(`[DiscordVoice] Config updated:`, {
            silenceDuration: this.silenceDuration,
            minAudioDurationMs: this.minAudioDurationMs,
            maxAudioDurationMs: this.maxAudioDurationMs,
        });
    }
}