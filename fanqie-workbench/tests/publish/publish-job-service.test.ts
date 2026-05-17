import { describe, expect, it } from 'vitest'
import { planPublishJob } from '../../src/publish/publish-job-service'

describe('publish job planning', () => {
  it('returns a publication-centric job with only 可发布 chapters in ascending order', () => {
    const job = planPublishJob({
      bookPublicationId: 'bp1',
      platformAccountId: 'pa1',
      mode: 'dry-run',
      chapters: [
        { id: 'c2', stage: '可发布', chapterNumber: 2 },
        { id: 'c1', stage: '可发布', chapterNumber: 1 },
        { id: 'c3', stage: '已审稿', chapterNumber: 3 },
      ],
    })

    expect(job).toMatchObject({
      bookPublicationId: 'bp1',
      platformAccountId: 'pa1',
      mode: 'dry-run',
      status: 'queued',
    })
    expect(job.chapters).toEqual([
      expect.objectContaining({ id: 'c1', chapterNumber: 1 }),
      expect.objectContaining({ id: 'c2', chapterNumber: 2 }),
    ])
  })

  it('rejects if no platformAccountId is provided', () => {
    expect(() =>
      planPublishJob({
        bookPublicationId: 'bp1',
        platformAccountId: '',
        mode: 'auto',
        chapters: [{ id: 'c1', stage: '可发布', chapterNumber: 1 }],
      }),
    ).toThrow(/platform account/i)
  })
})
