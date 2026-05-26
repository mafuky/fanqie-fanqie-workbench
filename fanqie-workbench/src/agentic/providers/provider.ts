export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  usage: { promptTokens: number; completionTokens: number }
  finishReason: 'stop' | 'tool_calls' | 'length'
}

export interface ChatInput {
  messages: ChatMessage[]
  tools?: ToolSpec[]
  model: string
  maxTokens?: number
  temperature?: number
  onDelta?: (delta: string) => void
}

export interface LlmProvider {
  name: string
  chat(input: ChatInput): Promise<ChatResult>
}
