import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { grepTool } from '../../../src/agentic/tools/grep.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('grep tool', () => {
  it('finds matches across files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    mkdirSync(join(root, '正文'))
    writeFileSync(join(root, '正文', 'a.md'), 'foo line\nbar line')
    writeFileSync(join(root, '正文', 'b.md'), 'no match')
    const r = await grepTool.execute({ args: { pattern: 'foo', path: '正文' }, ctx: ctx(root) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result).toMatch(/正文\/a\.md:1:foo line/)
      expect(r.result).not.toMatch(/b\.md/)
    }
  })

  it('returns empty result when nothing matches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    writeFileSync(join(root, 'x.md'), 'hello')
    const r = await grepTool.execute({ args: { pattern: 'nothere', path: '.' }, ctx: ctx(root) })
    expect(r).toEqual({ ok: true, result: '' })
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await grepTool.execute({ args: { pattern: 'x', path: '..' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })
})
