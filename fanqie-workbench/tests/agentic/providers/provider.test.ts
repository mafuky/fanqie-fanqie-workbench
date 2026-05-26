import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatResult, LlmProvider, ToolCall, ToolSpec } from '../../../src/agentic/providers/provider.js'

describe('provider types', () => {
  it('ChatMessage supports assistant + tool roles', () => {
    const assistantMsg: ChatMessage = { role: 'assistant', content: 'hi', toolCalls: [] }
    const toolMsg: ChatMessage = { role: 'tool', toolCallId: 't1', name: 'read_file', content: '{}' }
    expect(assistantMsg.role).toBe('assistant')
    expect(toolMsg.toolCallId).toBe('t1')
  })

  it('ToolSpec uses JSON Schema for parameters', () => {
    const spec: ToolSpec = {
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    }
    expect(spec.parameters).toBeTypeOf('object')
  })

  it('LlmProvider interface compiles', () => {
    const fake: LlmProvider = {
      name: 'fake',
      async chat(_input): Promise<ChatResult> {
        return { content: '', toolCalls: [] as ToolCall[], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    expect(fake.name).toBe('fake')
  })
})
