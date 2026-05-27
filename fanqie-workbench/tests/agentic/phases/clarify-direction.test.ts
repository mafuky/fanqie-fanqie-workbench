import { describe, expect, it } from 'vitest'
import { clarifyDirectionPhase } from '../../../src/agentic/phases/clarify-direction.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x/书', chapterId: null,
  bookMeta: { id: 'b1', title: '新书', rootPath: '/x/书' } as any,
  chapter: null,
  previousPhaseResults: {},
} as const

describe('clarify-direction phase', () => {
  it('uses ask_user + write_file tools', () => {
    expect(clarifyDirectionPhase.tools).toEqual(expect.arrayContaining(['ask_user', 'write_file']))
  })

  it('system prompt asks 4 core questions and mentions writing to 设定/方向.md', () => {
    const p = clarifyDirectionPhase.systemPrompt(ctx)
    expect(p).toMatch(/题材|核心梗/)
    expect(p).toMatch(/平台/)
    expect(p).toMatch(/字数|篇幅/)
    expect(p).toMatch(/钩子|方向/)
    expect(p).toMatch(/设定\/方向\.md/)
  })

  it('initial message references the book title', () => {
    const m = clarifyDirectionPhase.initialUserMessage(ctx)
    expect(m).toContain('新书')
  })
})
