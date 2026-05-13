import { describe, expect, it } from 'vitest'
import { verifyPublishResult } from '../../src/publish/verification'

describe('publish verification', () => {
  it('passes when titles match', () => {
    expect(verifyPublishResult({
      pageBookTitle: '雾港疑局',
      expectedBookTitle: '雾港疑局'
    })).toBe(true)
  })

  it('fails when titles mismatch', () => {
    expect(verifyPublishResult({
      pageBookTitle: '其他书',
      expectedBookTitle: '雾港疑局'
    })).toBe(false)
  })
})
