export function computeProgress(input: { totalChapters: number; completedChapters: number }) {
  if (input.totalChapters === 0) return 0
  return Math.round((input.completedChapters / input.totalChapters) * 100)
}
