import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

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
    executeClaudePrompt: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '模拟去AI/审稿输出', stderr: '' }),
  }
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-file-'))
  return resolve(dir, name)
}

describe('chapter file persistence', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('writes generated writing-stage content back to the chapter source file', async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 0))

    const updatedContent = await readFile(sourcePath, 'utf8')
    expect(updatedContent).toContain('模拟章节处理输出')
    expect(updatedContent).not.toContain('旧内容')

    await app.close()
  })
})
