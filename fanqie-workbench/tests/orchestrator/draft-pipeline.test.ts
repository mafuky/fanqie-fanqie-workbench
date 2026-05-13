import { describe, expect, it, vi } from 'vitest'
import { runDraftPipeline } from '../../src/orchestrator/pipeline-runner'

describe('draft pipeline', () => {
  it('moves a chapter from 待写作 to 已初稿 after artifact verification', async () => {
    const executor = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      artifactPaths: ['/tmp/第001章_雾夜.md'],
      status: 'succeeded'
    })

    const result = await runDraftPipeline({ executor, chapterStage: '待写作' })
    expect(result.nextStage).toBe('已初稿')
  })

  it('throws when executor fails', async () => {
    const executor = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'error',
      artifactPaths: [],
      status: 'failed'
    })

    await expect(runDraftPipeline({ executor, chapterStage: '待写作' })).rejects.toThrow()
  })
})
