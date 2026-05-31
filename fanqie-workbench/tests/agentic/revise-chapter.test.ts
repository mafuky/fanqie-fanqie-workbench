import { describe, it, expect } from 'vitest'
import { reviseChapterPhase } from '../../src/agentic/phases/revise-chapter.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1', bookRoot: '/tmp/book', chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 5, title: '第五章', sourcePath: '/tmp/book/正文/第005章.md', stage: '已写作' },
    previousPhaseResults: { reviseInstruction: '把男主改得更冷酷一点' },
    ...overrides,
  }
}

describe('reviseChapterPhase', () => {
  it('has correct name and read+write tools', () => {
    expect(reviseChapterPhase.name).toBe('revise-chapter')
    expect(reviseChapterPhase.tools).toEqual(['read_file', 'write_file'])
    expect(reviseChapterPhase.maxIterations).toBe(6)
  })
  it('systemPrompt targets the chapter sourcePath and mentions tracking context', () => {
    const prompt = reviseChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第005章.md')
    expect(prompt).toContain('追踪/上下文.md')
  })
  it('initialUserMessage carries the revise instruction from previousPhaseResults', () => {
    expect(reviseChapterPhase.initialUserMessage(makeCtx())).toContain('把男主改得更冷酷一点')
  })
  it('initialUserMessage does not throw when instruction is missing', () => {
    expect(typeof reviseChapterPhase.initialUserMessage(makeCtx({ previousPhaseResults: {} }))).toBe('string')
  })
  it('onComplete returns revised flag without error when instruction empty', async () => {
    const result = await reviseChapterPhase.onComplete!(makeCtx({ previousPhaseResults: {} }), { content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } } as any)
    expect(result).toEqual({ revised: true })
  })
})
