import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listDirTool } from '../../../src/agentic/tools/list-dir.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('list_dir tool', () => {
  it('lists entries with type marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    mkdirSync(join(root, '设定'))
    writeFileSync(join(root, '总纲.md'), '')
    const r = await listDirTool.execute({ args: { path: '.' }, ctx: ctx(root) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const lines = r.result.split('\n').sort()
      expect(lines).toContain('设定/')
      expect(lines).toContain('总纲.md')
    }
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await listDirTool.execute({ args: { path: '../' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })

  it('returns error for missing dir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await listDirTool.execute({ args: { path: 'nope' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })
})
