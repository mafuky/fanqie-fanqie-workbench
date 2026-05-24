import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

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

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-file-'))
  return resolve(dir, name)
}

describe('chapter file persistence', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('records generated writing-stage terminal output in the chapter session stream', { timeout: 30000 }, async () => {
    const databasePath = await createTempDatabasePath('chapter-file.sqlite')
    const chapterDir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-dir-'))
    const sourcePath = resolve(chapterDir, '第001章_雾夜失踪.md')
    await writeFile(sourcePath, '# 第001章 雾夜失踪\n\n旧内容\n', 'utf8')

    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', chapterDir)
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'book-1',
      1,
      '雾夜失踪',
      sourcePath,
      '待写作',
    )
    db.close()
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { kind: 'chapter', chapterId: 'chapter-1', currentSkill: 'chapter-pipeline' },
    })
    expect(response.statusCode).toBe(201)
    const session = JSON.parse(response.body).session

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const sessionRes = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })
      if (JSON.parse(sessionRes.body).session.status === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const streamResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/stream` })
    expect(streamResponse.body).toContain('模拟章节处理输出')
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain('旧内容')

    await app.close()
  })
})
