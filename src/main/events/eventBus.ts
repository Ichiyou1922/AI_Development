import { EventEmitter } from 'events';
import {
    AgentEvent,
    EventType,
    EventPriority,
    EventHandler,
    HandlerRegistration,
} from './types.js';

/**
 * イベントバス
 * アプリケーション全体のイベント管理を担当
 */
export class EventBus extends EventEmitter {
    private handlers: Map<EventType | '*', HandlerRegistration[]> = new Map();
    private eventQueue: AgentEvent[] = [];
    private isProcessing: boolean = false;
    private isPaused: boolean = false;

    constructor() {
        super();
        this.setMaxListeners(50);
    }

    /**
     * イベントハンドラを登録
     */
    register(
        type: EventType | '*',
        handler: EventHandler,
        priority: EventPriority = EventPriority.NORMAL
    ): void {
        const registration: HandlerRegistration = { type, handler, priority };
        
        const existing = this.handlers.get(type) || [];
        existing.push(registration);
        
        // 優先度でソート（高い順）
        existing.sort((a, b) => b.priority - a.priority);
        
        this.handlers.set(type, existing);
        
        console.log(`[EventBus] Registered handler for "${type}" with priority ${priority}`);
    }

    /**
     * イベントハンドラを解除
     */
    unregister(type: EventType | '*', handler: EventHandler): void {
        const existing = this.handlers.get(type);
        if (!existing) return;
        
        const filtered = existing.filter(reg => reg.handler !== handler);
        this.handlers.set(type, filtered);
        
        console.log(`[EventBus] Unregistered handler for "${type}"`);
    }

    /**
     * イベントを発行（キューに追加）
     */
    publish(event: AgentEvent): void {
        // タイムスタンプがなければ追加
        if (!event.timestamp) {
            event.timestamp = Date.now();
        }

        console.log(`[EventBus] Publishing event: ${event.type}`, event.data);

        // 優先度でキューに挿入
        this.insertByPriority(event);

        // 処理を開始
        this.processQueue();
    }

    /**
     * 優先度順にキューに挿入
     */
    private insertByPriority(event: AgentEvent): void {
        // URGENTは先頭に
        if (event.priority === EventPriority.URGENT) {
            this.eventQueue.unshift(event);
            return;
        }
        
        // それ以外は優先度順に挿入
        let insertIndex = this.eventQueue.length;
        for (let i = 0; i < this.eventQueue.length; i++) {
            if (this.eventQueue[i].priority < event.priority) {
                insertIndex = i;
                break;
            }
        }
        this.eventQueue.splice(insertIndex, 0, event);
    }

    /**
     * キューを処理
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.isPaused) return;
        if (this.eventQueue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.eventQueue.length > 0 && !this.isPaused) {
            const event = this.eventQueue.shift()!;
            await this.dispatchEvent(event);
        }
        
        this.isProcessing = false;
    }

    /**
     * イベントをハンドラに配信
     */
    private async dispatchEvent(event: AgentEvent): Promise<void> {
        // 特定タイプのハンドラ
        const typeHandlers = this.handlers.get(event.type) || [];
        // ワイルドカードハンドラ
        const wildcardHandlers = this.handlers.get('*') || [];

        const allHandlers = [...typeHandlers, ...wildcardHandlers];

        console.log(`[EventBus] Dispatching "${event.type}" to ${allHandlers.length} handlers`);

        // 優先度でソート
        allHandlers.sort((a, b) => b.priority - a.priority);

        for (const registration of allHandlers) {
            try {
                await registration.handler(event);
            } catch (error) {
                console.error(`[EventBus] Handler error for "${event.type}":`, error);
                this.emit('error', { event, error });
            }
        }

        // EventEmitterにも通知
        this.emit(event.type, event);
        this.emit('event', event);
    }

    /**
     * イベント処理を一時停止
     */
    pause(): void {
        this.isPaused = true;
        console.log('[EventBus] Paused');
    }

    /**
     * イベント処理を再開
     */
    resume(): void {
        this.isPaused = false;
        console.log('[EventBus] Resumed');
        this.processQueue();
    }

    /**
     * キューをクリア
     */
    clearQueue(): void {
        this.eventQueue = [];
        console.log('[EventBus] Queue cleared');
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        queueLength: number;
        handlerCount: number;
        isProcessing: boolean;
        isPaused: boolean;
    } {
        let handlerCount = 0;
        for (const handlers of this.handlers.values()) {
            handlerCount += handlers.length;
        }
        
        return {
            queueLength: this.eventQueue.length,
            handlerCount,
            isProcessing: this.isProcessing,
            isPaused: this.isPaused,
        };
    }
}

// シングルトンインスタンス
export const eventBus = new EventBus();