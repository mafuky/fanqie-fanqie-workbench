import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}))

import { createOpenAiProvider } from '../../../src/agentic/providers/openai-provider.js'

describe('OpenAiProvider', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('sends messages and returns content + usage', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'hello', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.content).toBe('hello')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(result.finishReason).toBe('stop')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    }))
  })

  it('serializes tools and parses tool_calls from response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.md"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'read a.md' }],
      tools: [{
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    })
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: { path: 'a.md' } }])
    expect(result.finishReason).toBe('tool_calls')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [{
        type: 'function',
        function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      }],
    }))
  })

  it('round-trips an assistant message with tool_calls and a tool result', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'done', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 2 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    await provider.chat({
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.md' } }] },
        { role: 'tool', toolCallId: 'call_1', name: 'read_file', content: 'file body' },
      ],
    })
    const sent = mockCreate.mock.calls[0][0].messages
    expect(sent[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.md"}' } }],
    })
    expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'file body' })
  })

  it('streams content via onDelta when stream=true', async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'he' }, finish_reason: null }] }
      yield { choices: [{ delta: { content: 'llo' }, finish_reason: null }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }
    }
    mockCreate.mockResolvedValueOnce(fakeStream())
    const deltas: string[] = []
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => deltas.push(d),
    })
    expect(deltas).toEqual(['he', 'llo'])
    expect(result.content).toBe('hello')
    expect(result.usage.promptTokens).toBe(4)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true, stream_options: { include_usage: true } }))
  })
})
