import { describe, expect, it } from 'vitest'
import { scaffoldBookPhase } from '../../../src/agentic/phases/scaffold-book.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x/书', chapterId: null,
  bookMeta: { id: 'b1', title: 'T', rootPath: '/x/书' } as any,
  chapter: null,
  previousPhaseResults: { directionSummary: 'sd' },
} as const

describe('scaffold-book phase', () => {
  it('uses read_file + write_file', () => {
    expect(scaffoldBookPhase.tools).toEqual(expect.arrayContaining(['read_file', 'write_file']))
  })

  it('prompt lists all 9 scaffold files', () => {
    const p = scaffoldBookPhase.systemPrompt(ctx)
    expect(p).toContain('大纲/总纲.md')
    expect(p).toContain('设定/世界观.md')
    expect(p).toContain('设定/角色/主角.md')
    expect(p).toContain('设定/角色/反派.md')
    expect(p).toContain('追踪/上下文.md')
    expect(p).toContain('追踪/伏笔.md')
    expect(p).toContain('追踪/时间线.md')
    expect(p).toContain('大纲/细纲_第001章.md')
    expect(p).toContain('正文/第001章.md')
  })
})

describe('scaffoldBookPhase writes 设定/方向.md', () => {
  it('system prompt instructs writing 设定/方向.md from the direction summary', () => {
    const c = {
      bookId: 'book-1',
      bookRoot: '/novels/雾港疑局',
      chapterId: null,
      bookMeta: { id: 'book-1', title: '雾港疑局', rootPath: '/novels/雾港疑局' },
      chapter: null,
      previousPhaseResults: { directionSummary: '## 题材\n现代悬疑\n## 平台\n番茄' },
    } as any
    const prompt = scaffoldBookPhase.systemPrompt(c)
    expect(prompt).toContain('设定/方向.md')
    expect(prompt).toContain('现代悬疑') // direction summary embedded
    expect(scaffoldBookPhase.tools).toContain('write_file')
  })
})
