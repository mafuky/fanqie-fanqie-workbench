import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo.js'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => {
    let sent = false
    return {
      ensureSession: async () => ({ sessionName: 'fanqie-book-book-1', created: true }),
      sendText: async () => { sent = true },
      capture: async () => sent ? '模拟章节处理输出\n❯\n[status]' : '',
      interrupt: async () => {},
      stop: async () => {},
    }
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-session-'))
  return resolve(dir, name)
}

async function createNovelFixture() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-session-fixture-'))
  const novelsRoot = resolve(tempRoot, 'novels')
  const bookRoot = resolve(novelsRoot, '测试书')
  await mkdir(resolve(bookRoot, '正文'), { recursive: true })
  await writeFile(resolve(bookRoot, '正文', '第001章_雾夜.md'), '# 第1章 雾夜\n\n原始正文内容\n', 'utf8')
  return novelsRoot
}

async function waitForSessionStatus(app: Awaited<ReturnType<typeof import('../../src/server/app.js').buildServer>>, sessionId: string, expectedStatus: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionResponse = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
    const fetchedSession = JSON.parse(sessionResponse.body).session
    if (fetchedSession.status === expectedStatus) return fetchedSession
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const sessionResponse = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
  return JSON.parse(sessionResponse.body).session
}

describe('chapter session execution', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
  })

  it('routes legacy chapter-pipeline sessions through the book terminal runtime', async () => {
    const databasePath = await createTempDatabasePath('chapter-session.sqlite')
    await syncWorkspaceBooks({ novelsRoot: await createNovelFixture(), databasePath })
    process.env.WORKBENCH_DB = databasePath

    const { openDatabase } = await import('../../src/db/client.js')
    const db = openDatabase(databasePath)
    const chapter = db.prepare('SELECT id FROM chapters ORDER BY chapter_number LIMIT 1').get() as { id: string }
    db.close()

    const { buildServer } = await import('../../src/server/app')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'chapter',
        chapterId: chapter.id,
        currentSkill: 'chapter-pipeline',
      },
    })

    expect(createResponse.statusCode).toBe(201)
    const session = JSON.parse(createResponse.body).session

    const fetchedSession = await waitForSessionStatus(app, session.id, 'succeeded')
    expect(fetchedSession.status).toBe('succeeded')
    expect(fetchedSession.currentSkill).toBe('chapter-pipeline')

    const streamResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/stream` })
    expect(streamResponse.statusCode).toBe(200)
    expect(streamResponse.body).toContain('/story-long-write 日更')
    expect(streamResponse.body).toContain('模拟章节处理输出')
    expect(streamResponse.body).toContain('event: done')

    await app.close()
  })
})
