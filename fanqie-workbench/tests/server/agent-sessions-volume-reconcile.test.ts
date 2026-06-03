import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { ensureAgentSessionRow, wireReviewCheckpointRequest } from '../../src/server/routes/agent-sessions'
import { getReviewCheckpointById, getActiveVolumeReconcile } from '../../src/db/repositories/review-checkpoints-repo'

async function db() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-asvr-'))
  const d = openDatabase(resolve(dir, 'wb.sqlite'))
  d.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  return d
}

describe('agent-sessions volume-reconcile wiring', () => {
  it('ensureAgentSessionRow inserts a kind=agent session satisfying the FK', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 'se', bookId: 'bk', chapterId: null })
    const row = d.prepare('SELECT kind FROM sessions WHERE id = ?').get('se') as { kind: string } | undefined
    expect(row?.kind).toBe('agent')
    d.close()
  })

  it('wireReviewCheckpointRequest turns the event into a volume-reconcile checkpoint', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 'se', bookId: 'bk', chapterId: null })
    const emitter = new EventEmitter()
    wireReviewCheckpointRequest(d, emitter, { sessionId: 'se', bookId: 'bk' })
    emitter.emit('event', {
      type: 'review-checkpoint-requested', stage: 'volume-reconcile',
      payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 一条够长的偏差' },
    })
    const cp = getActiveVolumeReconcile(d, 'bk', '第一卷')
    expect(cp).not.toBeNull()
    expect(getReviewCheckpointById(d, cp!.id)?.stage).toBe('volume-reconcile')
    d.close()
  })
})
