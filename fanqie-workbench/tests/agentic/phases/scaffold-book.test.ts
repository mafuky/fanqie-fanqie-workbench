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
