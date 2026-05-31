import { describe, it, expect } from 'vitest'
import { deslopChapterPhase } from '../../src/agentic/phases/deslop-chapter.js'
import { reviewChapterPhase } from '../../src/agentic/phases/review-chapter.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1', bookRoot: '/tmp/book', chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 6, title: '第六章', sourcePath: '/tmp/book/正文/第006章.md', stage: '已写作' },
    previousPhaseResults: { contextSummary: '前情摘要' },
    ...overrides,
  }
}

describe('deslopChapterPhase', () => {
  it('rewrites the chapter file in place', () => {
    expect(deslopChapterPhase.name).toBe('deslop-chapter')
    expect(deslopChapterPhase.tools).toEqual(['read_file', 'write_file'])
    const prompt = deslopChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第006章.md')
    expect(prompt).toContain('AI')
  })
  it('onComplete returns deslopped flag', async () => {
    const result = await deslopChapterPhase.onComplete!(makeCtx(), { content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } } as any)
    expect(result).toEqual({ deslopped: true })
  })
})

describe('reviewChapterPhase', () => {
  it('is read-only and produces notes', () => {
    expect(reviewChapterPhase.name).toBe('review-chapter')
    expect(reviewChapterPhase.tools).toEqual(['read_file', 'list_dir'])
    const prompt = reviewChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第006章.md')
    expect(prompt).not.toContain('write_file')
  })
  it('onComplete returns reviewNotes from result content', async () => {
    const result = await reviewChapterPhase.onComplete!(makeCtx(), { content: '审查意见正文', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } } as any)
    expect(result).toEqual({ reviewNotes: '审查意见正文' })
  })
})
