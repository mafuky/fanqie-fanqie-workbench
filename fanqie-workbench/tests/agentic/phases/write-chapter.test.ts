import { describe, expect, it } from 'vitest'
import { writeChapterPhase } from '../../../src/agentic/phases/write-chapter.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
  bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
  chapter: { id: 'c1', chapterNumber: 9, title: '九章', sourcePath: '正文/第009章.md', stage: '待写作' } as any,
  previousPhaseResults: { contextSummary: 'cs', materialsReport: 'mr' },
} as const

describe('write-chapter phase', () => {
  it('only allows read + write tools', () => {
    expect(writeChapterPhase.tools).toEqual(expect.arrayContaining(['read_file', 'write_file']))
    expect(writeChapterPhase.tools).not.toContain('ask_user')
  })

  it('prompt instructs writing to sourcePath', () => {
    const p = writeChapterPhase.systemPrompt(ctx)
    expect(p).toContain('正文/第009章.md')
  })

  it('initial message passes context + materials', () => {
    const m = writeChapterPhase.initialUserMessage(ctx)
    expect(m).toContain('cs')
    expect(m).toContain('mr')
  })
})
