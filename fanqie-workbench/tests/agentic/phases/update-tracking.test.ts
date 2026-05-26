import { describe, expect, it } from 'vitest'
import { updateTrackingPhase } from '../../../src/agentic/phases/update-tracking.js'

describe('update-tracking phase', () => {
  it('uses read_file + update_tracking tools only', () => {
    expect(updateTrackingPhase.tools).toEqual(['read_file', 'update_tracking'])
  })

  it('prompt mentions all three tracking files', () => {
    const p = updateTrackingPhase.systemPrompt({
      bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(p).toContain('上下文')
    expect(p).toContain('伏笔')
    expect(p).toContain('时间线')
  })
})
