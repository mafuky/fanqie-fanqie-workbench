import { describe, expect, it } from 'vitest'
import { checkMaterialsPhase } from '../../../src/agentic/phases/check-materials.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
  bookMeta: { id: 'b1', title: 't', rootPath: '/x' } as any,
  chapter: { id: 'c1', chapterNumber: 7, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
  previousPhaseResults: { contextSummary: 'prev summary' },
} as const

describe('check-materials phase', () => {
  it('allows ask_user tool', () => {
    expect(checkMaterialsPhase.tools).toContain('ask_user')
  })

  it('system prompt distinguishes hard vs soft missing materials', () => {
    const p = checkMaterialsPhase.systemPrompt(ctx)
    expect(p).toMatch(/硬阻塞/)
    expect(p).toMatch(/软提醒/)
  })

  it('initial user message passes previous context summary', () => {
    const m = checkMaterialsPhase.initialUserMessage(ctx)
    expect(m).toContain('prev summary')
  })
})
