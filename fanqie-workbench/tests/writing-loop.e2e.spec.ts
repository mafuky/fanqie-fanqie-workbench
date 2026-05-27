import { test, expect } from '@playwright/test'

test('library to workspace writing loop works with mocked API', async ({ page }) => {
  const books = [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/fanqie-e2e-book', account_id: null }]
  let chapterContent = '# 第1章 雾夜失踪'
  let sessions: Array<{ id: string; kind: string; bookId: string; chapterId: string; status: string; currentSkill: string | null; pendingQuestionJson: string | null }> = []

  await page.route('**/api/books', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ books }) })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/books/scan', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bookCount: 1, chapterCount: 1 }) })
  })

  await page.route('**/api/books/book-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/fanqie-e2e-book' },
        chapters: [{ id: 'chapter-1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
        summary: { activeSessionId: sessions.find((session) => session.status === 'running' || session.status === 'waiting-answer')?.id ?? null, activeChapterId: 'chapter-1' },
      }),
    })
  })

  await page.route('**/api/books/book-1/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions }) })
  })

  await page.route('**/api/books/book-1/publications', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publications: [] }) })
  })

  await page.route('**/api/chapters/chapter-1/content', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: chapterContent }) })
      return
    }
    const body = route.request().postDataJSON() as { content: string }
    chapterContent = body.content
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: true }) })
  })

  await page.route('**/api/actions', async (route) => {
    sessions = [{ id: 'session-1', kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', status: 'running', currentSkill: 'chapter.continue', pendingQuestionJson: null }]
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session: { id: 'session-1', kind: 'chapter', status: 'running' } }) })
  })

  await page.route('**/api/sessions/session-1/stream', async (route) => {
    const response = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"id":1,"stream":"stdout","chunk":"开始写作\\n"}\n\n'))
        controller.enqueue(encoder.encode('event: question\ndata: {"toolUseId":"session-1","question":"是否继续？","options":[]}\n\n'))
      },
    })
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }, body: response })
  })

  await page.route('**/api/sessions/session-1/answer', async (route) => {
    sessions = [{ ...sessions[0], status: 'running', pendingQuestionJson: null }]
    chapterContent = `${chapterContent}\n回答后刷新正文`
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answered: true }) })
  })

  await page.goto('http://127.0.0.1:5173')

  await expect(page.getByRole('heading', { name: '书库' })).toBeVisible()
  await page.getByRole('button', { name: /扫描 novels\// }).click()
  await expect(page.getByText('扫描完成：1 本书，1 章')).toBeVisible()

  await page.getByText('雾港疑局').click()
  await expect(page.getByText('单书工作台')).toBeVisible()
  await expect(page.getByDisplayValue('# 第1章 雾夜失踪')).toBeVisible()

  await page.getByLabel('章节正文').fill('# 第1章 雾夜失踪\n用户保存内容')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('未保存')).toHaveCount(0)

  await page.getByRole('button', { name: '继续写本章' }).click()
  await expect(page.getByText('开始写作')).toBeVisible()
  await expect(page.getByText('是否继续？')).toBeVisible()

  await page.getByPlaceholder('输入你的回答…').fill('继续')
  await page.getByRole('button', { name: '提交回答' }).click()
  await expect(page.getByDisplayValue(/回答后刷新正文/)).toBeVisible()
})
