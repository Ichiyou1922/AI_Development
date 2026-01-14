import { Tool, ToolResult } from './types.js';
import { executeCommand } from './shellExecutor.js';

export const nightModeTool: Tool = {
    definition: {
        name: 'toggle_night_mode',
        description: 'ナイトモード（ダークテーマ）のオン/オフを切り替える．目の疲れを軽減したい場合に使用する．',
        input_schema: {
            type: 'object',
            properties: {
                enable: {
                    type: 'boolean',
                    description: 'trueでナイトモードを有効化, falseで無効化',
                },
            },
            required: ['enable'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const enable = input.enable as boolean;

        // GNOMEデスクトップの場合
        const theme = enable ? 'prefer-dark' : 'default';
        const command = `gsettings set org.gnome.desktop.interface color-scheme '${theme}'`;

        const result = await executeCommand(command);

        if (result.success) {
            return {
                success: true,
                result: enable ? 'ナイトモードを有効にしました' : 'ナイトモードを無効にしました',
            };
        } else {
            return {
                success: false,
                error: result.error || 'ナイトモードの切り替えに失敗しました',
            };
        }
    },
};