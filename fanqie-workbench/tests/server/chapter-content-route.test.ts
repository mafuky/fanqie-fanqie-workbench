import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession } from '../../src/db/repositories/sessions-repo.js'
import { buildServer } from '../../src/server/app.js'

async function createFixture(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), `fanqie-chapter-content-${name}-`))
  const databasePath = resolve(dir, 'workbench.sqlite')
  const bookRoot = resolve(dir, 'book')
  const chapterDir = resolve(bookRoot, '正文')
  const chapterPath = resolve(chapterDir, '第001章_雾夜失踪.md')
  await mkdir(chapterDir, { recursive: true })
  await writeFile(chapterPath, '# 第001章 雾夜失踪\n\n旧内容\n', 'utf8')

  const db = openDatabase(databasePath)
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', bookRoot)
  db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run('chapter-1', 'book-1', 1, '雾夜失踪', chapterPath, '待写作')
  db.close()

  process.env.WORKBENCH_DB = databasePath
  return { databasePath, bookRoot, chapterPath }
}

describe('chapter content route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('reads chapter markdown content', async () => {
    const { chapterPath } = await createFixture('read')
    const app = await buildServer()

    const response = await app.inject({ method: 'GET', url: '/api/chapters/chapter-1/content' })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.chapter).toMatchObject({
      id: 'chapter-1',
      title: '雾夜失踪',
      chapterNumber: 1,
      sourcePath: chapterPath,
    })
    expect(body.content).toBe('# 第001章 雾夜失踪\n\n旧内容\n')

    await app.close()
  })

  it('saves chapter markdown content', async () => {
    const { chapterPath } = await createFixture('save')
    const app = await buildServer()

    const response = await app.inject({
      method: 'PUT',
      url: '/api/chapters/chapter-1/content',
      payload: { content: '# 第001章 雾夜失踪\n\n新内容\n' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ saved: true })
    await expect(readFile(chapterPath, 'utf8')).resolves.toBe('# 第001章 雾夜失踪\n\n新内容\n')

    await app.close()
  })

  it('rejects chapter source paths outside the book root', async () => {
    const { databasePath } = await createFixture('unsafe')
    const outsidePath = resolve(tmpdir(), 'outside-chapter.md')
    await writeFile(outsidePath, 'outside', 'utf8')
    const db = openDatabase(databasePath)
    db.prepare('UPDATE chapters SET source_path = ? WHERE id = ?').run(outsidePath, 'chapter-1')
    db.close()

    const app = await buildServer()
    const response = await app.inject({
      method: 'PUT',
      url: '/api/chapters/chapter-1/content',
      payload: { content: 'bad' },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error).toBe('chapter source path must be inside book root')

    await app.close()
  })

  it('rejects saving while a chapter session is running for the same book', async () => {
    const { databasePath } = await createFixture('conflict')
    const db = openDatabase(databasePath)
    createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      chapterId: 'chapter-1',
      status: 'running',
      currentSkill: 'chapter.continue',
    })
    db.close()

    const app = await buildServer()
    const response = await app.inject({
      method: 'PUT',
      url: '/api/chapters/chapter-1/content',
      payload: { content: '# 用户编辑\n' },
    })

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body).error).toBe('chapter is being modified by a running Claude session')

    await app.close()
  })
})
