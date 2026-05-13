import { describe, expect, it } from 'vitest'
import { planPublishJob } from '../../src/publish/publish-job-service'

describe('publish job planning', () => {
  it('includes only 可发布 chapters in ascending order', () => {
    const job = planPublishJob({
      bookId: 'b1',
      accountId: 'a1',
      mode: 'dry-run',
      chapters: [
        { id: 'c2', stage: '可发布', chapterNumber: 2 },
        { id: 'c1', stage: '可发布', chapterNumber: 1 },
        { id: 'c3', stage: '已审稿', chapterNumber: 3 }
      ]
    })

    expect(job.chapterIds).toEqual(['c1', 'c2'])
    expect(job.accountId).toBe('a1')
  })

  it('rejects if no accountId provided', () => {
    expect(() =>
      planPublishJob({
        bookId: 'b1',
        accountId: '',
        mode: 'auto',
        chapters: [{ id: 'c1', stage: '可发布', chapterNumber: 1 }]
      })
    ).toThrow()
  })
})
