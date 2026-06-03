import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import {
  createReviewCheckpoint, getReviewCheckpointById, getActiveVolumeReconcile,
} from '../../src/db/repositories/review-checkpoints-repo'

async function tmpDbPath() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-rcp-'))
  return resolve(dir, 'workbench.sqlite')
}

function seedBookSession(db: Database.Database) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  db.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('se', 'agent', 'bk', 'running', now, now)
}

describe('review_checkpoints payload + dedup', () => {
  it('migrates payload_json onto a legacy table', async () => {
    const path = await tmpDbPath()
    const legacy = new Database(path)
    legacy.exec(`CREATE TABLE review_checkpoints (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, book_id TEXT NOT NULL, chapter_id TEXT,
      stage TEXT NOT NULL, title TEXT NOT NULL, summary_json TEXT NOT NULL,
      changed_files_json TEXT NOT NULL, options_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT)`)
    legacy.close()
    const db = openDatabase(path)
    const cols = (db.prepare('PRAGMA table_info(review_checkpoints)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toContain('payload_json')
    db.close()
  })

  it('round-trips payload and finds active volume-reconcile by (bookId, volumeKey)', async () => {
    const db = openDatabase(await tmpDbPath())
    seedBookSession(db)
    const cp = createReviewCheckpoint(db, {
      sessionId: 'se', bookId: 'bk', chapterId: null, stage: 'volume-reconcile',
      title: '第一卷对账', summary: { completed: [], checks: [] },
      changedFiles: [], options: ['apply', 'apply-edited', 'skip'],
      payload: { volumeKey: '第一卷', proposalText: '## x\n- y' },
    })
    const got = getReviewCheckpointById(db, cp.id)
    expect(got?.payload).toEqual({ volumeKey: '第一卷', proposalText: '## x\n- y' })
    expect(getActiveVolumeReconcile(db, 'bk', '第一卷')?.id).toBe(cp.id)
    expect(getActiveVolumeReconcile(db, 'bk', '第二卷')).toBeNull()
    db.close()
  })

  it('legacy/chapter-complete rows (no payload) read back as null without throwing', async () => {
    const db = openDatabase(await tmpDbPath())
    seedBookSession(db)
    const cp = createReviewCheckpoint(db, {
      sessionId: 'se', bookId: 'bk', chapterId: null, stage: 'chapter-complete',
      title: 't', summary: { completed: [], checks: [] }, changedFiles: [], options: ['accept'],
    })
    expect(getReviewCheckpointById(db, cp.id)?.payload).toBeNull()
    db.close()
  })
})
