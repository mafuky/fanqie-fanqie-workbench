import OpenAI from 'openai'
import type { ChatInput, ChatMessage, ChatResult, LlmProvider, ToolCall } from './provider.js'

export interface OpenAiProviderOptions {
  apiKey: string
  baseUrl?: string
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
  return {
    name: 'openai',
    async chat(input: ChatInput): Promise<ChatResult> {
      const response = await client.chat.completions.create({
        model: input.model,
        messages: input.messages.map(toOpenAiMessage),
        tools: input.tools?.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      })
      const choice = response.choices[0]
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
      }))
      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason as ChatResult['finishReason'],
      }
    },
  }
}

function toOpenAiMessage(msg: ChatMessage): any {
  if (msg.role === 'tool') {
    return { role: 'tool', tool_call_id: msg.toolCallId, name: msg.name, content: msg.content }
  }
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    }
  }
  return { role: msg.role, content: msg.content }
}
