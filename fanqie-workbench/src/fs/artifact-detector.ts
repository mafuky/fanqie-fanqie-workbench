export function detectStageHints(paths: string[]) {
  return {
    hasDraftArtifact: paths.some((path) => /第\d+章/.test(path)),
    hasDeaiArtifact: paths.some((path) => path.includes('去AI') || path.includes('deslop')),
    hasReviewArtifact: paths.some((path) => path.includes('review') || path.includes('审稿'))
  }
}
