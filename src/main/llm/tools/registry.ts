import { Tool, ToolDefinition, ToolResult } from './types.js';
import { currentTimeTool } from './currentTime.js';
import { calculatorTool } from './calculator.js';
import { notificationTool } from './notification.js';
import { appLauncherTool } from './appLauncher.js';
import { nightModeTool } from './nightMode.js';
import { readFilePathTool, listDirTool, searchFilesTool } from './fileBrowser.js';

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    constructor() {
        // デフォルトツールの登録
        this.register(currentTimeTool);
        this.register(calculatorTool);
        this.register(notificationTool);
        this.register(appLauncherTool);
        this.register(nightModeTool);
        this.register(readFilePathTool);
        this.register(listDirTool);
        this.register(searchFilesTool);
    }

    register(tool: Tool): void {
        this.tools.set(tool.definition.name, tool);
    }

    unregister(name: string): void {
        this.tools.delete(name);
    }

    getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
        const tool = this.tools.get(name);

        if (!tool) {
            return { success: false, error: `Unknown tool: ${name}`};
        }

        console.log(`[ToolRegistry] Executing ${name} with input: `, input);
        const result = await tool.execute(input);
        console.log(`[ToolRegistry] Result: `, result);

        return result;
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }
}