import { describe, expect, it } from 'vitest'
import { getPlatformLabel, isKnownPlatform, isSupportedPlatform } from '../../src/domain/platform'

describe('publishing model platform helpers', () => {
  it('recognizes the built-in publishing platforms', () => {
    expect(isKnownPlatform('fanqie')).toBe(true)
    expect(isKnownPlatform('qimao')).toBe(true)
    expect(isKnownPlatform('qidian')).toBe(true)
    expect(isKnownPlatform('custom-site')).toBe(false)
  })

  it('accepts known platforms and arbitrary non-empty custom platform identifiers', () => {
    expect(isSupportedPlatform('fanqie')).toBe(true)
    expect(isSupportedPlatform('qimao')).toBe(true)
    expect(isSupportedPlatform('qidian')).toBe(true)
    expect(isSupportedPlatform('custom-site')).toBe(true)
    expect(isSupportedPlatform('  ')).toBe(false)
    expect(isSupportedPlatform('')).toBe(false)
  })

  it('returns labels for known and custom platforms', () => {
    expect(getPlatformLabel('fanqie')).toBe('番茄小说')
    expect(getPlatformLabel('qimao')).toBe('七猫小说')
    expect(getPlatformLabel('qidian')).toBe('起点中文网')
    expect(getPlatformLabel('custom-site')).toBe('custom-site')
  })
})
