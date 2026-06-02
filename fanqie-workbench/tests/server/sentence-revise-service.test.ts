import { describe, expect, it } from 'vitest'
import {
  buildSentenceMessages,
  parseCandidates,
  reviseSentence,
} from '../../src/server/sentence-revise-service.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'

function fakeProvider(content: string, capture?: (input: any) => void): LlmProvider {
  return {
    name: 'fake',
    async chat(input) {
      capture?.(input)
      return { content, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
    },
  }
}

describe('buildSentenceMessages', () => {
  it('embeds the sentence, context, and mode instruction', () => {
    const msgs = buildSentenceMessages('deslop', '他微微一笑。', '前文铺垫。', 3)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('AI 腔') // deslop instruction
    expect(msgs[0].content).toContain('3 个')
    expect(msgs[1].content).toContain('他微微一笑。')
    expect(msgs[1].content).toContain('前文铺垫。')
  })
  it('omits the context block when no context is given', () => {
    const msgs = buildSentenceMessages('polish', '一句话。', '', 2)
    expect(msgs[1].content).not.toContain('上下文')
  })
})

describe('parseCandidates', () => {
  it('parses a JSON array', () => {
    expect(parseCandidates('["甲","乙","丙"]', 3)).toEqual(['甲', '乙', '丙'])
  })
  it('parses a JSON array embedded in prose', () => {
    expect(parseCandidates('好的，结果如下：\n["甲","乙"]\n以上。', 3)).toEqual(['甲', '乙'])
  })
  it('falls back to numbered/bulleted lines and strips quotes', () => {
    expect(parseCandidates('1. “甲”\n2、乙\n- 丙', 3)).toEqual(['甲', '乙', '丙'])
  })
  it('respects the count cap', () => {
    expect(parseCandidates('["a","b","c","d"]', 2)).toEqual(['a', 'b'])
  })
})

describe('reviseSentence', () => {
  it('returns candidates from the provider', async () => {
    const { candidates } = await reviseSentence({
      provider: fakeProvider('["改一","改二","改三"]'),
      model: 'gpt-x', sentence: '原句。', mode: 'polish',
    })
    expect(candidates).toEqual(['改一', '改二', '改三'])
  })

  it('clamps count and forwards it into the prompt', async () => {
    let seen: any = null
    const { candidates } = await reviseSentence({
      provider: fakeProvider('["a","b","c","d","e","f"]', (i) => { seen = i }),
      model: 'gpt-x', sentence: '原句。', mode: 'expand', count: 99,
    })
    expect(candidates).toHaveLength(5) // clamped to max 5
    expect(seen.messages[0].content).toContain('5 个')
  })

  it('throws on an empty sentence', async () => {
    await expect(reviseSentence({ provider: fakeProvider('[]'), model: 'm', sentence: '   ', mode: 'polish' }))
      .rejects.toThrow(/sentence is required/i)
  })

  it('throws when the model produces no candidates', async () => {
    await expect(reviseSentence({ provider: fakeProvider(''), model: 'm', sentence: '原句。', mode: 'polish' }))
      .rejects.toThrow(/no candidates/i)
  })
})
