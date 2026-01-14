import { Tool, ToolResult } from './types.js';

export const currentTimeTool: Tool = {
    definition: {
        name: 'get_current_time',
        description: '現在の日時を取得する．ユーザーが時刻や日付について質問した場合に使用する．',
        input_schema: {
            type: 'object',
            properties: {
                timezone: {
                    type: 'string',
                    description: 'タイムゾーン（例: "Asia/Tokyo", "UTC"）．省略時はシステムのローカル時刻',
                },
            },
            required: [],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        try {
            const timezone = input.timezone as string | undefined;

            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: timezone || undefined,
            };

            const formatted = new Intl.DateTimeFormat('ja-JP', options).format(now);

            return {
                success: true,
                result: formatted,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
};