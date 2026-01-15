import { BrowserWindow, screen, Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';

// app.isQuittingを使うためにapp objectを拡張
const appWithQuitting = app as typeof app & { isQuitting?: boolean };

export class MascotWindow {
    private window: BrowserWindow | null = null;
    private tray: Tray | null = null;
    private isVisible: boolean = true;
    
    // ウィンドウサイズ
    private readonly WIDTH = 300;
    private readonly HEIGHT = 350;

    /**
     * マスコットウィンドウを作成
     */
    create(): BrowserWindow {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        this.window = new BrowserWindow({
            width: this.WIDTH,
            height: this.HEIGHT,
            x: screenWidth - this.WIDTH - 20,
            y: screenHeight - this.HEIGHT - 20,
            transparent: true,
            frame: false,
            hasShadow: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        // マスコット専用HTMLをロード
        this.window.loadFile(path.join(__dirname, '../renderer/mascot.html'));

        // DevTools（開発時のみ）
        // this.window.webContents.openDevTools({ mode: 'detach' });

        // 閉じるボタンで非表示にする（終了しない）
        this.window.on('close', (e) => {
            if (!appWithQuitting.isQuitting) {
                e.preventDefault();
                this.hide();
            }
        });

        this.setupTray();

        return this.window;
    }

    /**
     * システムトレイを設定
     */
    private setupTray(): void {
        // トレイアイコン（16x16または32x32のPNG推奨）
        const iconPath = path.join(__dirname, '../renderer/assets/tray-icon.png');
        
        // アイコンが存在しない場合はデフォルトアイコンを作成
        let trayIcon: Electron.NativeImage;
        try {
            trayIcon = nativeImage.createFromPath(iconPath);
            if (trayIcon.isEmpty()) {
                trayIcon = this.createDefaultIcon();
            }
        } catch {
            trayIcon = this.createDefaultIcon();
        }

        this.tray = new Tray(trayIcon);
        this.tray.setToolTip('AI Avatar');

        const contextMenu = Menu.buildFromTemplate([
            {
                label: '表示/非表示',
                click: () => this.toggle(),
            },
            {
                label: 'メインウィンドウを開く',
                click: () => this.openMainWindow(),
            },
            { type: 'separator' },
            {
                label: '終了',
                click: () => {
                    appWithQuitting.isQuitting = true;
                    app.quit();
                },
            },
        ]);

        this.tray.setContextMenu(contextMenu);

        // トレイアイコンクリックで表示/非表示切り替え
        this.tray.on('click', () => {
            this.toggle();
        });
    }

    /**
     * デフォルトのトレイアイコンを作成
     */
    private createDefaultIcon(): Electron.NativeImage {
        // 16x16の簡易アイコン
        const size = 16;
        const canvas = Buffer.alloc(size * size * 4);
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                // 円形のアイコン
                const cx = size / 2;
                const cy = size / 2;
                const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                
                if (dist < size / 2 - 1) {
                    canvas[idx] = 100;     // R
                    canvas[idx + 1] = 150; // G
                    canvas[idx + 2] = 255; // B
                    canvas[idx + 3] = 255; // A
                } else {
                    canvas[idx + 3] = 0;   // 透明
                }
            }
        }

        return nativeImage.createFromBuffer(canvas, {
            width: size,
            height: size,
        });
    }

    /**
     * メインウィンドウを開く（外部から注入）
     */
    private openMainWindowCallback: (() => void) | null = null;

    setOpenMainWindowCallback(callback: () => void): void {
        this.openMainWindowCallback = callback;
    }

    private openMainWindow(): void {
        if (this.openMainWindowCallback) {
            this.openMainWindowCallback();
        }
    }

    /**
     * 表示
     */
    show(): void {
        if (this.window) {
            this.window.show();
            this.isVisible = true;
        }
    }

    /**
     * 非表示
     */
    hide(): void {
        if (this.window) {
            this.window.hide();
            this.isVisible = false;
        }
    }

    /**
     * 表示/非表示切り替え
     */
    toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * ウィンドウを取得
     */
    getWindow(): BrowserWindow | null {
        return this.window;
    }

    /**
     * 破棄
     */
    destroy(): void {
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
        if (this.window) {
            this.window.destroy();
            this.window = null;
        }
    }
}