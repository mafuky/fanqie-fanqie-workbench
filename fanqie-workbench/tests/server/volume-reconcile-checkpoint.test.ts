import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { createVolumeReconcileCheckpoint } from '../../src/server/review-checkpoint-service'
import { getReviewCheckpointById } from '../../src/db/repositories/review-checkpoints-repo'

async function db() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-vrc-'))
  const d = openDatabase(resolve(dir, 'wb.sqlite'))
  const now = new Date().toISOString()
  d.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  d.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('se', 'agent', 'bk', 'running', now, now)
  return d
}

describe('createVolumeReconcileCheckpoint', () => {
  it('creates a pending volume-reconcile checkpoint carrying the payload + apply options', async () => {
    const d = await db()
    const cp = createVolumeReconcileCheckpoint(d, {
      sessionId: 'se', bookId: 'bk',
      payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 偏差一二三' },
    })
    const got = getReviewCheckpointById(d, cp.id)
    expect(got?.stage).toBe('volume-reconcile')
    expect(got?.status).toBe('pending')
    expect(got?.options).toEqual(['apply', 'apply-edited', 'skip'])
    expect(got?.payload?.volumeKey).toBe('第一卷')
    expect(got?.title).toContain('第一卷')
    d.close()
  })

  it('is a no-op (returns existing) when an active checkpoint for the same volume exists', async () => {
    const d = await db()
    const payload = { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- x 偏差内容够长' }
    const first = createVolumeReconcileCheckpoint(d, { sessionId: 'se', bookId: 'bk', payload })
    const second = createVolumeReconcileCheckpoint(d, { sessionId: 'se', bookId: 'bk', payload })
    expect(second.id).toBe(first.id)
    d.close()
  })
})
