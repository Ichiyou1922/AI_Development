/**
 * アプリケーション設定の型定義
 *
 * このファイルは設定ファイル（config.json）の構造を定義します。
 * 各セクションは機能ごとに分離されており、必要な設定のみを変更できます。
 *
 * 設定の優先順位:
 * 1. 環境変数（最優先）
 * 2. ユーザー設定ファイル（~/.config/ai-agent/config.json）
 * 3. プロジェクトルートの config.json
 * 4. デフォルト値（このファイルで定義）
 */

// AutonomousConfig と IdleDetectorConfig は autonomous.ts で定義
// 後方互換性のため、そちらを正とする
import type { AutonomousConfig, IdleDetectorConfig } from './autonomous.js';

// ============================================================
// LLM（大規模言語モデル）設定
// ============================================================

/**
 * Ollama（ローカルLLM）の設定
 *
 * Ollamaはローカルで動作するLLMサーバーです。
 * インターネット接続なしで動作し、プライバシーを保護できます。
 */
export interface OllamaConfig {
    /** OllamaサーバーのURL（通常は変更不要） */
    baseUrl: string;
    /** 使用するモデル名（例: 'gemma3:latest', 'llama3:8b'） */
    model: string;
    /** サーバー接続確認のタイムアウト（ミリ秒） */
    healthCheckTimeoutMs: number;
}

/**
 * Anthropic（Claude API）の設定
 *
 * Claudeは高品質な応答を生成しますが、API料金がかかります。
 * APIキーは環境変数 ANTHROPIC_API_KEY で設定してください。
 */
export interface AnthropicConfig {
    /** 使用するモデル名 */
    model: string;
    /** 応答の最大トークン数（長すぎると料金が増加） */
    maxTokens: number;
}

/**
 * LLM全体の設定
 */
export interface LLMConfig {
    ollama: OllamaConfig;
    anthropic: AnthropicConfig;
    /**
     * LLMプロバイダの優先順位
     * - 'local-first': Ollama優先、失敗時にAnthropic
     * - 'api-first': Anthropic優先、失敗時にOllama
     * - 'local-only': Ollamaのみ使用
     * - 'api-only': Anthropicのみ使用
     */
    preference: 'local-first' | 'api-first' | 'local-only' | 'api-only';
}

// ============================================================
// 音声認識（STT: Speech-to-Text）設定
// ============================================================

/**
 * Faster-Whisper（高速音声認識）の設定
 *
 * Pythonベースの高速Whisper実装です。
 * GPUを使用すると高速に処理できます。
 */
export interface FasterWhisperConfig {
    /** Whisperサーバーのurl */
    serverUrl: string;
    /** 使用するモデルサイズ（tiny, base, small, medium, large） */
    model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
    /** 使用デバイス（cuda: GPU, cpu: CPU） */
    device: 'cuda' | 'cpu';
    /** 計算精度（float16: 高速, float32: 高精度） */
    computeType: 'float16' | 'float32' | 'int8';
    /** サーバー起動待機の最大時間（ミリ秒） */
    serverStartupTimeoutMs: number;
    /** ヘルスチェックの間隔（ミリ秒） */
    healthCheckIntervalMs: number;
    /** 音声認識のタイムアウト（ミリ秒） */
    transcriptionTimeoutMs: number;
}

/**
 * 音声認識全体の設定
 */
export interface STTConfig {
    /** 使用するプロバイダ */
    provider: 'faster-whisper' | 'whisper-node';
    fasterWhisper: FasterWhisperConfig;
}

// ============================================================
// 音声合成（TTS: Text-to-Speech）設定
// ============================================================

/**
 * VOICEVOX（音声合成エンジン）の設定
 *
 * 日本語の自然な音声を生成できる無料エンジンです。
 * Docker経由で起動することを推奨します。
 */
export interface VoicevoxConfig {
    /** VOICEVOXエンジンのURL */
    baseUrl: string;
    /** 話者ID（VOICEVOXの話者一覧から選択） */
    speakerId: number;
    /** 読み上げ速度（1.0が標準、1.3で少し速い） */
    speedScale: number;
}

/**
 * 音声合成全体の設定
 */
export interface TTSConfig {
    voicevox: VoicevoxConfig;
}

// ============================================================
// 記憶システム設定
// ============================================================

/**
 * エンベディング（テキストのベクトル化）設定
 *
 * テキストを数値ベクトルに変換し、意味的類似度を計算できるようにします。
 */
export interface EmbeddingConfig {
    /** 使用するプロバイダ（xenova: ローカル, ollama: Ollamaサーバー） */
    provider: 'xenova' | 'ollama';
    xenova: {
        /** 使用するモデル名 */
        model: string;
        /** ベクトルの次元数（モデルによって異なる） */
        dimension: number;
    };
    ollama: {
        /** Ollamaのエンベディングモデル */
        model: string;
        /** ベクトルの次元数 */
        dimension: number;
    };
}

/**
 * ベクトルストア（記憶保存）設定
 */
export interface VectorStoreConfig {
    /** デフォルトの検索結果数 */
    defaultSearchLimit: number;
    /** 低重要度とみなす閾値（0.0〜1.0） */
    lowImportanceThreshold: number;
    /** 忘却候補として取得する件数 */
    forgetCandidateLimit: number;
}

/**
 * 記憶ライフサイクル（メンテナンス）設定
 */
export interface MemoryLifecycleConfig {
    /** 圧縮対象とする経過日数 */
    compressionAgeDays: number;
    /** 圧縮の最小記憶数 */
    compressionMinCount: number;
    /** 忘却判定の重要度閾値 */
    forgetImportanceThreshold: number;
    /** 評価対象の記憶数 */
    evaluationLimit: number;
    /** メンテナンス実行間隔（ミリ秒） */
    maintenanceIntervalMs: number;
}

/**
 * 記憶システム全体の設定
 */
export interface MemoryConfig {
    embedding: EmbeddingConfig;
    vectorStore: VectorStoreConfig;
    lifecycle: MemoryLifecycleConfig;
    /** コンテキスト構築時の検索結果数 */
    contextSearchLimit: number;
    /** コンテキスト構築時の最小スコア */
    contextMinScore: number;
}

// ============================================================
// 画面認識設定
// ============================================================

/**
 * 画面認識（アクティブウィンドウ監視）設定
 *
 * ユーザーが使用しているアプリケーションを監視し、
 * 状況に応じたコメントを生成する機能の設定です。
 */
export interface ScreenRecognitionConfig {
    /** ウィンドウ監視の有効/無効 */
    windowMonitorEnabled: boolean;
    /** スクリーンショット取得の有効/無効（プライバシー注意） */
    screenshotEnabled: boolean;
    /** ウィンドウ変更への反応の有効/無効 */
    reactToWindowChange: boolean;
    /** スクリーンショット取得間隔（ミリ秒） */
    screenshotIntervalMs: number;
    /** リアクションの最小間隔（ミリ秒） */
    minReactionIntervalMs: number;
    /** ウィンドウ監視のポーリング間隔（ミリ秒） */
    windowPollIntervalMs: number;
    screenshot: {
        /** 最大幅（ピクセル） */
        maxWidth: number;
        /** JPEG品質（0-100） */
        quality: number;
    };
}

// ============================================================
// Discord設定
// ============================================================

/**
 * Discord Bot設定
 */
export interface DiscordConfig {
    /** Botコマンドのプレフィックス */
    prefix: string;
    /** メッセージの最大長 */
    maxMessageLength: number;
    /** 管理者（製作者）情報 */
    admin: {
        /** Discord ユーザーID */
        id: string;
        /** 呼び名 */
        name: string;
    } | null;
    voice: {
        /** 無音判定時間（ミリ秒） */
        silenceDurationMs: number;
        /** 最小音声長（ミリ秒） */
        minAudioDurationMs: number;
        /** 最大音声長（ミリ秒） */
        maxAudioDurationMs: number;
        /** 入力サンプルレート */
        inputSampleRate: number;
        /** 出力サンプルレート */
        outputSampleRate: number;
    };
    /** Discord内での自律発話設定 */
    autonomous: {
        /** Discord自律発話の有効/無効 */
        enabled: boolean;
        /** テキストチャンネルにも送信するか */
        sendToTextChannel: boolean;
        /** 音声チャンネルでも発話するか */
        speakInVoice: boolean;
        /** デフォルトの送信先チャンネルID（nullで自動選択） */
        defaultChannelId: string | null;
    };
}

// ============================================================
// プロンプト設定
// ============================================================

/**
 * AIキャラクター設定
 *
 * AIの名前や基本情報を設定します。
 * 言語モデルが自分の名前を間違えないようにするために使用されます。
 */
export interface AICharacterConfig {
    /** AIの名前 */
    name: string;
}

/**
 * システムプロンプト設定
 *
 * AIの応答スタイルを決定する重要な設定です。
 * キャラクター性を変更したい場合はここを編集してください。
 */
export interface PromptsConfig {
    /** AIキャラクター設定 */
    character: AICharacterConfig;
    /** メインのシステムプロンプト（自律行動・画面認識すべてに使用） */
    system: string;
    /** 記憶管理用プロンプト */
    memory: {
        compression: string;
        evaluation: string;
    };
}

// ============================================================
// 統合設定
// ============================================================

/**
 * アプリケーション全体の設定
 *
 * この型がconfig.jsonのルート構造を定義します。
 * 各セクションは独立しており、必要な部分のみ上書きできます。
 */
export interface AppConfig {
    /** LLM（大規模言語モデル）設定 */
    llm: LLMConfig;
    /** 音声認識設定 */
    stt: STTConfig;
    /** 音声合成設定 */
    tts: TTSConfig;
    /** 記憶システム設定 */
    memory: MemoryConfig;
    /** 自律行動設定 */
    autonomous: AutonomousConfig;
    /** アイドル検出設定 */
    idleDetector: IdleDetectorConfig;
    /** 画面認識設定 */
    screenRecognition: ScreenRecognitionConfig;
    /** Discord設定 */
    discord: DiscordConfig;
    /** プロンプト設定 */
    prompts: PromptsConfig;
}

/**
 * 部分的な設定（上書き用）
 *
 * すべてのフィールドがオプショナルになります。
 * ユーザー設定ファイルでは必要な部分のみ指定できます。
 */
export type PartialAppConfig = DeepPartial<AppConfig>;

/**
 * 深い階層までオプショナルにする型ユーティリティ
 */
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
