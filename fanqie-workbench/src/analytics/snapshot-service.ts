export function buildAnalyticsSnapshot(input: { bookId: string; chapters: Array<{ stage: string }> }) {
  const stageCounts: Record<string, number> = {}
  for (const chapter of input.chapters) {
    stageCounts[chapter.stage] = (stageCounts[chapter.stage] || 0) + 1
  }

  return {
    bookId: input.bookId,
    stageCounts,
    publishableCount: input.chapters.filter((c) => c.stage === '可发布').length,
    publishedCount: input.chapters.filter((c) => c.stage === '已发布').length,
    publishFailureCount: 0,
    createdAt: new Date().toISOString()
  }
}
