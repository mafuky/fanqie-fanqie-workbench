import { describe, expect, it } from 'vitest'
import { canTransition, deriveInitialStage, producedStage, stageRank, STAGE_ORDER } from '../../src/domain/chapter'

describe('chapter lifecycle', () => {
  it('allows 待写作 -> 已初稿', () => {
    expect(canTransition('待写作', '已初稿')).toBe(true)
  })

  it('rejects 待写作 -> 可发布', () => {
    expect(canTransition('待写作', '可发布')).toBe(false)
  })

  it('allows 可发布 -> 已发布 directly (no 发布中 intermediate)', () => {
    expect(canTransition('可发布', '已发布')).toBe(true)
  })

  it('no longer knows the removed 发布中 stage', () => {
    expect(STAGE_ORDER).not.toContain('发布中' as never)
  })
})

describe('stageRank', () => {
  it('orders stages from 待写作 (lowest) to 已发布 (highest)', () => {
    expect(stageRank('待写作')).toBeLessThan(stageRank('已初稿'))
    expect(stageRank('已初稿')).toBeLessThan(stageRank('可发布'))
    expect(stageRank('可发布')).toBeLessThan(stageRank('已发布'))
  })
})

describe('producedStage', () => {
  it('maps write actions to 已初稿', () => {
    expect(producedStage('chapter.next')).toBe('已初稿')
    expect(producedStage('chapter.continue')).toBe('已初稿')
  })

  it('maps deslop -> 已去AI and review -> 已审稿', () => {
    expect(producedStage('chapter.deslop')).toBe('已去AI')
    expect(producedStage('chapter.review')).toBe('已审稿')
  })

  it('returns null for actions that do not change stage', () => {
    expect(producedStage('chapter.outline')).toBeNull()
    expect(producedStage('chapter.revise')).toBeNull()
    expect(producedStage('book.create')).toBeNull()
  })
})

describe('deriveInitialStage', () => {
  it('treats a body with real prose as 已初稿', () => {
    expect(deriveInitialStage('林听雨站在雨里，校服湿透，雷声把她钉在原地，谁也没注意到她攥紧的手。' )).toBe('已初稿')
  })

  it('treats an empty body or the agent placeholder as 待写作', () => {
    expect(deriveInitialStage('')).toBe('待写作')
    expect(deriveInitialStage('<!-- 正文待 agent 续写 -->')).toBe('待写作')
    expect(deriveInitialStage('   \n  \n')).toBe('待写作')
  })
})
