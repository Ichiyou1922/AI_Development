/**
 * 設定モジュールのエントリポイント
 *
 * 使い方:
 * ```typescript
 * import { config, initConfig } from './config/index.js';
 *
 * // アプリ起動時に初期化
 * await initConfig();
 *
 * // 設定値の取得
 * const model = config.llm.ollama.model;
 * ```
 */

// 新しい統合設定システム（型とローダー）
export {
    // 主要な型
    AppConfig,
    PartialAppConfig,
    LLMConfig,
    OllamaConfig,
    AnthropicConfig,
    STTConfig,
    FasterWhisperConfig,
    TTSConfig,
    VoicevoxConfig,
    MemoryConfig,
    EmbeddingConfig,
    VectorStoreConfig,
    MemoryLifecycleConfig,
    ScreenRecognitionConfig,
    DiscordConfig,
    PromptsConfig,
    // AutonomousConfig と IdleDetectorConfig は autonomous.ts から
} from './types.js';

export {
    config,
    getConfig,
    initConfig,
    reloadConfig,
    saveCurrentConfig,
    getTestConfig,
} from './configLoader.js';

// 後方互換性のため残す（既存コードが依存）
// AutonomousConfig, IdleDetectorConfig はこちらからエクスポート
export {
    AutonomousConfig,
    IdleDetectorConfig,
    productionConfig,
    productionIdleConfig,
    testConfig,
    testIdleConfig,
    getAutonomousConfig,
    getIdleDetectorConfig,
    IgnoreDetectorConfig,
    productionIgnoreConfig,
    testIgnoreConfig,
    getIgnoreDetectorConfig,
} from './autonomous.js';
