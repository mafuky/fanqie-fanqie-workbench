import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, getSessionById } from '../../src/db/repositories/sessions-repo.js'
import { buildServer } from '../../src/server/app.js'

vi.mock('../../src/claude/claude-executor.js', () => ({
  executeClaudePrompt: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-session-'))
  return resolve(dir, name)
}

describe('book session persistence', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('persists resume metadata and compression bookkeeping for a book-level session', async () => {
    const dbPath = await createTempDatabasePath('book-session.sqlite')
    const db = openDatabase(dbPath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-1',
      '测试书籍',
      '/tmp/book-session-persistence',
    )

    const session = createSession(db, {
      kind: 'prompt',
      bookId: 'book-1',
      currentSkill: 'book-master-session',
      status: 'running',
      claudeResumeId: 'resume-123',
      compressedAt: '2026-05-14T10:00:00.000Z',
      contextSnapshotJson: '{"outline":"v1"}',
    })

    const fetched = getSessionById(db, session.id)
    expect(fetched).toMatchObject({
      claudeResumeId: 'resume-123',
      compressedAt: '2026-05-14T10:00:00.000Z',
      contextSnapshotJson: '{"outline":"v1"}',
    })

    db.close()
  })

  it('updates compression metadata when the user manually compresses a book session', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-compress.sqlite')

    const db = openDatabase(process.env.WORKBENCH_DB)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-1',
      '测试书籍',
      '/tmp/book-compress-session',
    )
    db.close()

    const app = await buildServer()

    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        bookId: 'book-1',
        currentSkill: 'book-master-session',
        prompt: '建立主会话',
      },
    })
    const sessionId = JSON.parse(create.body).session.id

    const compress = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/compress`,
    })

    expect(compress.statusCode).toBe(200)
    const get = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
    const session = JSON.parse(get.body).session
    expect(session.compressedAt).toBeTruthy()

    await app.close()
  })

  it('creates or reuses one book-level master session per book', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-master.sqlite')

    const db = openDatabase(process.env.WORKBENCH_DB)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-1',
      '测试书籍',
      '/tmp/book-master-session',
    )
    db.close()

    const app = await buildServer()

    const first = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        bookId: 'book-1',
        currentSkill: 'book-master-session',
        prompt: '为这本书维护长期上下文',
      },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        bookId: 'book-1',
        currentSkill: 'book-master-session',
        prompt: '继续这本书的主会话',
      },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)

    const firstId = JSON.parse(first.body).session.id
    const secondId = JSON.parse(second.body).session.id

    expect(secondId).toBe(firstId)

    await app.close()
  })
})
