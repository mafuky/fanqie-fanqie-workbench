import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo.js'

vi.mock('../../src/claude/claude-executor.js', () => {
  const listeners = new Map<string, Array<(event: any) => void>>()
  class MockClaudeSession {
    on(event: string, cb: (event: any) => void) {
      const arr = listeners.get(event) || []
      arr.push(cb)
      listeners.set(event, arr)
      return this
    }
    start() {
      queueMicrotask(() => {
        for (const cb of listeners.get('claude') || []) cb({ type: 'text', text: '模拟章节处理输出' })
        for (const cb of listeners.get('claude') || []) cb({ type: 'done', exitCode: 0 })
      })
    }
    kill() {}
  }
  return {
    ClaudeSession: MockClaudeSession,
    executeClaudePrompt: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '模拟章节处理输出',
      stderr: '',
    }),
  }
})

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
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const sessionResponse = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
  return JSON.parse(sessionResponse.body).session
}

describe('chapter session execution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
  })

  it('executes full chapter session pipeline to 可发布 and persists stage-by-stage messages', async () => {
    const databasePath = await createTempDatabasePath('chapter-session.sqlite')
    await syncWorkspaceBooks({ novelsRoot: await createNovelFixture(), databasePath })
    process.env.WORKBENCH_DB = databasePath

    const { openDatabase } = await import('../../src/db/client.js')
    const db = openDatabase(databasePath)
    const chapter = db.prepare("SELECT id, stage, source_path FROM chapters ORDER BY chapter_number LIMIT 1").get() as { id: string; stage: string; source_path: string }
    db.close()
    const originalContent = await readFile(chapter.source_path, 'utf8')

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

    await new Promise((resolve) => setTimeout(resolve, 0))

    const fetchedSession = await waitForSessionStatus(app, session.id, 'succeeded')
    expect(fetchedSession.status).toBe('succeeded')

    const chapterDb = openDatabase(databasePath)
    const updatedChapter = chapterDb.prepare('SELECT stage FROM chapters WHERE id = ?').get(chapter.id) as { stage: string }
    chapterDb.close()
    expect(updatedChapter.stage).toBe('可发布')

    const updatedContent = await readFile(chapter.source_path, 'utf8')
    expect(updatedContent).not.toBe(originalContent)
    expect(updatedContent).toContain('模拟章节处理输出')

    const streamResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/stream` })
    expect(streamResponse.statusCode).toBe(200)
    expect(streamResponse.body).toContain('待写作 → 已初稿')
    expect(streamResponse.body).toContain('已初稿 → 已去AI')
    expect(streamResponse.body).toContain('已去AI → 已审稿')
    expect(streamResponse.body).toContain('已审稿')
    expect(streamResponse.body).toContain('可发布')
    expect(streamResponse.body).toContain('event: done')

    await app.close()
  })
})
