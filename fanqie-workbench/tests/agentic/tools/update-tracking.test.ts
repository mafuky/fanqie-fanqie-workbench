import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { updateTrackingTool } from '../../../src/agentic/tools/update-tracking.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('update_tracking tool', () => {
  it('writes 上下文 file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '上下文', content: 'snapshot' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(root, '追踪/上下文.md'), 'utf8')).toBe('snapshot')
  })

  it('rejects unknown tracking file name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '随便', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must be one of/i)
  })

  it('rejects missing content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '伏笔' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
  })
})
