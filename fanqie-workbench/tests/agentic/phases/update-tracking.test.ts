import { describe, expect, it } from 'vitest'
import { updateTrackingPhase } from '../../../src/agentic/phases/update-tracking.js'

describe('update-tracking phase', () => {
  it('uses read_file + update_tracking tools only', () => {
    expect(updateTrackingPhase.tools).toEqual(['read_file', 'update_tracking'])
  })

  const ctx = () => ({
    bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
    bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
    chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
    previousPhaseResults: {},
  })

  it('prompt mentions all four tracking files', () => {
    const p = updateTrackingPhase.systemPrompt(ctx())
    expect(p).toContain('上下文')
    expect(p).toContain('伏笔')
    expect(p).toContain('时间线')
    expect(p).toContain('角色状态')
  })

  it('prompt updates 角色状态 progress and guards the hidden truth from spoiling', () => {
    const p = updateTrackingPhase.systemPrompt(ctx())
    expect(p).toMatch(/当前掌握|谁.*知道|进度/)
    expect(p).toMatch(/藏的底|泄底|除非.*揭示|不要提前/)
  })
})
