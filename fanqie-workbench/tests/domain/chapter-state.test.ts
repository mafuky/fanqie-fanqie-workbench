import { describe, expect, it } from 'vitest'
import { canTransition } from '../../src/domain/chapter'

describe('chapter lifecycle', () => {
  it('allows 待写作 -> 已初稿', () => {
    expect(canTransition('待写作', '已初稿')).toBe(true)
  })

  it('rejects 待写作 -> 可发布', () => {
    expect(canTransition('待写作', '可发布')).toBe(false)
  })

  it('allows 发布中 -> 可发布 for paused rollback', () => {
    expect(canTransition('发布中', '可发布')).toBe(true)
  })
})
