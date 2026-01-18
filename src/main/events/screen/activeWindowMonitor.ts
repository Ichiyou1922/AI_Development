import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

/**
 * ウィンドウ情報
 */
export interface WindowInfo {
    id: string;
    pid: number;
    name: string;        // アプリケーション名
    title: string;       // ウィンドウタイトル
    timestamp: number;
}

/**
 * 抽出された画面コンテキスト
 */
export interface ScreenContext {
    app: string;
    category: AppCategory;
    details: {
        siteName?: string;
        videoTitle?: string;
        fileName?: string;
        projectName?: string;
    };
    raw: WindowInfo;
}

/**
 * アプリカテゴリ
 */
export type AppCategory =
    | 'browser'
    | 'editor'
    | 'terminal'
    | 'game'
    | 'media'
    | 'communication'
    | 'office'
    | 'other';

/**
 * アクティブウィンドウ監視
 */
export class ActiveWindowMonitor extends EventEmitter {
    private pollInterval: NodeJS.Timeout | null = null;
    private lastWindow: WindowInfo | null = null;
    private config = {
        pollIntervalMs: 2000,  // 2秒ごと
        enabled: true,
    };

    // アプリ名とカテゴリのマッピング
    private readonly appCategories: Record<string, AppCategory> = {
        // ブラウザ
        'chrome': 'browser',
        'chromium': 'browser',
        'firefox': 'browser',
        'brave': 'browser',
        'edge': 'browser',
        'opera': 'browser',
        'vivaldi': 'browser',
        // エディタ
        'code': 'editor',
        'vscode': 'editor',
        'vim': 'editor',
        'nvim': 'editor',
        'emacs': 'editor',
        'sublime': 'editor',
        'atom': 'editor',
        'jetbrains': 'editor',
        'idea': 'editor',
        // ターミナル
        'gnome-terminal': 'terminal',
        'konsole': 'terminal',
        'alacritty': 'terminal',
        'kitty': 'terminal',
        'xterm': 'terminal',
        'terminator': 'terminal',
        // ゲーム
        'steam': 'game',
        'lutris': 'game',
        // メディア
        'vlc': 'media',
        'mpv': 'media',
        'spotify': 'media',
        'rhythmbox': 'media',
        // コミュニケーション
        'discord': 'communication',
        'slack': 'communication',
        'telegram': 'communication',
        'teams': 'communication',
        'zoom': 'communication',
        // オフィス
        'libreoffice': 'office',
        'writer': 'office',
        'calc': 'office',
        'impress': 'office',
    };

    /**
     * 監視を開始
     */
    start(config?: Partial<typeof this.config>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }

        this.stop();

        if (!this.config.enabled) return;

        this.pollInterval = setInterval(() => {
            this.checkActiveWindow();
        }, this.config.pollIntervalMs);

        // 即座に1回実行
        this.checkActiveWindow();

        console.log('[ActiveWindowMonitor] Started');
    }

    /**
     * 監視を停止
     */
    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        console.log('[ActiveWindowMonitor] Stopped');
    }

    /**
     * アクティブウィンドウをチェック
     */
    private async checkActiveWindow(): Promise<void> {
        try {
            const windowInfo = await this.getActiveWindow();
            if (!windowInfo) return;

            // ウィンドウが変わった場合のみイベント発火
            if (this.hasWindowChanged(windowInfo)) {
                const context = this.extractContext(windowInfo);

                this.emit('windowChange', {
                    previous: this.lastWindow,
                    current: windowInfo,
                    context,
                });

                this.lastWindow = windowInfo;
            }
        } catch (error) {
            // xdotoolがない場合などのエラーは静かに無視
            if ((error as Error).message?.includes('not found')) {
                console.warn('[ActiveWindowMonitor] xdotool not installed');
                this.stop();
            }
        }
    }

    /**
     * アクティブウィンドウ情報を取得（Linux）
     */
    private async getActiveWindow(): Promise<WindowInfo | null> {
        try {
            // ウィンドウID取得
            const { stdout: windowId } = await execAsync('xdotool getactivewindow');
            const id = windowId.trim();

            // ウィンドウ名（タイトル）取得
            const { stdout: windowName } = await execAsync(`xdotool getwindowname ${id}`);
            const title = windowName.trim();

            // PID取得
            const { stdout: pidStr } = await execAsync(`xdotool getwindowpid ${id}`);
            const pid = parseInt(pidStr.trim(), 10);

            // プロセス名取得
            const { stdout: processName } = await execAsync(`ps -p ${pid} -o comm=`);
            const name = processName.trim();

            return {
                id,
                pid,
                name,
                title,
                timestamp: Date.now(),
            };
        } catch {
            return null;
        }
    }

    /**
     * ウィンドウが変わったか判定
     */
    private hasWindowChanged(current: WindowInfo): boolean {
        if (!this.lastWindow) return true;
        return this.lastWindow.id !== current.id ||
            this.lastWindow.title !== current.title;
    }

    /**
     * ウィンドウ情報からコンテキストを抽出
     */
    extractContext(windowInfo: WindowInfo): ScreenContext {
        const appLower = windowInfo.name.toLowerCase();
        const titleLower = windowInfo.title.toLowerCase();

        // カテゴリ判定
        let category: AppCategory = 'other';
        for (const [key, cat] of Object.entries(this.appCategories)) {
            if (appLower.includes(key)) {
                category = cat;
                break;
            }
        }

        // 詳細情報の抽出
        const details: ScreenContext['details'] = {};

        if (category === 'browser') {
            // ブラウザの場合：サイト名，動画タイトルを抽出
            const parsed = this.parseBrowserTitle(windowInfo.title);
            details.siteName = parsed.siteName;
            details.videoTitle = parsed.videoTitle;
        } else if (category === 'editor') {
            // エディタの場合：ファイル名，プロジェクト名を抽出
            const parsed = this.parseEditorTitle(windowInfo.title);
            details.fileName = parsed.fileName;
            details.projectName = parsed.projectName;
        }

        return {
            app: windowInfo.name,
            category,
            details,
            raw: windowInfo,
        };
    }

    /**
     * ブラウザタイトルを解析
     */
    private parseBrowserTitle(title: string): { siteName?: string; videoTitle?: string } {
        const result: { siteName?: string; videoTitle?: string } = {};

        // YouTube検出
        if (title.toLowerCase().includes('youtube')) {
            // "動画タイトル - YouTube" 形式
            const match = title.match(/^(.+?)\s*[-–—]\s*YouTube/i);
            if (match) {
                result.videoTitle = match[1].trim();
            }
            result.siteName = 'YouTube';
        }
        // 一般的なパターン: "ページタイトル - サイト名 - ブラウザ"
        else {
            const parts = title.split(/\s*[-–—|]\s*/);
            if (parts.length >= 2) {
                // 最後の部分がブラウザ名なら除外
                const browsers = ['chrome', 'firefox', 'brave', 'edge', 'opera', 'chromium'];
                let endIndex = parts.length;
                if (browsers.some(b => parts[parts.length - 1].toLowerCase().includes(b))) {
                    endIndex = parts.length - 1;
                }

                if (endIndex >= 2) {
                    result.siteName = parts[endIndex - 1];
                }
            }
        }

        return result;
    }

    /**
     * エディタタイトルを解析
     */
    private parseEditorTitle(title: string): { fileName?: string; projectName?: string } {
        const result: { fileName?: string; projectName?: string } = {};

        // VSCode: "ファイル名 - フォルダ名 - Visual Studio Code"
        const vscodeMatch = title.match(/^(.+?)\s*[-–—]\s*(.+?)\s*[-–—]\s*Visual Studio Code/i);
        if (vscodeMatch) {
            result.fileName = vscodeMatch[1].trim();
            result.projectName = vscodeMatch[2].trim();
            return result;
        }

        // 一般的なパターン
        const parts = title.split(/\s*[-–—]\s*/);
        if (parts.length >= 1) {
            result.fileName = parts[0];
        }

        return result;
    }

    /**
     * 現在のウィンドウ情報を取得
     */
    getCurrentWindow(): WindowInfo | null {
        return this.lastWindow;
    }

    /**
     * 現在のコンテキストを取得
     */
    getCurrentContext(): ScreenContext | null {
        if (!this.lastWindow) return null;
        return this.extractContext(this.lastWindow);
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<typeof this.config>): void {
        this.config = { ...this.config, ...config };
    }
}

export const activeWindowMonitor = new ActiveWindowMonitor();