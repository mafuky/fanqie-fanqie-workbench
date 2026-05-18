# Book Entry and Chapter Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `BooksPage` the true writing entry by adding an AI-assisted “新建一本书” flow, chapter-level advanced actions, and a unified right-side streaming session panel.

**Architecture:** Extend the existing session-based backend instead of inventing a second execution system. Reuse `BooksPage`, `LiveLogPanel`, and `/api/sessions`, but add explicit book-creation and chapter-action intents so the frontend can present one primary writing flow (`处理`) and one secondary chapter menu (`···`) without exposing skill-selection complexity.

**Tech Stack:** React 19, Vite, Fastify, TypeScript, better-sqlite3, Vitest, existing Claude session streaming infrastructure

---

## File Structure

### Existing files to modify

- `fanqie-workbench/src/server/routes/sessions.ts`
  - Add explicit handling for book-creation sessions and chapter action intents.
  - Keep streaming behavior on the same session route.
- `fanqie-workbench/src/server/routes/books.ts`
  - Add any minimal data needed for the new-book entry or chapter menu labels if current payloads are insufficient.
- `fanqie-workbench/src/web/pages/books-page.tsx`
  - Add the top-level `新建一本书` entry.
  - Add chapter `···` action menu and wire selected action to session creation.
  - Route all session display into the right-side panel.
- `fanqie-workbench/src/web/components/live-log-panel.tsx`
  - Reuse if current props already fit; only modify if the right-side panel needs a small label/status enhancement.
- `fanqie-workbench/src/web/pages/prompt-page.tsx`
  - Keep as auxiliary page; only touch if this plan reveals a missing demotion detail.

### New files to create

- `fanqie-workbench/src/web/components/book-creation-modal.tsx`
  - Focused UI for the “新建一本书” flow.
- `fanqie-workbench/src/web/components/chapter-action-menu.tsx`
  - Focused UI for chapter `···` actions.
- `fanqie-workbench/tests/server/book-creation-session.test.ts`
  - Backend tests for book-creation session behavior.
- `fanqie-workbench/tests/server/chapter-action-session.test.ts`
  - Backend tests for chapter action intents.
- `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`
  - Frontend tests for new-book entry and chapter menu behavior.

### Existing tests to extend

- `fanqie-workbench/tests/web/books-page-session.test.tsx`
  - Keep current selected-book summary/session coverage intact.

---

### Task 1: Add backend support for book-creation sessions

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/book-creation-session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
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

describe('book creation session', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('creates a book-creation session and streams the generated plan', async () => {
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

    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-creation-session.test.ts
```

Expected: FAIL because the new test file does not exist yet, then FAIL again because `book-entry` has no explicitly verified flow.

- [ ] **Step 3: Write minimal implementation**

Add the test file above, then keep `kind: 'prompt'` but treat `currentSkill: 'book-entry'` as a first-class intent in `src/server/routes/sessions.ts`. Do not invent a new route yet. Ensure the existing prompt-session execution path preserves the `currentSkill` value and streams output as-is.

Use this shape in `src/server/routes/sessions.ts` as the minimal acceptance boundary:

```ts
if (kind === 'prompt' && prompt) {
  const emitter = getOrCreateEmitter(session.id)
  const runDb = openDatabase(getDatabasePath())

  void executeClaudePrompt(prompt).then((result) => {
    if (result.stdout) {
      appendSessionMessage(runDb, session.id, {
        role: 'assistant',
        stream: 'stdout',
        content: result.stdout,
      })
      emitter.emit('log', { stream: 'stdout', chunk: result.stdout })
    }

    if (result.stderr) {
      appendSessionMessage(runDb, session.id, {
        role: 'assistant',
        stream: 'stderr',
        content: result.stderr,
      })
      emitter.emit('log', { stream: 'stderr', chunk: result.stderr })
    }

    updateSessionStatus(runDb, session.id, result.exitCode === 0 ? 'succeeded' : 'failed', currentSkill ?? null)
    emitter.emit('done', { status: result.exitCode === 0 ? 'succeeded' : 'failed' })
    runDb.close()
  }).catch((error) => {
    appendSessionMessage(runDb, session.id, {
      role: 'assistant',
      stream: 'stderr',
      content: String(error),
    })
    updateSessionStatus(runDb, session.id, 'failed', currentSkill ?? null)
    emitter.emit('done', { status: 'failed' })
    runDb.close()
  })
}
```

The required behavior here is not a new branch yet — it is explicit test coverage that `book-entry` is a supported prompt-session intent.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-creation-session.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/server/book-creation-session.test.ts src/server/routes/sessions.ts
git commit -m "test: cover book entry session intent"
```

---

### Task 2: Add backend support for chapter action intents

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/chapter-action-session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
  executeClaudePrompt: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '已完成润色',
    stderr: '',
  }),
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-action-'))
  return resolve(dir, name)
}

describe('chapter action session', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('creates a chapter action session for polish and streams its action output', async () => {
    const databasePath = await createTempDatabasePath('chapter-action.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book-1')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'book-1',
      1,
      '雾夜失踪',
      '/tmp/book-1/001.md',
      '已初稿',
    )
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'chapter',
        bookId: 'book-1',
        chapterId: 'chapter-1',
        currentSkill: 'chapter-polish',
      },
    })

    expect(response.statusCode).toBe(201)

    const body = JSON.parse(response.body)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stream = await app.inject({ method: 'GET', url: `/api/sessions/${body.session.id}/stream` })
    expect(stream.body).toContain('已完成润色')

    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/chapter-action-session.test.ts
```

Expected: FAIL because the test file does not exist yet, then FAIL because `chapter-polish` is not handled differently from the pipeline session.

- [ ] **Step 3: Write minimal implementation**

Add the test file above, then in `src/server/routes/sessions.ts` split chapter-session behavior into:

```ts
const chapterActionPrompts: Record<string, (chapterTitle: string) => string> = {
  'chapter-polish': (chapterTitle) => `请调用 /chinese-novelist skill 润色章节 ${chapterTitle}`,
  'chapter-deslop': (chapterTitle) => `请调用 /story-deslop skill 处理章节 ${chapterTitle}`,
  'chapter-review': (chapterTitle) => `请调用 /story-review skill 审稿章节 ${chapterTitle}`,
  'chapter-rewrite': (chapterTitle) => `请调用 /chinese-novelist skill 重写章节 ${chapterTitle}`,
}
```

Use this decision pattern:

```ts
if (kind === 'chapter' && chapterId) {
  const emitter = getOrCreateEmitter(session.id)
  const runDb = openDatabase(getDatabasePath())
  const chapter = runDb.prepare('SELECT id, stage, title FROM chapters WHERE id = ?').get(chapterId) as { id: string; stage: string; title: string } | undefined

  if (chapter && currentSkill && chapterActionPrompts[currentSkill]) {
    void executeClaudePrompt(chapterActionPrompts[currentSkill](chapter.title)).then((result) => {
      if (result.stdout) {
        appendSessionMessage(runDb, session.id, { role: 'assistant', stream: 'stdout', content: result.stdout })
        emitter.emit('log', { stream: 'stdout', chunk: result.stdout })
      }
      if (result.stderr) {
        appendSessionMessage(runDb, session.id, { role: 'assistant', stream: 'stderr', content: result.stderr })
        emitter.emit('log', { stream: 'stderr', chunk: result.stderr })
      }
      updateSessionStatus(runDb, session.id, result.exitCode === 0 ? 'succeeded' : 'failed', currentSkill)
      emitter.emit('done', { status: result.exitCode === 0 ? 'succeeded' : 'failed' })
      runDb.close()
    }).catch((error) => {
      appendSessionMessage(runDb, session.id, { role: 'assistant', stream: 'stderr', content: String(error) })
      updateSessionStatus(runDb, session.id, 'failed', currentSkill)
      emitter.emit('done', { status: 'failed' })
      runDb.close()
    })
    return reply.code(201).send({ session })
  }
}
```

Keep the existing pipeline loop untouched for the default `chapter-pipeline` flow.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/chapter-action-session.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/server/chapter-action-session.test.ts src/server/routes/sessions.ts
git commit -m "feat: add chapter action session intents"
```

---

### Task 3: Add the “新建一本书” modal UI

**Files:**
- Create: `fanqie-workbench/src/web/components/book-creation-modal.tsx`
- Test: `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BooksPage } from '../../src/web/pages/books-page.js'

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => toastStub,
  ToastProvider: ({ children }: any) => children,
}))

describe('BooksPage book entry', () => {
  it('opens new book modal and submits a book-entry session', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }))
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: FAIL because no `新建一本书` button or modal exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/components/book-creation-modal.tsx` with a focused component:

```tsx
import { useState } from 'react'
import { Modal } from './ui/modal.js'
import { Textarea } from './ui/input.js'
import { Button } from './ui/button.js'

export function BookCreationModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (idea: string) => Promise<void>
  loading: boolean
}) {
  const [idea, setIdea] = useState('')

  return (
    <Modal open={open} onClose={onClose} title="新建一本书">
      <Textarea
        label="开书想法"
        value={idea}
        onChange={(e) => setIdea(e.currentTarget.value)}
        placeholder="例如：现代悬疑复仇文，强反转"
        rows={4}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={() => onSubmit(idea.trim())} disabled={!idea.trim()} loading={loading}>开始生成</Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Run test to verify it still fails for the correct reason**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: FAIL because `BooksPage` still does not render or wire the modal.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/book-creation-modal.tsx tests/web/books-page-book-entry.test.tsx
git commit -m "feat: add new book modal component"
```

---

### Task 4: Wire new-book entry into BooksPage and the right-side panel

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Modify: `fanqie-workbench/src/web/components/live-log-panel.tsx` (only if a minimal label/status prop is needed)
- Test: `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`
- Test: `fanqie-workbench/tests/web/books-page-session.test.tsx`

- [ ] **Step 1: Extend the failing tests**

Add this second assertion to `tests/web/books-page-book-entry.test.tsx`:

```tsx
expect((globalThis as any).fetch).toHaveBeenCalledWith(
  '/api/sessions',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      kind: 'prompt',
      currentSkill: 'book-entry',
      prompt: '请调用 /story-long-write 或与 oh-story-claudecode 对应的开书能力，基于以下想法生成书名、简介、大纲和初始章节目录：\n\n现代悬疑复仇文，强反转',
    }),
  }),
)
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: FAIL because `BooksPage` still does not send the `book-entry` session payload.

- [ ] **Step 3: Write minimal implementation**

Add these pieces to `src/web/pages/books-page.tsx`:

```tsx
const [bookCreationOpen, setBookCreationOpen] = useState(false)
const [bookCreationLoading, setBookCreationLoading] = useState(false)
const [activeActionLabel, setActiveActionLabel] = useState<string | null>(null)
```

Render a top action button in `PageHeader`:

```tsx
<Button onClick={() => setBookCreationOpen(true)}>新建一本书</Button>
```

Add submit logic:

```tsx
const handleCreateBook = useCallback(async (idea: string) => {
  if (!idea) return
  setBookCreationLoading(true)
  setActiveActionLabel('新建一本书')
  setSessionStatus('running')
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'prompt',
        currentSkill: 'book-entry',
        prompt: `请调用 /story-long-write 或与 oh-story-claudecode 对应的开书能力，基于以下想法生成书名、简介、大纲和初始章节目录：\n\n${idea}`,
      }),
    })
    const data = await res.json()
    setSessionId(data.session.id)
    setBookCreationOpen(false)
  } catch {
    toast.error('开书请求失败')
    setSessionStatus('failed')
  } finally {
    setBookCreationLoading(false)
  }
}, [toast])
```

Render the modal:

```tsx
<BookCreationModal
  open={bookCreationOpen}
  onClose={() => setBookCreationOpen(false)}
  onSubmit={handleCreateBook}
  loading={bookCreationLoading}
/>
```

In the right-side session area, add a small header label:

```tsx
<div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: spacing.sm }}>
  {activeActionLabel ?? '当前会话'}
</div>
```

Do not overbuild auto-book-creation persistence in this task. This task only creates the entry and routes streaming into the unified panel.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx tests/web/books-page-session.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/pages/books-page.tsx src/web/components/book-creation-modal.tsx tests/web/books-page-book-entry.test.tsx tests/web/books-page-session.test.tsx
git commit -m "feat: add ai-assisted book entry flow"
```

---

### Task 5: Add chapter `···` action menu UI

**Files:**
- Create: `fanqie-workbench/src/web/components/chapter-action-menu.tsx`
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`

- [ ] **Step 1: Extend the failing test**

Add this case to `tests/web/books-page-book-entry.test.tsx`:

```tsx
it('opens chapter action menu with advanced actions', async () => {
  ;(globalThis as any).fetch = vi.fn(async (input: string) => {
    if (input === '/api/books') {
      return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
    }
    if (input === '/api/books/b1') {
      return { ok: true, json: async () => ({
        book: { id: 'b1', title: '雾港疑局' },
        chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '已初稿' }],
        summary: {
          totalChapters: 1,
          byStage: { '待写作': 0, '已初稿': 1, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
          publishableCount: 0,
          activeSessionId: null,
          activeChapterId: null,
        },
      }) }
    }
    if (input === '/api/books/b1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
    return { ok: true, json: async () => ({}) }
  })

  render(<BooksPage />)
  fireEvent.click(await screen.findByText('雾港疑局'))
  fireEvent.click(await screen.findByText('···'))

  expect(await screen.findByText('润色')).toBeTruthy()
  expect(await screen.findByText('去AI味')).toBeTruthy()
  expect(await screen.findByText('审稿')).toBeTruthy()
  expect(await screen.findByText('重写本章')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: FAIL because no chapter `···` trigger exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/components/chapter-action-menu.tsx`:

```tsx
import { Button } from './ui/button.js'
import { Card } from './ui/card.js'

export type ChapterActionKey = 'chapter-polish' | 'chapter-deslop' | 'chapter-review' | 'chapter-rewrite'

const ACTIONS: Array<{ key: ChapterActionKey; label: string }> = [
  { key: 'chapter-polish', label: '润色' },
  { key: 'chapter-deslop', label: '去AI味' },
  { key: 'chapter-review', label: '审稿' },
  { key: 'chapter-rewrite', label: '重写本章' },
]

export function ChapterActionMenu({ onSelect }: { onSelect: (key: ChapterActionKey) => void }) {
  return (
    <Card>
      <div style={{ display: 'grid', gap: 8 }}>
        {ACTIONS.map((action) => (
          <Button key={action.key} variant="secondary" onClick={() => onSelect(action.key)}>
            {action.label}
          </Button>
        ))}
      </div>
    </Card>
  )
}
```

In `src/web/pages/books-page.tsx`, add per-row menu state:

```tsx
const [openActionChapterId, setOpenActionChapterId] = useState<string | null>(null)
```

Render the trigger in each chapter row:

```tsx
<Button variant="secondary" size="sm" onClick={() => setOpenActionChapterId((prev) => prev === ch.id ? null : ch.id)}>
  ···
</Button>
```

Render the menu directly below the row when `openActionChapterId === ch.id`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/components/chapter-action-menu.tsx src/web/pages/books-page.tsx tests/web/books-page-book-entry.test.tsx
git commit -m "feat: add chapter advanced action menu"
```

---

### Task 6: Route chapter `···` actions into unified sessions

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`

- [ ] **Step 1: Extend the failing test**

Add this case:

```tsx
it('starts chapter polish as a session and shows the action in the shared panel', async () => {
  ;(globalThis as any).fetch = vi.fn(async (input: string) => {
    if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
    if (input === '/api/books/b1') {
      return { ok: true, json: async () => ({
        book: { id: 'b1', title: '雾港疑局' },
        chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '已初稿' }],
        summary: {
          totalChapters: 1,
          byStage: { '待写作': 0, '已初稿': 1, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
          publishableCount: 0,
          activeSessionId: null,
          activeChapterId: null,
        },
      }) }
    }
    if (input === '/api/books/b1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
    if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 's-polish', kind: 'chapter', status: 'running' } }) }
    return { ok: true, json: async () => ({}) }
  })

  render(<BooksPage />)
  fireEvent.click(await screen.findByText('雾港疑局'))
  fireEvent.click(await screen.findByText('···'))
  fireEvent.click(await screen.findByText('润色'))

  await waitFor(() => {
    expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }))
  })
  expect(await screen.findByText('润色')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx
```

Expected: FAIL because selecting an advanced action does not create a session yet.

- [ ] **Step 3: Write minimal implementation**

In `src/web/pages/books-page.tsx`, add a handler:

```tsx
const chapterActionLabelMap: Record<string, string> = {
  'chapter-polish': '润色',
  'chapter-deslop': '去AI味',
  'chapter-review': '审稿',
  'chapter-rewrite': '重写本章',
}

const handleChapterAction = useCallback(async (chapterId: string, action: keyof typeof chapterActionLabelMap) => {
  if (!expandedBookId) return
  setProcessingChapterId(chapterId)
  setSessionId(null)
  setSessionStatus('running')
  setActiveActionLabel(chapterActionLabelMap[action])
  setOpenActionChapterId(null)

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chapter',
        bookId: expandedBookId,
        chapterId,
        currentSkill: action,
      }),
    })
    const data = await res.json()
    setSessionId(data.session.id)
    localStorage.setItem('fanqie:books:active-session', JSON.stringify({ sessionId: data.session.id, bookId: expandedBookId, chapterId }))
  } catch {
    toast.error('章节高级操作请求失败')
    setProcessingChapterId(null)
    setSessionStatus(null)
  }
}, [expandedBookId, toast])
```

Wire `ChapterActionMenu` to call this handler.

Keep `handleProcess` as the default action and set:

```tsx
setActiveActionLabel('处理')
```

before creating the pipeline session.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-book-entry.test.tsx tests/web/books-page-session.test.tsx tests/server/chapter-action-session.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/pages/books-page.tsx tests/web/books-page-book-entry.test.tsx tests/server/chapter-action-session.test.ts src/server/routes/sessions.ts
git commit -m "feat: wire chapter actions into shared session panel"
```

---

### Task 7: Final focused verification

**Files:**
- Verify only; no planned code changes
- Test: `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`
- Test: `fanqie-workbench/tests/web/books-page-session.test.tsx`
- Test: `fanqie-workbench/tests/server/book-creation-session.test.ts`
- Test: `fanqie-workbench/tests/server/chapter-action-session.test.ts`
- Test: `fanqie-workbench/tests/web/prompt-page-session.test.tsx`
- Test: `fanqie-workbench/tests/web/prompt-page-session-recovery.test.tsx`
- Test: `fanqie-workbench/tests/web/app-default-page.test.tsx`

- [ ] **Step 1: Run the focused verification suite**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run \
  tests/web/books-page-book-entry.test.tsx \
  tests/web/books-page-session.test.tsx \
  tests/server/book-creation-session.test.ts \
  tests/server/chapter-action-session.test.ts \
  tests/web/prompt-page-session.test.tsx \
  tests/web/prompt-page-session-recovery.test.tsx \
  tests/web/app-default-page.test.tsx
```

Expected: PASS across all files

- [ ] **Step 2: Check browser-facing startup command behavior**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npm run dev -- --host 127.0.0.1
```

Expected: Vite binds to `5173` only because `--strictPort` is already configured in `package.json`

Stop the dev server after confirming the startup line.

- [ ] **Step 3: Commit verification-only follow-up if needed**

If no files changed, skip commit.

If a tiny verification-driven fix was required, commit with:

```bash
git add <exact-files>
git commit -m "fix: polish book entry workspace behavior"
```

---

## Self-Review

### Spec coverage

- Main entry “新建一本书”: covered in Tasks 1, 3, and 4.
- Default `oh-story-claudecode`-style flow: covered by the `book-entry` prompt/session intent in Tasks 1 and 4.
- Chapter-level advanced actions via `···`: covered in Tasks 2, 5, and 6.
- Unified right-side streaming panel: covered in Tasks 4 and 6.
- `chinese-novelist` kept as secondary chapter capability: covered in Task 2 action prompt mapping and Task 5 menu structure.
- Free chat remains auxiliary: already preserved; verified in Task 7.

### Placeholder scan

- No `TODO` / `TBD` placeholders remain.
- Each code-changing step includes concrete code or exact target structure.
- Each verification step includes the actual command to run.

### Type consistency

- `book-entry` is always expressed as `kind: 'prompt'` + `currentSkill: 'book-entry'`.
- Chapter advanced actions are consistently named:
  - `chapter-polish`
  - `chapter-deslop`
  - `chapter-review`
  - `chapter-rewrite`
- The menu labels and action keys match across frontend and backend tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-13-book-entry-and-chapter-actions-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**