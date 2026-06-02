import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerSentenceRoutes } from '../../src/server/routes/sentence.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'

function buildApp(provider: LlmProvider) {
  const app = Fastify()
  registerSentenceRoutes(app, { provider, model: 'gpt-x' })
  return app
}

const okProvider: LlmProvider = {
  name: 'fake',
  async chat() {
    return { content: '["改一","改二"]', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
  },
}

describe('POST /api/sentence/revise', () => {
  it('returns candidates for a valid request', async () => {
    const app = buildApp(okProvider)
    const res = await app.inject({
      method: 'POST', url: '/api/sentence/revise',
      payload: { sentence: '他微微一笑。', context: '前文。', mode: 'polish' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().candidates).toEqual(['改一', '改二'])
  })

  it('returns 400 when sentence is missing', async () => {
    const app = buildApp(okProvider)
    const res = await app.inject({ method: 'POST', url: '/api/sentence/revise', payload: { mode: 'polish' } })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for an unknown mode', async () => {
    const app = buildApp(okProvider)
    const res = await app.inject({
      method: 'POST', url: '/api/sentence/revise',
      payload: { sentence: '一句话。', mode: 'nonsense' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 502 when the provider fails', async () => {
    const failing: LlmProvider = { name: 'fail', async chat() { throw new Error('upstream boom') } }
    const app = buildApp(failing)
    const res = await app.inject({
      method: 'POST', url: '/api/sentence/revise',
      payload: { sentence: '一句话。', mode: 'deslop' },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toMatch(/boom/)
  })
})
