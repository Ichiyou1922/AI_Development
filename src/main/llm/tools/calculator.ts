import { Tool, ToolResult } from './types.js';

export const calculatorTool: Tool = {
    definition : {
        name: 'calculator',
        description: '数学的な計算を実行する．四則演算，累乗，平方根などに対応．',
        input_schema: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: '計算式（例: "2 + 3 * 4", "sqrt(16)", "2 ** 10"）',
                },
            },
            required: ['expression'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        try {
            const expression = input.expression as string;

            // 安全な計算のため許可された文字のみ通す
            const sanitized = expression.replace(/[^0-9+\-*/().%\s^]/g, '');

            // sqrt, powなどの関数をMathオブジェクトの関数に変換
            const processed = sanitized
                .replace(/sqrt/g, 'Math.sqrt')
                .replace(/pow/g, 'Math.pow')
                .replace(/\^/g, '**');

            // Function コンストラクタで評価
            const fn = new Function(`return (${processed})`);
            const result = fn();

            if (typeof result !== 'number' || !isFinite(result)) {
                return { success: false, error: 'Invalid calculation result' };
            }

            return {
                success: true,
                result: result.toString(),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Calculation error',
            };
        }
    },
};