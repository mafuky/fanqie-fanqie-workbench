export async function runDryPublishJob(input: { chapterIds: string[] }) {
  return input.chapterIds.map((chapterId) => ({ chapterId, status: 'verified-dry-run' as const }))
}
