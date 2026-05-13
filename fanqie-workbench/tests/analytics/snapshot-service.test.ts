import { describe, expect, it } from 'vitest'
import { buildAnalyticsSnapshot } from '../../src/analytics/snapshot-service'

describe('analytics snapshot', () => {
  it('summarizes stage counts and publishability', () => {
    const snapshot = buildAnalyticsSnapshot({
      bookId: 'b1',
      chapters: [
        { stage: '已初稿' },
        { stage: '可发布' },
        { stage: '已发布' }
      ]
    })

    expect(snapshot.publishableCount).toBe(1)
    expect(snapshot.publishedCount).toBe(1)
    expect(snapshot.bookId).toBe('b1')
  })

  it('handles empty chapter list', () => {
    const snapshot = buildAnalyticsSnapshot({ bookId: 'b2', chapters: [] })
    expect(snapshot.publishableCount).toBe(0)
    expect(snapshot.publishedCount).toBe(0)
  })
})
