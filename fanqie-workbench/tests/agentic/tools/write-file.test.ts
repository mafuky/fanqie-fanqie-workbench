import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { writeFileTool } from '../../../src/agentic/tools/write-file.js'

const ctx = (root: string, emit = vi.fn()) => ({ bookId: 'b1', bookRoot: root, emit })

describe('write_file tool', () => {
  it('writes file inside bookRoot and emits file-updated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const emit = vi.fn()
    const r = await writeFileTool.execute({
      args: { path: '正文/第001章.md', content: 'body' },
      ctx: ctx(root, emit),
    })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(root, '正文/第001章.md'), 'utf8')).toBe('body')
    expect(emit).toHaveBeenCalledWith({ type: 'file-updated', path: '正文/第001章.md' })
  })

  it('creates intermediate directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await writeFileTool.execute({
      args: { path: '追踪/上下文.md', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(true)
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await writeFileTool.execute({
      args: { path: '../evil.md', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
  })
})
