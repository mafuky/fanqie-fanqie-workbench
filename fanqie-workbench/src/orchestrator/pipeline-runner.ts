import { advanceStage } from './state-updater.js'

export async function runDraftPipeline(input: {
  executor: () => Promise<{
    exitCode: number | null
    stdout: string
    stderr: string
    artifactPaths: string[]
    status: 'succeeded' | 'failed' | 'needs-human' | 'no-artifact' | 'artifact-invalid'
  }>
  chapterStage: '待写作'
}) {
  const result = await input.executor()

  if (result.status !== 'succeeded' || result.artifactPaths.length === 0) {
    throw new Error('Draft artifact missing or invalid')
  }

  return {
    nextStage: advanceStage(input.chapterStage, '已初稿'),
    artifactPaths: result.artifactPaths
  }
}
