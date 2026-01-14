export interface ToolParameterProperty {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: string[];
}

export interface ToolParameters {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required: string[];
    [k: string]: unknown;
}

export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: ToolParameters;
}

export interface ToolResult {
    success: boolean;
    result?: string;
    error?: string;
}

export interface Tool {
    definition: ToolDefinition;
    execute(input: Record<string, unknown>): Promise<ToolResult>;
}