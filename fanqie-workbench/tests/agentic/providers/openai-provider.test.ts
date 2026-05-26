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
})
