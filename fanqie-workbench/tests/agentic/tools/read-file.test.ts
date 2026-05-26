import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readFileTool } from '../../../src/agentic/tools/read-file.js'

function setupBook() {
  const root = mkdtempSync(join(tmpdir(), 'book-'))
  mkdirSync(join(root, '正文'))
  writeFileSync(join(root, '正文', '第001章.md'), 'hello world')
  return root
}

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('read_file tool', () => {
  it('reads a file inside bookRoot', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '正文/第001章.md' }, ctx: ctx(root) })
    expect(r).toEqual({ ok: true, result: 'hello world' })
  })

  it('rejects path that escapes bookRoot', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '../outside.md' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/outside book root/i)
  })

  it('returns error for missing file', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '正文/missing.md' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not found|ENOENT/i)
  })
})
