import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    private handlers = new Map<string, Array<(event: any) => void>>()
    on(eventName: string, handler: (event: any) => void) {
      const handlers = this.handlers.get(eventName) || []
      handlers.push(handler)
      this.handlers.set(eventName, handlers)
      return this
    }
    start() {
      queueMicrotask(() => {
        for (const handler of this.handlers.get('claude') || []) {
          handler({ type: 'text', text: '书名：雾港疑局\n简介：……\n大纲：……\n章节目录：第1章 雾夜失踪' })
          handler({ type: 'done', exitCode: 0 })
        }
      })
    }
    kill() {}
  },
  executeClaudePrompt: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '书名：雾港疑局\n简介：……\n大纲：……\n章节目录：第1章 雾夜失踪',
    stderr: '',
  }),
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-create-'))
  return resolve(dir, name)
}

async function waitForBooks(app: Awaited<ReturnType<typeof import('../../src/server/app.js').buildServer>>, predicate: (books: Array<{ title: string; root_path: string }>) => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const booksResponse = await app.inject({ method: 'GET', url: '/api/books' })
    const booksBody = JSON.parse(booksResponse.body)
    const books = booksBody.books as Array<{ title: string; root_path: string }>
    if (predicate(books)) return books
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const booksResponse = await app.inject({ method: 'GET', url: '/api/books' })
  const booksBody = JSON.parse(booksResponse.body)
  return booksBody.books as Array<{ title: string; root_path: string }>
}

describe('book creation session', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('creates a book-entry session, streams the generated plan, and materializes a book', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-create.sqlite')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        currentSkill: 'book-entry',
        prompt: '帮我开一本现代悬疑小说',
      },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.session.currentSkill).toBe('book-entry')

    await new Promise((resolve) => setTimeout(resolve, 0))

    const stream = await app.inject({ method: 'GET', url: `/api/sessions/${body.session.id}/stream` })
    expect(stream.body).toContain('书名：雾港疑局')
    expect(stream.body).toContain('章节目录')

    const booksResponse = await app.inject({ method: 'GET', url: '/api/books' })
    const booksBody = JSON.parse(booksResponse.body)
    expect(booksBody.books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '雾港疑局' }),
      ]),
    )

    const bookId = booksBody.books.find((book: { title: string }) => book.title === '雾港疑局')?.id
    expect(bookId).toBeTruthy()

    const bookDetailResponse = await app.inject({ method: 'GET', url: `/api/books/${bookId}` })
    const bookDetail = JSON.parse(bookDetailResponse.body)
    const bookRoot = booksBody.books.find((book: { title: string }) => book.title === '雾港疑局')?.root_path
    expect(bookRoot).toBeTruthy()
    const chapterPath = resolve(bookRoot, '正文', '第001章_雾夜失踪.md')

    expect(bookDetail.chapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chapter_number: 1, title: '雾夜失踪', source_path: chapterPath }),
      ]),
    )

    await expect(stat(resolve(bookRoot, '设定'))).resolves.toMatchObject({})
    await expect(stat(resolve(bookRoot, '大纲'))).resolves.toMatchObject({})
    await expect(stat(resolve(bookRoot, '正文'))).resolves.toMatchObject({})
    await expect(stat(resolve(bookRoot, '追踪'))).resolves.toMatchObject({})
    await expect(stat(resolve(bookRoot, '对标'))).resolves.toMatchObject({})
    await expect(stat(resolve(bookRoot, '参考资料'))).resolves.toMatchObject({})
    await expect(readFile(chapterPath, 'utf8')).resolves.toContain('# 第1章 雾夜失踪')
    await expect(readFile(resolve(bookRoot, '大纲', '大纲.md'), 'utf8')).resolves.toContain('雾港疑局')
    await expect(readFile(resolve(bookRoot, '追踪', '上下文.md'), 'utf8')).resolves.toContain('雾港疑局')
    await expect(readFile(resolve(bookRoot, '追踪', '伏笔.md'), 'utf8')).resolves.toContain('伏笔')
    await expect(readFile(resolve(bookRoot, '追踪', '时间线.md'), 'utf8')).resolves.toContain('时间线')

    await app.close()
  })

  it('creates a distinct new book when the generated title already exists on disk', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-create-existing.sqlite')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = path.resolve('/Users/huangzhipeng/Desktop/tomato 写作/novels/雾港疑局')
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.resolve(root, '第001章_雾夜失踪.md'), '# 已有内容\n', 'utf8')

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        currentSkill: 'book-entry',
        prompt: '帮我再开一本同名现代悬疑小说',
      },
    })

    expect(response.statusCode).toBe(201)
    const books = await waitForBooks(app, (items) => items.some((book) => book.title === '雾港疑局'))
    const matchingBooks = books.filter((book) => book.title === '雾港疑局')
    expect(matchingBooks.length).toBeGreaterThanOrEqual(1)
    expect(new Set(matchingBooks.map((book) => book.root_path)).size).toBe(matchingBooks.length)

    await app.close()
  })
})
