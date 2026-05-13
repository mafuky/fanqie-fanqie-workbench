import { describe, expect, it } from 'vitest'
import { advanceStage } from '../../src/orchestrator/state-updater'
import { detectStageHints } from '../../src/fs/artifact-detector'

describe('review pipeline', () => {
  it('moves 已初稿 -> 已去AI -> 已审稿 -> 可发布', () => {
    expect(advanceStage('已初稿', '已去AI')).toBe('已去AI')
    expect(advanceStage('已去AI', '已审稿')).toBe('已审稿')
    expect(advanceStage('已审稿', '可发布')).toBe('可发布')
  })

  it('rejects skipping stages', () => {
    expect(() => advanceStage('已初稿', '可发布')).toThrow()
  })

  it('detects draft artifacts', () => {
    const hints = detectStageHints(['/novels/书1/第001章_测试.md'])
    expect(hints.hasDraftArtifact).toBe(true)
  })

  it('detects deai artifacts', () => {
    const hints = detectStageHints(['/novels/书1/第001章_测试_去AI.md'])
    expect(hints.hasDeaiArtifact).toBe(true)
  })
})
