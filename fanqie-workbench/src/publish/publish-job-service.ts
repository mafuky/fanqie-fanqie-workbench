export function planPublishJob(input: {
  bookPublicationId: string
  platformAccountId: string
  mode: 'dry-run' | 'assisted' | 'auto'
  chapters: Array<{ id: string; stage: string; chapterNumber: number }>
}) {
  if (!input.platformAccountId) {
    throw new Error('Book publication must be bound to a platform account before publishing')
  }

  const chapters = input.chapters
    .filter((chapter) => chapter.stage === '可发布')
    .sort((a, b) => a.chapterNumber - b.chapterNumber)

  return {
    id: `${input.bookPublicationId}:${input.mode}`,
    bookPublicationId: input.bookPublicationId,
    platformAccountId: input.platformAccountId,
    mode: input.mode,
    chapters,
    status: 'queued' as const,
  }
}
