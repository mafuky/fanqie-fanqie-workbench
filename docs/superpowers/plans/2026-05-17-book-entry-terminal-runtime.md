# Book Entry Terminal Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the “新建一本书” / `book-entry` flow off `claude -p` and onto the tmux-backed Claude Code terminal runtime.

**Architecture:** Keep the existing `/api/sessions` API, `sessions` / `session_messages` tables, BooksPage progress UI, and existing `parseGeneratedBook()` / `materializeGeneratedBook()` book creation logic. Add a focused terminal runner for book-entry that sends prompts into a persistent tmux session, polls captured pane output, persists log deltas, detects complete book-entry material, and supports follow-up answers by injecting text back into the same terminal session.

**Tech Stack:** TypeScript, Fastify, React, better-sqlite3, tmux CLI, existing `TerminalRuntime` and `RuntimeScheduler`.

---

## Files

- Create: `fanqie-workbench/src/claude/book-entry-terminal-runner.ts`
  - Owns book-entry terminal execution, pane polling, log persistence, completion detection, waiting-answer state, and follow-up answer injection.
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
  - Remove `ClaudeSession` / `claude -p` from `book-entry` flow.
  - Route initial `book-entry` prompt and `/answer` continuation through `book-entry-terminal-runner`.
  - Keep non-book-entry prompt compatibility if needed.
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
  - No structural rewrite expected; verify existing `LiveLogPanel` question/answer UI still works.

## Task 1: Extract book-entry helpers for reuse

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`

- [ ] **Step 1: Export or move helper types through local function signatures**

Keep these functions in `sessions.ts` for now, but make the runner receive them as injected callbacks to avoid a broad refactor:

```ts
type BookEntryMaterializer = (stdout: string, dbPath: string) => Promise<{ bookId: string; title: string; rootPath: string }>
type BookEntryCompletenessChecker = (stdout: string) => boolean
```

Use existing logic:

```ts
const isBookEntryComplete: BookEntryCompletenessChecker = (stdout) => parseGeneratedBook(stdout).isComplete
```

- [ ] **Step 2: Do not run unit tests**

User explicitly requested no unit-test execution. Use TypeScript build and browser verification later.

## Task 2: Add book-entry terminal runner

**Files:**
- Create: `fanqie-workbench/src/claude/book-entry-terminal-runner.ts`

- [ ] **Step 1: Create runner API**

```ts
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  getSessionById,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
} from '../db/repositories/sessions-repo.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const BOOK_ENTRY_RUNTIME_BOOK_ID = 'book-entry'

type BookEntryMaterialized = { bookId: string; title: string; rootPath: string }

type RunBookEntryTerminalSessionInput = {
  databasePath: string
  sessionId: string
  prompt: string
  isComplete: (stdout: string) => boolean
  materialize: (stdout: string, databasePath: string) => Promise<BookEntryMaterialized>
  runtime?: TerminalRuntime
  captureIntervalMs?: number
  maxCaptureMs?: number
}

export async function runBookEntryTerminalSession(input: RunBookEntryTerminalSessionInput): Promise<void>
```

- [ ] **Step 2: Implement capture polling**

Inside the runner:

```ts
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDelta(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next.startsWith(previous)) return next.slice(previous.length)
  return next
}
```

Polling behavior:

```ts
const intervalMs = input.captureIntervalMs ?? 1000
const maxMs = input.maxCaptureMs ?? 180000
let previousCapture = ''
let latestCapture = ''
const startedAt = Date.now()

while (Date.now() - startedAt < maxMs) {
  await wait(intervalMs)
  latestCapture = await runtime.capture({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID })
  const delta = getDelta(previousCapture, latestCapture)
  previousCapture = latestCapture
  if (delta.trim()) {
    const id = appendSessionMessage(db, input.sessionId, { role: 'assistant', stream: 'stdout', content: delta })
    emitter.emit('log', { id, stream: 'stdout', chunk: delta })
  }
  if (input.isComplete(latestCapture)) break
}
```

- [ ] **Step 3: Implement status transitions**

Success path:

```ts
if (input.isComplete(latestCapture)) {
  const materialized = await input.materialize(latestCapture, input.databasePath)
  updateSessionMetadata(db, input.sessionId, {
    contextSnapshotJson: JSON.stringify({
      createdBookId: materialized.bookId,
      title: materialized.title,
      rootPath: materialized.rootPath,
      tmuxSessionName: ensured.sessionName,
    }),
  })
  updateSessionPendingQuestion(db, input.sessionId, null)
  updateSessionStatus(db, input.sessionId, 'succeeded', 'book-entry')
  emitter.emit('done', { status: 'succeeded' })
  return
}
```

Incomplete path:

```ts
const question = latestCapture.trim() || '请继续补充这本书的方向。'
updateSessionPendingQuestion(db, input.sessionId, { question, options: [] })
updateSessionStatus(db, input.sessionId, 'waiting-answer', 'book-entry')
emitter.emit('question', { toolUseId: 'book-entry', question, options: [] })
```

Failure path:

```ts
const message = error instanceof Error ? error.message : String(error)
const id = appendSessionMessage(db, input.sessionId, { role: 'assistant', stream: 'stderr', content: message })
emitter.emit('log', { id, stream: 'stderr', chunk: message })
updateSessionStatus(db, input.sessionId, 'failed', 'book-entry')
emitter.emit('done', { status: 'failed' })
```

## Task 3: Route initial book-entry session through terminal runner

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`

- [ ] **Step 1: Import the runner**

```ts
import { runBookEntryTerminalSession } from '../../claude/book-entry-terminal-runner.js'
```

- [ ] **Step 2: Replace `runPromptSession()` for `book-entry` only**

In POST `/api/sessions`, replace:

```ts
if (kind === 'prompt' && sessionPrompt && !existingBookMasterSession) {
  runPromptSession(session.id, sessionPrompt, currentSkill)
}
```

with:

```ts
if (kind === 'prompt' && sessionPrompt && !existingBookMasterSession) {
  if ((currentSkill ?? null) === 'book-entry') {
    void runBookEntryTerminalSession({
      databasePath: getDatabasePath(),
      sessionId: session.id,
      prompt: sessionPrompt,
      isComplete: (stdout) => parseGeneratedBook(stdout).isComplete,
      materialize: materializeGeneratedBook,
    })
  } else {
    runPromptSession(session.id, sessionPrompt, currentSkill)
  }
}
```

- [ ] **Step 3: Keep prompt compatibility**

Do not delete `runPromptSession()` yet if non-book-entry prompt flows still use it.

## Task 4: Route book-entry answers through terminal runner

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`

- [ ] **Step 1: Replace `book-entry` answer continuation**

In POST `/api/sessions/:sessionId/answer`, replace the `book-entry` branch that builds `buildBookEntryContinuePrompt()` and calls `runPromptSession()` with:

```ts
if (session.currentSkill === 'book-entry' && session.status === 'waiting-answer') {
  appendSessionMessage(db, sessionId, { role: 'user', stream: 'question', content: answer })
  updateSessionPendingQuestion(db, sessionId, null)
  updateSessionStatus(db, sessionId, 'running', session.currentSkill)
  db.close()
  void runBookEntryTerminalSession({
    databasePath: getDatabasePath(),
    sessionId,
    prompt: answer,
    isComplete: (stdout) => parseGeneratedBook(stdout).isComplete,
    materialize: materializeGeneratedBook,
  })
  return { answered: true }
}
```

- [ ] **Step 2: Remove `buildBookEntryContinuePrompt()` if unused**

After replacing the branch, remove `buildBookEntryContinuePrompt()` and `buildSessionTranscript()` only if no references remain.

## Task 5: Verification

**Files:**
- No code changes unless verification reveals a bug.

- [ ] **Step 1: Type/build check**

Run:

```bash
cd /Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench && npm exec -- vite build --config vite.config.ts
```

Expected: build succeeds.

- [ ] **Step 2: Browser verification with real tmux**

Run:

```bash
cd /Users/huangzhipeng/Desktop/tomato 写作/fanqie-workbench && npm run dev:all
```

Use `agent-browser-cli`:

1. Open `http://localhost:5173/`.
2. Click `新建一本书`.
3. Submit a concrete idea.
4. Confirm `执行日志` shows tmux/Claude Code output, not a `claude -p` 503 from stream-json.
5. If complete book material is generated, confirm a book appears in BooksPage.
6. If Claude asks for more info, submit an answer and confirm the same session continues.

Expected: no empty log panel; book-entry execution goes through tmux terminal runtime.

## Self-review checklist

- Book-entry initial prompt no longer calls `ClaudeSession.start()` / `claude -p`.
- Book-entry answer continuation no longer calls `ClaudeSession.start()` / `claude -p`.
- Existing chapter terminal runtime remains unchanged.
- Existing session/session_messages/SSE/LiveLogPanel data path remains unchanged.
- Existing parse/materialize logic remains reused.
- No unit tests are added or run, per user instruction.
