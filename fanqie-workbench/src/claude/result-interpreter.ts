export function classifyRun(exitCode: number | null, artifactPaths: string[]) {
  if (exitCode === 0 && artifactPaths.length > 0) return 'succeeded' as const
  if (exitCode === 0 && artifactPaths.length === 0) return 'no-artifact' as const
  return 'failed' as const
}
