import { describe, expect, it } from 'vitest'
import { loadContextPhase } from '../../../src/agentic/phases/load-context.js'

describe('load-context phase', () => {
  it('declares expected tools', () => {
    expect(loadContextPhase.name).toBe('load-context')
    expect(loadContextPhase.tools).toEqual(expect.arrayContaining(['read_file', 'list_dir', 'grep']))
  })

  it('builds a system prompt referencing the book root', () => {
    const prompt = loadContextPhase.systemPrompt({
      bookId: 'b1',
      bookRoot: '/x/书',
      chapterId: 'c1',
      bookMeta: { id: 'b1', title: '测试书', rootPath: '/x/书' } as any,
      chapter: { id: 'c1', chapterNumber: 5, title: '第五章', sourcePath: '正文/第005章.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(prompt).toContain('测试书')
    expect(prompt).toContain('第5章')
  })

  it('initialUserMessage asks to summarize context for the chapter', () => {
    const msg = loadContextPhase.initialUserMessage({
      bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 't', rootPath: '/x' } as any,
      chapter: { id: 'c1', chapterNumber: 5, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(msg).toMatch(/上下文|context/i)
  })
})
