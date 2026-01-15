/**
 * 自律行動システムの設定
 */

export interface AutonomousConfig {
    /** 自律行動の有効/無効 */
    enabled: boolean;
    /** 最小発話間隔（ミリ秒） */
    minIntervalMs: number;
    /** 1日の最大発話数 */
    maxDailyActions: number;
    /** 休憩提案までの作業時間（ミリ秒） */
    workDurationMs: number;
    /** アイドル判定時間（ミリ秒） */
    idleThresholdMs: number;
    /** 挨拶を行うアイドル時間（秒） */
    greetingIdleThresholdSeconds: number;
}

export interface IdleDetectorConfig {
    /** アイドル判定の閾値（秒） */
    idleThresholdSeconds: number;
    /** チェック間隔（ミリ秒） */
    checkIntervalMs: number;
}

/**
 * 本番用設定
 */
export const productionConfig: AutonomousConfig = {
    enabled: true,
    minIntervalMs: 30 * 60 * 1000,          // 30分
    maxDailyActions: 5,
    workDurationMs: 60 * 60 * 1000,         // 1時間
    idleThresholdMs: 5 * 60 * 1000,         // 5分
    greetingIdleThresholdSeconds: 600,      // 10分
};

export const productionIdleConfig: IdleDetectorConfig = {
    idleThresholdSeconds: 300,              // 5分
    checkIntervalMs: 60000,                 // 1分ごとにチェック
};

/**
 * テスト用設定
 */
export const testConfig: AutonomousConfig = {
    enabled: true,
    minIntervalMs: 10 * 1000,               // 10秒
    maxDailyActions: 10,
    workDurationMs: 2 * 60 * 1000,          // 2分
    idleThresholdMs: 10 * 1000,             // 10秒
    greetingIdleThresholdSeconds: 30,       // 30秒
};

export const testIdleConfig: IdleDetectorConfig = {
    idleThresholdSeconds: 10,               // 10秒
    checkIntervalMs: 5000,                  // 5秒ごとにチェック
};

/**
 * 環境に応じた設定を取得
 * NODE_ENV=test または AUTONOMOUS_TEST=true でテスト設定を使用
 */
export function getAutonomousConfig(): AutonomousConfig {
    const isTest = process.env.NODE_ENV === 'test' || process.env.AUTONOMOUS_TEST === 'true';
    return isTest ? testConfig : productionConfig;
}

export function getIdleDetectorConfig(): IdleDetectorConfig {
    const isTest = process.env.NODE_ENV === 'test' || process.env.AUTONOMOUS_TEST === 'true';
    return isTest ? testIdleConfig : productionIdleConfig;
}
