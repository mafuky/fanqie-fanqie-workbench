import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, updateSessionStatus } from '../../src/db/repositories/sessions-repo.js'
import {
  createReviewCheckpoint,
  getPendingReviewCheckpointBySessionId,
  resolveReviewCheckpoint,
} from '../../src/db/repositories/review-checkpoints-repo.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-review-checkpoints-'))
  return resolve(dir, name)
}

describe('review checkpoint repository', () => {
  it('creates, reads, and resolves a pending checkpoint', async () => {
    const databasePath = await createTempDatabasePath('review.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
      .run('chapter-1', 'book-1', 1, '雾夜失踪', '/tmp/book/正文/第001章_雾夜失踪.md', '待写作')
    const session = createSession(db, { kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', currentSkill: 'chapter.continue' })

    const checkpoint = createReviewCheckpoint(db, {
      sessionId: session.id,
      bookId: 'book-1',
      chapterId: 'chapter-1',
      stage: 'chapter-complete',
      title: '第 1 章正文已完成',
      summary: { completed: ['章节正文已生成或更新'], checks: ['请在左侧编辑器中验收正文质量'] },
      changedFiles: ['/tmp/book/正文/第001章_雾夜失踪.md'],
      options: ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only'],
    })

    const pending = getPendingReviewCheckpointBySessionId(db, session.id)
    expect(pending).toMatchObject({
      id: checkpoint.id,
      sessionId: session.id,
      bookId: 'book-1',
      chapterId: 'chapter-1',
      stage: 'chapter-complete',
      title: '第 1 章正文已完成',
      status: 'pending',
      summary: { completed: ['章节正文已生成或更新'], checks: ['请在左侧编辑器中验收正文质量'] },
      changedFiles: ['/tmp/book/正文/第001章_雾夜失踪.md'],
      options: ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only'],
    })

    resolveReviewCheckpoint(db, checkpoint.id, 'accepted')
    expect(getPendingReviewCheckpointBySessionId(db, session.id)).toBeNull()

    db.close()
  })

  it('allows sessions to enter waiting-review status', async () => {
    const databasePath = await createTempDatabasePath('session-status.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, { kind: 'chapter', bookId: 'book-1', status: 'running', currentSkill: 'chapter.continue' })

    updateSessionStatus(db, session.id, 'waiting-review', 'chapter.continue')
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(session.id) as { status: string }

    expect(row.status).toBe('waiting-review')
    db.close()
  })
})
