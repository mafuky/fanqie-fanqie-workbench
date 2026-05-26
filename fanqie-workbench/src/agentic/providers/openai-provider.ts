import OpenAI from 'openai'
import type { ChatInput, ChatResult, LlmProvider } from './provider.js'

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
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      })
      const choice = response.choices[0]
      return {
        content: choice.message.content ?? '',
        toolCalls: [],
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason as ChatResult['finishReason'],
      }
    },
  }
}

function toOpenAiMessage(msg: import('./provider.js').ChatMessage): any {
  if (msg.role === 'tool') {
    return { role: 'tool', tool_call_id: msg.toolCallId, name: msg.name, content: msg.content }
  }
  return { role: msg.role, content: msg.content }
}
