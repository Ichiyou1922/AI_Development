/**
 * イベントの優先度
 */
export enum EventPriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    URGENT = 3,
}

/**
 * イベントの種類
 */
export type EventType =
    | 'timer:interval'      // 定期実行
    | 'timer:scheduled'     // スケジュール実行
    | 'system:idle'         // アイドル検出
    | 'system:active'       // アクティブ復帰
    | 'system:lowBattery'   // バッテリー低下
    | 'user:greeting'       // 挨拶トリガー
    | 'user:reminder'       // リマインダー
    | 'user:ignoring'       // 無視検出
    | 'custom';             // カスタムイベント

/**
 * イベントデータの基底インターフェース
 */
export interface BaseEvent {
    type: EventType;
    priority: EventPriority;
    timestamp: number;
    data?: Record<string, unknown>;
}

/**
 * タイマーイベント
 */
export interface TimerEvent extends BaseEvent {
    type: 'timer:interval' | 'timer:scheduled';
    data: {
        name: string;
        intervalMs?: number;
        scheduledTime?: string;
    };
}

/**
 * システムイベント
 */
export interface SystemEvent extends BaseEvent {
    type: 'system:idle' | 'system:active' | 'system:lowBattery' | 'user:ignoring';
    data: {
        idleTime?: number;      // アイドル時間（秒）
        ignoreTime?: number;    // 無視時間（秒）
        batteryLevel?: number;  // バッテリー残量（%）
        source?: 'voice' | 'discord'; // 無視イベントのソース
    };
}

/**
 * ユーザーイベント
 */
export interface UserEvent extends BaseEvent {
    type: 'user:greeting' | 'user:reminder';
    data: {
        message?: string;
        context?: string;
    };
}

/**
 * すべてのイベント型
 */
export type AgentEvent = TimerEvent | SystemEvent | UserEvent | BaseEvent;

/**
 * イベントハンドラの型
 */
export type EventHandler = (event: AgentEvent) => Promise<void> | void;

/**
 * イベントハンドラの登録情報
 */
export interface HandlerRegistration {
    type: EventType | '*';  // '*' は全イベント
    handler: EventHandler;
    priority: EventPriority;
}