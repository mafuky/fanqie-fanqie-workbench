import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { scanBooks } from '../../src/fs/book-scanner'

describe('book scanner', () => {
  it('finds one book directory', async () => {
    const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/novels')
    const books = await scanBooks(fixturesDir)
    expect(books).toHaveLength(1)
    expect(books[0].title).toBe('测试书')
  })
})
