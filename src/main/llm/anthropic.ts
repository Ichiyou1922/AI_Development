import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, StreamCallbacks } from './types.js';
import { ToolRegistry, ToolDefinition } from './tools/index.js';

// Anthropic APIのメッセージ型
type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContent = Anthropic.ContentBlockParam;

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  private toolRegistry: ToolRegistry;

  constructor(apiKey: string | undefined, toolRegistry?: ToolRegistry) {
    this.client = new Anthropic({ apiKey });
    this.toolRegistry = toolRegistry || new ToolRegistry();
  }

  async sendMessageStream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const anthropicMessages = this.convertMessages(messages);
      const tools = this.toolRegistry.getDefinitions();

      let continueLoop = true;
      let fullText = '';

      while (continueLoop) {
        const stream = await this.client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: anthropicMessages,
          tools: tools.length > 0 ? tools : undefined,
        });

        if (signal) {
          signal.addEventListener('abort', () => stream.abort());
        }

        // ストリーミング中のテキストを収集
        let currentText = '';
        stream.on('text', (text) => {
          currentText += text;
          callbacks.onToken(text);
        });

        const finalMessage = await stream.finalMessage();

        // Tool Useがあるか確認
        const toolUseBlocks = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length > 0 && finalMessage.stop_reason === 'tool_use') {
          // ツール実行
          const toolResults: AnthropicContent[] = [];
          for (const toolUse of toolUseBlocks) {
            callbacks.onToken(`\n[ツール実行中: ${toolUse.name}...]\n`);
            
            const result = await this.toolRegistry.execute(
              toolUse.name,
              toolUse.input as Record<string, unknown>
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: result.success ? result.result! : `Error: ${result.error}`,
            });
          }

          // 履歴を更新して再ループ
          anthropicMessages.push({
            role: 'assistant',
            content: finalMessage.content,
          });
          anthropicMessages.push({
            role: 'user',
            content: toolResults,
          });

          fullText += currentText;
        } else {
          // Tool Use終了、通常のテキストレスポンス
          fullText += currentText;
          continueLoop = false;
        }
      }

      callbacks.onDone(fullText);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      callbacks.onError(message);
      throw error;
    }
  }

  private convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
    return messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}