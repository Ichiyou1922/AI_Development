import { Tool, ToolResult } from './types.js';
import { executeCommand } from './shellExecutor.js';

export const notificationTool: Tool = {
    definition: {
        name: 'send_notification',
        description: 'デスクトップ通知を送信．ユーザーに何かを知らせたい場合や，リマインダーとして使用する．',
        input_schema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: '通知のタイトル',
                },
                message: {
                    type: 'string',
                    description: '通知の本文',
                },
                urgency: {
                    type: 'string',
                    description: '緊急度: "los", "normal", "critical"',
                    enum: ['low', 'normal', 'critical'],
                },
            },
            required: ['title', 'message'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const title = input.title as string;
        const message = input.message as string;
        const urgency = (input.urgency as string) || 'normal';

        // 引数のサニタイズ（シングルクォートはエスケープ）
        const safeTitle = title.replace(/'/g, "'\\''");
        const safeMessage = message.replace(/'/g, "'\\''");

        const command = `notify-send -u ${urgency} '${safeTitle}' '${safeMessage}'`;
        const result = await executeCommand(command);

        if (result.success) {
            return {
                success: true,
                result: `通知を送信しました: ${title}`,
            };
        } else {
            return {
                success: false,
                error: result.error,
            };
        }
    },
};