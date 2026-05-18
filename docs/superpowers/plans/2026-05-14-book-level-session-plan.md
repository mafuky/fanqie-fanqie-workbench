# Book-Level Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one long-lived book-level session per book for planning/opening/direction work, with visible manual context management in the BooksPage workspace.

**Architecture:** Keep chapter processing sessions separate for now, but introduce a distinct book-level session identity and resume metadata that the backend owns and the frontend can manage through product actions. The BooksPage gets a dedicated book-session panel for state, manual compaction, and context viewing, while backend session routes gain explicit book-session semantics and resume-aware storage.

**Tech Stack:** React 19, TypeScript, Fastify, better-sqlite3, Claude session streaming, Vitest

---

## File Structure

### Existing files to modify

- `fanqie-workbench/src/db/schema.ts`
  - Extend session persistence for book-level resume metadata and compression bookkeeping.
- `fanqie-workbench/src/db/repositories/sessions-repo.ts`
  - Read/write the new book-session metadata fields and provide helpers to fetch the active book-level session.
- `fanqie-workbench/src/server/routes/sessions.ts`
  - Introduce explicit book-level session creation/resume behavior and book-session control actions.
- `fanqie-workbench/src/server/routes/books.ts`
  - Return book-level session summary/state as part of the book workspace payload or a dedicated route.
- `fanqie-workbench/src/web/pages/books-page.tsx`
  - Render the new book-level session panel, wire manual compression, and route book-level actions into the panel.
- `fanqie-workbench/src/web/components/live-log-panel.tsx`
  - Reuse existing stream display; only adjust if the new book-session panel needs small callback or labeling enhancements.

### New files to create

- `fanqie-workbench/src/web/components/book-session-panel.tsx`
  - Focused UI for the long-lived book session summary, manual compression, and context viewing entry.
- `fanqie-workbench/tests/server/book-session-route.test.ts`
  - Backend coverage for creating and resuming book-level sessions.
- `fanqie-workbench/tests/web/book-session-panel.test.tsx`
  - Frontend coverage for the book-level session panel and manual compression action.

### Existing tests to extend

- `fanqie-workbench/tests/web/books-page-book-entry.test.tsx`
  - Verify new-book flow binds to the book-level session model.
- `fanqie-workbench/tests/web/books-page-session.test.tsx`
  - Keep chapter session behavior intact while adding a separate book-session panel.

---

### Task 1: Add book-level session metadata to persistence

**Files:**
- Modify: `fanqie-workbench/src/db/schema.ts`
- Modify: `fanqie-workbench/src/db/repositories/sessions-repo.ts`
- Test: `fanqie-workbench/tests/server/book-session-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, getSessionById } from '../../src/db/repositories/sessions-repo.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-session-'))
  return resolve(dir, name)
}

describe('book session persistence', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('persists resume metadata and compression timestamps for a book-level session', async () => {
    const dbPath = await createTempDatabasePath('book-session.sqlite')
    const db = openDatabase(dbPath)
    const session = createSession(db, {
      kind: 'prompt',
      bookId: 'book-1',
      currentSkill: 'book-master-session',
      status: 'running',
      metadata: {
        claudeResumeId: 'resume-123',
        compressedAt: '2026-05-14T10:00:00.000Z',
      },
    })

    const fetched = getSessionById(db, session.id)
    expect(fetched?.metadata).toEqual({
      claudeResumeId: 'resume-123',
      compressedAt: '2026-05-14T10:00:00.000Z',
    })
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts
```

Expected: FAIL because `sessions` does not yet store or return this metadata.

- [ ] **Step 3: Write minimal implementation**

In `src/db/schema.ts`, extend `sessions` with JSON/text bookkeeping columns:

```sql
claude_resume_id TEXT,
compressed_at TEXT,
context_snapshot_json TEXT
```

In `src/db/repositories/sessions-repo.ts`, extend the repo contract minimally:

```ts
export type SessionMetadata = {
  claudeResumeId?: string | null
  compressedAt?: string | null
  contextSnapshotJson?: string | null
}
```

Update `createSession`, `getSessionById`, and update helpers to round-trip these fields. Keep the implementation flat and explicit; do not introduce a generic metadata blob when only three fields are needed now.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/repositories/sessions-repo.ts tests/server/book-session-route.test.ts
git commit -m "feat: persist book session metadata"
```

---

### Task 2: Add backend route behavior for creating/resuming a book-level session

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/book-session-route.test.ts`

- [ ] **Step 1: Extend the failing test**

Add this case to `tests/server/book-session-route.test.ts`:

```ts
it('creates or reuses one book-level master session per book', async () => {
  process.env.WORKBENCH_DB = await createTempDatabasePath('book-master.sqlite')
  const { buildServer } = await import('../../src/server/app.js')
  const app = await buildServer()

  const first = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { kind: 'prompt', bookId: 'book-1', currentSkill: 'book-master-session', prompt: '为这本书维护长期上下文' },
  })
  const second = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { kind: 'prompt', bookId: 'book-1', currentSkill: 'book-master-session', prompt: '继续这本书的主会话' },
  })

  const firstId = JSON.parse(first.body).session.id
  const secondId = JSON.parse(second.body).session.id

  expect(secondId).toBe(firstId)
  await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts
```

Expected: FAIL because the route currently creates a fresh prompt session every time.

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/sessions.ts`, detect this explicit skill:

```ts
const isBookMasterSession = kind === 'prompt' && bookId && currentSkill === 'book-master-session'
```

Before `createSession(...)`, query for an existing running/succeeded book master session for that book and reuse it if found:

```ts
const existing = findBookMasterSession(db, bookId)
if (existing) {
  db.close()
  return reply.code(201).send({ session: existing })
}
```

Add the minimal repo helper in `sessions-repo.ts`:

```ts
export function findBookMasterSession(db: Database.Database, bookId: string) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE book_id = ? AND current_skill = 'book-master-session'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(bookId)
}
```

Do not yet resume a real Claude process here; this task is about stable session identity per book.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/sessions.ts src/db/repositories/sessions-repo.ts tests/server/book-session-route.test.ts
git commit -m "feat: reuse one master session per book"
```

---

### Task 3: Add the book-level session panel UI

**Files:**
- Create: `fanqie-workbench/src/web/components/book-session-panel.tsx`
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/book-session-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookSessionPanel } from '../../src/web/components/book-session-panel.js'

describe('BookSessionPanel', () => {
  it('shows the standard book-level session fields and manual compression action', () => {
    render(
      <BookSessionPanel
        session={{
          id: 'master-1',
          status: 'running',
          currentSkill: 'book-master-session',
          updatedAt: '2026-05-14T10:00:00.000Z',
          metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
        }}
        onCompress={() => {}}
        onViewContext={() => {}}
      />,
    )

    expect(screen.getByText('书级主会话')).toBeTruthy()
    expect(screen.getByText('book-master-session')).toBeTruthy()
    expect(screen.getByText('压缩上下文')).toBeTruthy()
    expect(screen.getByText('查看上下文')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/book-session-panel.test.tsx
```

Expected: FAIL because the component does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/components/book-session-panel.tsx` with a focused presentation-only component:

```tsx
import { Card } from './ui/card.js'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'

export function BookSessionPanel({ session, onCompress, onViewContext }: {
  session: {
    id: string
    status: string
    currentSkill: string | null
    updatedAt: string
    metadata?: { compressedAt?: string | null }
  } | null
  onCompress: () => void
  onViewContext: () => void
}) {
  return (
    <Card>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>书级主会话</div>
          <Badge variant={session?.status === 'running' ? 'warning' : 'neutral'}>{session?.status || '未建立'}</Badge>
        </div>
        <div>{session?.currentSkill || 'book-master-session'}</div>
        <div>最近更新：{session ? new Date(session.updatedAt).toLocaleString('zh-CN') : '暂无'}</div>
        <div>最近压缩：{session?.metadata?.compressedAt ? new Date(session.metadata.compressedAt).toLocaleString('zh-CN') : '未压缩'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={onViewContext}>查看上下文</Button>
          <Button onClick={onCompress}>压缩上下文</Button>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/book-session-panel.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/components/book-session-panel.tsx tests/web/book-session-panel.test.tsx
git commit -m "feat: add book session panel"
```

---

### Task 4: Render the book-level session panel in BooksPage

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/books-page-session.test.tsx`
- Test: `fanqie-workbench/tests/web/book-session-panel.test.tsx`

- [ ] **Step 1: Extend the failing test**

Add this case to `tests/web/books-page-session.test.tsx`:

```tsx
it('shows a visible book-level session panel for the selected book', async () => {
  ;(globalThis as any).fetch = vi.fn(async (input: string) => {
    if (input === '/api/books') {
      return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
    }
    if (input === '/api/books/b1') {
      return { ok: true, json: async () => ({
        book: { id: 'b1', title: '雾港疑局' },
        chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
        summary: {
          totalChapters: 1,
          byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
          publishableCount: 0,
          activeSessionId: null,
          activeChapterId: null,
        },
      }) }
    }
    if (input === '/api/books/b1/sessions') {
      return { ok: true, json: async () => ({
        sessions: [
          {
            id: 'master-1',
            kind: 'prompt',
            bookId: 'b1',
            chapterId: null,
            status: 'running',
            currentSkill: 'book-master-session',
            pendingQuestionJson: null,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:01:00.000Z',
            metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
          },
        ],
      }) }
    }
    if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
    return { ok: true, json: async () => ({}) }
  })

  render(<BooksPage />)
  fireEvent.click(await screen.findByText('雾港疑局'))

  expect(await screen.findByText('书级主会话')).toBeTruthy()
  expect(await screen.findByText('压缩上下文')).toBeTruthy()
  expect(await screen.findByText('查看上下文')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-session.test.tsx tests/web/book-session-panel.test.tsx
```

Expected: FAIL because `BooksPage` does not yet render the new panel.

- [ ] **Step 3: Write minimal implementation**

In `src/web/pages/books-page.tsx`:

- Import and render `BookSessionPanel`
- Derive the book-level session by selecting the latest session whose `currentSkill === 'book-master-session'`
- Place the panel near the book summary area, not inside chapter rows
- Keep chapter session panel behavior intact

Use this selection helper inline or as a tiny local function:

```ts
const selectedBookMasterSession = expandedBookId
  ? (bookSessions[expandedBookId] || []).find((session) => session.currentSkill === 'book-master-session') ?? null
  : null
```

Wire placeholder handlers for now:

```tsx
<BookSessionPanel
  session={selectedBookMasterSession}
  onCompress={() => toast.info('压缩上下文功能待接线')}
  onViewContext={() => toast.info('查看上下文功能待接线')}
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/books-page-session.test.tsx tests/web/book-session-panel.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/pages/books-page.tsx src/web/components/book-session-panel.tsx tests/web/books-page-session.test.tsx tests/web/book-session-panel.test.tsx
git commit -m "feat: show book-level session panel"
```

---

### Task 5: Add manual context compression action plumbing

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/server/book-session-route.test.ts`
- Test: `fanqie-workbench/tests/web/book-session-panel.test.tsx`

- [ ] **Step 1: Extend the failing backend test**

Add this case:

```ts
it('updates compression metadata when the user manually compresses a book session', async () => {
  process.env.WORKBENCH_DB = await createTempDatabasePath('book-compress.sqlite')
  const { buildServer } = await import('../../src/server/app.js')
  const app = await buildServer()

  const create = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { kind: 'prompt', bookId: 'book-1', currentSkill: 'book-master-session', prompt: '建立主会话' },
  })
  const sessionId = JSON.parse(create.body).session.id

  const compress = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/compress`,
  })

  expect(compress.statusCode).toBe(200)
  const get = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
  const session = JSON.parse(get.body).session
  expect(session.metadata.compressedAt).toBeTruthy()
  await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts
```

Expected: FAIL because no compression endpoint exists yet.

- [ ] **Step 3: Write minimal implementation**

Add a small endpoint to `src/server/routes/sessions.ts`:

```ts
app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/compress', async (request, reply) => {
  const { sessionId } = request.params
  const db = openDatabase(getDatabasePath())
  const session = getSessionById(db, sessionId)
  if (!session) {
    db.close()
    return reply.code(404).send({ error: 'session not found' })
  }

  updateSessionMetadata(db, sessionId, {
    compressedAt: new Date().toISOString(),
  })
  const updated = getSessionById(db, sessionId)
  db.close()
  return { session: updated }
})
```

Do not implement real Claude-side compaction yet. This task only establishes the visible, manual product action and stored timestamp.

Then in `BooksPage`, wire the panel action:

```tsx
const handleCompressBookSession = useCallback(async (sessionId: string) => {
  const res = await fetch(`/api/sessions/${sessionId}/compress`, { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '压缩上下文失败')
  toast.success('已压缩上下文')
  await reloadExpandedBook()
}, [toast, reloadExpandedBook])
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/server/book-session-route.test.ts tests/web/book-session-panel.test.tsx tests/web/books-page-session.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/sessions.ts src/web/pages/books-page.tsx tests/server/book-session-route.test.ts tests/web/book-session-panel.test.tsx tests/web/books-page-session.test.tsx
git commit -m "feat: add manual book session compression"
```

---

### Task 6: Add context viewing entry behavior

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/book-session-panel.test.tsx`

- [ ] **Step 1: Extend the failing test**

Add this case to `tests/web/book-session-panel.test.tsx`:

```tsx
it('opens a visible context section when the user chooses to view context', async () => {
  const onCompress = () => {}
  const onViewContext = vi.fn()
  render(
    <BookSessionPanel
      session={{
        id: 'master-1',
        status: 'running',
        currentSkill: 'book-master-session',
        updatedAt: '2026-05-14T10:00:00.000Z',
        metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
      }}
      onCompress={onCompress}
      onViewContext={onViewContext}
    />,
  )

  fireEvent.click(screen.getByText('查看上下文'))
  expect(onViewContext).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails if needed**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/book-session-panel.test.tsx
```

Expected: If it already passes at component level, proceed to the page-level context drawer step.

- [ ] **Step 3: Write minimal page-level implementation**

In `BooksPage`, add a small visible context section or modal, initially backed by placeholder readable content assembled from current book data:

```tsx
const [contextOpen, setContextOpen] = useState(false)
```

Render:

```tsx
{contextOpen && selectedBook && (
  <Card>
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>当前上下文</div>
      <div>书名：{selectedBook.title}</div>
      <div>总章节：{selectedBookSummary.totalChapters}</div>
      <div>待写作：{selectedBookSummary.byStage['待写作']}</div>
    </div>
  </Card>
)}
```

Wire `onViewContext={() => setContextOpen((v) => !v)}`.

This is deliberately the minimal readable view, not the final raw-context inspector.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd "/Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench" && npx vitest run tests/web/book-session-panel.test.tsx tests/web/books-page-session.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/pages/books-page.tsx tests/web/book-session-panel.test.tsx tests/web/books-page-session.test.tsx
git commit -m "feat: add book session context panel"
```

---

## Self-Review

### Spec coverage

- One long-lived session per book: covered in Tasks 1 and 2.
- Chapter processing remains separate: preserved by not modifying chapter session semantics in Tasks 1-6.
- Resume metadata backend-owned: introduced in Task 1, reused in Task 2.
- Visible book-level session panel: Task 3 and Task 4.
- Manual compression only, visible in UI: Task 5.
- Context viewing entry: Task 6.
- Backend command mapping remains product-action based: respected in all frontend wiring.

### Placeholder scan

- No `TODO` or `TBD` placeholders remain.
- Every code change step includes concrete code or exact structures.
- All verification steps include exact commands.

### Type consistency

- `book-master-session` is used consistently as the explicit book-level skill marker.
- `claudeResumeId`, `compressedAt`, and `contextSnapshotJson` are the only metadata fields introduced.
- The panel action names match the approved product language: `压缩上下文`, `查看上下文`.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-14-book-level-session-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**