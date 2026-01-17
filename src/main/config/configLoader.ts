/**
 * 設定ローダー
 *
 * このモジュールは設定ファイルを読み込み、マージし、
 * アプリケーション全体で利用可能にします。
 *
 * 設定の読み込み順序（後から読んだものが優先）:
 * 1. config/default.json - デフォルト値（必須）
 * 2. config/config.json - ユーザーカスタマイズ（オプション）
 * 3. 環境変数 - 最優先の上書き（オプション）
 *
 * 使い方:
 * ```typescript
 * import { getConfig, config } from './config/configLoader.js';
 *
 * // 初期化（アプリ起動時に1回だけ呼ぶ）
 * await initConfig();
 *
 * // 設定の取得
 * const ollamaUrl = config.llm.ollama.baseUrl;
 * const speakerId = config.tts.voicevox.speakerId;
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig, PartialAppConfig } from './types.js';

// ============================================================
// デフォルト設定
// ============================================================

/**
 * デフォルト設定値
 *
 * config/default.json が読み込めない場合のフォールバック。
 * 通常は使用されませんが、安全のために定義しています。
 */
const DEFAULT_CONFIG: AppConfig = {
    llm: {
        ollama: {
            baseUrl: 'http://localhost:11434',
            model: 'gemma3:latest',
            healthCheckTimeoutMs: 2000,
        },
        anthropic: {
            model: 'claude-sonnet-4-20250514',
            maxTokens: 1024,
        },
        preference: 'local-first',
    },
    stt: {
        provider: 'faster-whisper',
        fasterWhisper: {
            serverUrl: 'http://127.0.0.1:5001',
            model: 'small',
            device: 'cuda',
            computeType: 'float16',
            serverStartupTimeoutMs: 300000,
            healthCheckIntervalMs: 1000,
            transcriptionTimeoutMs: 30000,
        },
    },
    tts: {
        voicevox: {
            baseUrl: 'http://localhost:50021',
            speakerId: 14,
            speedScale: 1.3,
        },
    },
    memory: {
        embedding: {
            provider: 'xenova',
            xenova: {
                model: 'Xenova/multilingual-e5-small',
                dimension: 384,
            },
            ollama: {
                model: 'nomic-embed-text',
                dimension: 768,
            },
        },
        vectorStore: {
            defaultSearchLimit: 5,
            lowImportanceThreshold: 0.3,
            forgetCandidateLimit: 10,
        },
        lifecycle: {
            compressionAgeDays: 7,
            compressionMinCount: 3,
            forgetImportanceThreshold: 0.4,
            evaluationLimit: 5,
            maintenanceIntervalMs: 3600000,
        },
        contextSearchLimit: 3,
        contextMinScore: 0.4,
    },
    autonomous: {
        enabled: true,
        minIntervalMs: 1800000,
        maxDailyActions: 5,
        workDurationMs: 3600000,
        idleThresholdMs: 300000,
        greetingIdleThresholdSeconds: 600,
    },
    idleDetector: {
        idleThresholdSeconds: 300,
        checkIntervalMs: 60000,
    },
    screenRecognition: {
        windowMonitorEnabled: true,
        screenshotEnabled: false,
        reactToWindowChange: true,
        screenshotIntervalMs: 300000,
        minReactionIntervalMs: 60000,
        windowPollIntervalMs: 2000,
        screenshot: {
            maxWidth: 800,
            quality: 60,
        },
    },
    discord: {
        prefix: '!ai',
        maxMessageLength: 2000,
        admin: null,
        voice: {
            silenceDurationMs: 2000,
            minAudioDurationMs: 500,
            maxAudioDurationMs: 30000,
            inputSampleRate: 48000,
            outputSampleRate: 16000,
        },
        autonomous: {
            enabled: true,
            sendToTextChannel: true,
            speakInVoice: true,
            defaultChannelId: null,
        },
    },
    prompts: {
        character: {
            name: 'AI',
        },
        system: 'あなたは親切なAIアシスタントです。ユーザーとの過去のやり取りから得た情報を活用して、パーソナライズされた応答を行ってください。',
        memory: {
            compression: '以下は過去の会話から抽出された記録です。これらを1〜2文の簡潔な要約に圧縮してください。重要な事実や出来事のみを残し、冗長な部分は削除してください。',
            evaluation: '以下の記憶情報を評価してください。この情報は今後のユーザーとの会話で役立つ可能性がありますか？',
        },
    },
};

// ============================================================
// グローバル設定インスタンス
// ============================================================

/**
 * 現在の設定（読み取り専用）
 *
 * initConfig() 呼び出し後に使用可能になります。
 * 直接変更せず、設定ファイルを編集してください。
 */
let _config: AppConfig = { ...DEFAULT_CONFIG };

/**
 * 設定へのアクセサ
 *
 * 初期化前に呼び出すとデフォルト値が返されます。
 */
export const config: Readonly<AppConfig> = new Proxy(_config, {
    get: (target, prop) => {
        return target[prop as keyof AppConfig];
    },
    set: () => {
        console.warn('[Config] 直接の変更は禁止されています。設定ファイルを編集してください。');
        return false;
    },
});

/**
 * 設定を取得（関数形式）
 *
 * プロキシが使えない環境向けのフォールバック。
 */
export function getConfig(): Readonly<AppConfig> {
    return _config;
}

// ============================================================
// 設定の読み込み
// ============================================================

/**
 * プロジェクトルートディレクトリを取得
 */
function getProjectRoot(): string {
    // Electron パッケージ時は app.getAppPath() を使用
    // 開発時は __dirname から辿る
    if (app && app.isPackaged) {
        return path.dirname(app.getAppPath());
    }
    // dist/main/config/configLoader.js から見て 3階層上がプロジェクトルート->二階層に修正
    return path.resolve(__dirname, '../../');
}

/**
 * JSONファイルを読み込む（コメント除去付き）
 */
async function readJsonFile(filePath: string): Promise<any> {
    const content = await fs.readFile(filePath, 'utf-8');
    // _comment や _usage フィールドは無視（JSONとしては有効）
    return JSON.parse(content);
}

/**
 * 深いマージを行う
 *
 * オブジェクトを再帰的にマージします。
 * 配列は上書き（マージしない）されます。
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            const sourceValue = source[key];
            const targetValue = result[key];

            // null や undefined は上書き
            if (sourceValue === null || sourceValue === undefined) {
                continue;
            }

            // 両方がオブジェクトなら再帰マージ
            if (
                typeof sourceValue === 'object' &&
                !Array.isArray(sourceValue) &&
                typeof targetValue === 'object' &&
                !Array.isArray(targetValue)
            ) {
                (result as any)[key] = deepMerge(targetValue as object, sourceValue as object);
            } else {
                // それ以外は上書き
                (result as any)[key] = sourceValue;
            }
        }
    }

    return result;
}

/**
 * 環境変数から設定を上書き
 *
 * 対応する環境変数:
 * - OLLAMA_BASE_URL: Ollama のベースURL
 * - OLLAMA_MODEL: Ollama のモデル名
 * - VOICEVOX_BASE_URL: VOICEVOX のベースURL
 * - VOICEVOX_SPEAKER_ID: 話者ID
 * - WHISPER_SERVER_URL: Whisper サーバーURL
 * - WHISPER_MODEL: Whisper モデルサイズ
 * - AUTONOMOUS_TEST: テストモード（true で短い間隔）
 */
function applyEnvironmentOverrides(config: AppConfig): AppConfig {
    const result = { ...config };

    // Ollama設定
    if (process.env.OLLAMA_BASE_URL) {
        result.llm.ollama.baseUrl = process.env.OLLAMA_BASE_URL;
    }
    if (process.env.OLLAMA_MODEL) {
        result.llm.ollama.model = process.env.OLLAMA_MODEL;
    }

    // VOICEVOX設定
    if (process.env.VOICEVOX_BASE_URL) {
        result.tts.voicevox.baseUrl = process.env.VOICEVOX_BASE_URL;
    }
    if (process.env.VOICEVOX_SPEAKER_ID) {
        result.tts.voicevox.speakerId = parseInt(process.env.VOICEVOX_SPEAKER_ID, 10);
    }

    // Whisper設定
    if (process.env.WHISPER_SERVER_URL) {
        result.stt.fasterWhisper.serverUrl = process.env.WHISPER_SERVER_URL;
    }
    if (process.env.WHISPER_MODEL) {
        result.stt.fasterWhisper.model = process.env.WHISPER_MODEL as any;
    }
    if (process.env.WHISPER_DEVICE) {
        result.stt.fasterWhisper.device = process.env.WHISPER_DEVICE as any;
    }
    if (process.env.WHISPER_COMPUTE_TYPE) {
        result.stt.fasterWhisper.computeType = process.env.WHISPER_COMPUTE_TYPE as any;
    }

    // テストモード（自律行動の間隔を短くする）
    if (process.env.AUTONOMOUS_TEST === 'true' || process.env.NODE_ENV === 'test') {
        result.autonomous = {
            ...result.autonomous,
            minIntervalMs: 10000,           // 10秒
            maxDailyActions: 10,
            workDurationMs: 120000,         // 2分
            idleThresholdMs: 10000,         // 10秒
            greetingIdleThresholdSeconds: 30,
        };
        result.idleDetector = {
            idleThresholdSeconds: 10,
            checkIntervalMs: 5000,
        };
        console.log('[Config] テストモードが有効です（短い間隔で自律行動）');
    }

    return result;
}

/**
 * 設定を初期化
 *
 * アプリケーション起動時に1回だけ呼び出してください。
 *
 * @returns 読み込まれた設定
 */
export async function initConfig(): Promise<AppConfig> {
    const projectRoot = getProjectRoot();
    console.log(`[Config] プロジェクトルート: ${projectRoot}`);

    let mergedConfig = { ...DEFAULT_CONFIG };

    // 1. デフォルト設定を読み込む
    const defaultPath = path.join(projectRoot, 'config', 'default.json');
    try {
        const defaultJson = await readJsonFile(defaultPath);
        // _comment フィールドを除去
        const cleanDefault = removeCommentFields(defaultJson);
        mergedConfig = deepMerge(mergedConfig, cleanDefault);
        console.log(`[Config] デフォルト設定を読み込みました: ${defaultPath}`);
    } catch (error) {
        console.warn(`[Config] デフォルト設定ファイルが見つかりません: ${defaultPath}`);
        console.warn('[Config] ビルトインのデフォルト値を使用します');
    }

    // 2. ユーザー設定を読み込む（オプション）
    const userPath = path.join(projectRoot, 'config', 'config.json');
    try {
        const userJson = await readJsonFile(userPath);
        const cleanUser = removeCommentFields(userJson);
        mergedConfig = deepMerge(mergedConfig, cleanUser);
        console.log(`[Config] ユーザー設定を読み込みました: ${userPath}`);
    } catch (error) {
        // ユーザー設定がなくても問題ない
        console.log(`[Config] ユーザー設定ファイルがありません（オプション）: ${userPath}`);
    }

    // 3. 環境変数で上書き
    mergedConfig = applyEnvironmentOverrides(mergedConfig);

    // グローバル設定を更新（Proxyが参照し続けるオブジェクトを直接更新）
    // _config = mergedConfig; は Proxy が古いオブジェクトを参照し続けるため NG
    Object.keys(mergedConfig).forEach(key => {
        (_config as any)[key] = (mergedConfig as any)[key];
    });

    console.log('[Config] 設定の初期化が完了しました');
    logConfigSummary(_config);

    return mergedConfig;
}

/**
 * _comment フィールドを再帰的に除去
 */
function removeCommentFields(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(removeCommentFields);
    }

    const result: any = {};
    for (const key in obj) {
        if (key === '_comment' || key === '_usage') {
            continue;
        }
        result[key] = removeCommentFields(obj[key]);
    }
    return result;
}

/**
 * 設定の概要をログ出力
 */
function logConfigSummary(config: AppConfig): void {
    console.log('[Config] 設定概要:');
    console.log(`  - LLM: ${config.llm.preference} (Ollama: ${config.llm.ollama.model})`);
    console.log(`  - STT: ${config.stt.provider}`);
    console.log(`  - TTS: VOICEVOX (話者ID: ${config.tts.voicevox.speakerId})`);
    console.log(`  - 自律行動: ${config.autonomous.enabled ? '有効' : '無効'} (間隔: ${config.autonomous.minIntervalMs / 60000}分)`);
    console.log(`  - 画面認識: ${config.screenRecognition.windowMonitorEnabled ? '有効' : '無効'}`);
    console.log(`  - Discord admin: ${config.discord.admin ? `${config.discord.admin.name} (${config.discord.admin.id})` : '未設定'}`);
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * 設定を再読み込み
 *
 * 実行中に設定ファイルを変更した場合に使用します。
 * 通常は再起動を推奨します。
 */
export async function reloadConfig(): Promise<AppConfig> {
    console.log('[Config] 設定を再読み込みします...');
    return await initConfig();
}

/**
 * 現在の設定をファイルに保存
 *
 * デバッグ用。ユーザー設定として保存します。
 */
export async function saveCurrentConfig(): Promise<void> {
    const projectRoot = getProjectRoot();
    const userPath = path.join(projectRoot, 'config', 'config.json');

    const content = JSON.stringify(_config, null, 2);
    await fs.writeFile(userPath, content, 'utf-8');

    console.log(`[Config] 設定を保存しました: ${userPath}`);
}

/**
 * テスト用設定を取得
 *
 * 自律行動などの間隔が短いテスト用設定を返します。
 */
export function getTestConfig(): AppConfig {
    return {
        ..._config,
        autonomous: {
            enabled: true,
            minIntervalMs: 10000,
            maxDailyActions: 10,
            workDurationMs: 120000,
            idleThresholdMs: 10000,
            greetingIdleThresholdSeconds: 30,
        },
        idleDetector: {
            idleThresholdSeconds: 10,
            checkIntervalMs: 5000,
        },
    };
}
