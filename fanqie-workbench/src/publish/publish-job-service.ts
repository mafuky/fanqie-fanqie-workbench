export function planPublishJob(input: {
  bookId: string
  accountId: string
  mode: 'dry-run' | 'assisted' | 'auto'
  chapters: Array<{ id: string; stage: string; chapterNumber: number }>
}) {
  if (!input.accountId) {
    throw new Error('Book must be bound to an account before publishing')
  }

  const chapterIds = input.chapters
    .filter((chapter) => chapter.stage === '可发布')
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => chapter.id)

  return {
    id: `${input.bookId}:${input.mode}`,
    bookId: input.bookId,
    accountId: input.accountId,
    mode: input.mode,
    chapterIds,
    status: 'queued' as const
  }
}
