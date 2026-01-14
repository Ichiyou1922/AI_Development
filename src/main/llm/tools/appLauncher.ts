import { Tool, ToolResult } from './types.js';
import { executeCommand } from './shellExecutor.js';
import { exec } from 'child_process'

// 許可されたアプリケーションのマッピング
const ALLOWED_APPS: Record<string, string> = {
    'firefox': 'firefox',
    'chrome': 'google-chrome',
    'chromium': 'chromium-browser',
    'vscode': 'code',
    'terminal': 'gnome-terminal',
    'files': 'nautilus',
    'calculator': 'gnome-calculator',
    'settings': 'gnome-control-center',
    'text-editor': 'gedit',
};

export const appLauncherTool: Tool = {
    definition: {
        name: 'Launch_application',
        description: 'アプリケーションを起動する．ユーザーがアプリを開いてほしいと依頼した場合に使用する．',
        input_schema: {
            type: 'object',
            properties: {
                app_name: {
                    type: 'string',
                    description: `起動するアプリケーション名．利用可能: ${Object.keys(ALLOWED_APPS).join(', ')}`,
                    enum: Object.keys(ALLOWED_APPS),
                },
            },
            required: ['app_name'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const appName = input.app_name as string;
        const command = ALLOWED_APPS[appName];

        if (!command) {
            return {
                success: false,
                error: `Unknown application: ${appName}. Available: ${Object.keys(ALLOWED_APPS).join(', ')}`,
            };
        }

        console.log(`[AppLauncher] Launching: ${command}`);

        // ホワイトリストを経由せず，直接起動
        return new Promise((resolve) => {
            const child = exec(command, { timeout: 5000 });

            // 即座に成功を返す
            child.unref()

            // 少し待ってエラーがなければ成功
            setTimeout(() => {
                resolve({
                    success: true,
                    result: `${appName}を起動しました`,
                });
            }, 500);

            child.on('error', (error) => {
                console.error(`[AppLauncher] Error:`, error);
                resolve({
                    success: false,
                    error: error.message,
                });
            });
        });
    },
};