import { describe, expect, it } from 'vitest'
import { parseChapterFile } from '../../src/fs/chapter-parser'

describe('chapter parser', () => {
  it('extracts chapter number, title, and body', async () => {
    const result = await parseChapterFile(new URL('../fixtures/novels/测试书/第001章_雾夜.md', import.meta.url))
    expect(result.chapterNumber).toBe(1)
    expect(result.title).toBe('雾夜')
    expect(result.body.length).toBeGreaterThan(10)
  })
})
