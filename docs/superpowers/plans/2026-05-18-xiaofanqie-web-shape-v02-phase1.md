# 小番茄 Web 形态 v0.2 第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通小番茄 v0.2 第一条可用闭环：书库选书 → 单书写作工作台 → 章节正文编辑 → 产品动作触发书级 Claude Code 会话 → 生成后刷新编辑器 → 市场扫榜最小入口和最小绑定。

**Architecture:** Web 继续只做交互壳、编辑器、文件读写、会话控制和市场/发布/资料入口；写作工程继续交给能力包，默认能力包是 `oh-story-claudecode`。第一阶段以“增量迁移”为原则：保留现有 `/api/sessions`、`BooksPage`、`LiveLogPanel`、`book-entry` 流程，新增 Action Registry 与 `/api/actions` 作为新工作台入口，避免一次性大重构。

**Tech Stack:** Vite, React, Fastify, better-sqlite3, Vitest, tmux interactive Claude Code runtime, Node `child_process.spawn`, existing `oh-story-claudecode` scan scripts.

---

## 范围

本计划实现以下设计文档的第一阶段：

`docs/superpowers/specs/2026-05-18-xiaofanqie-web-shape-v02-design.md`

包含：

- 章节正文读写 API
- 保存章节时的最小并发冲突保护
- 共享 terminal capture loop
- 最小 Action Registry
- `/api/actions` 产品动作入口
- 保留旧 `/api/sessions` 章节动作兼容层
- 普通章节 session answer 回传同一本书的 tmux Claude 会话
- 写作三栏 UI：章节列表、编辑器、右侧 Claude 执行面板
- Claude 生成完成后刷新编辑器
- 书库页和全局导航的 v0.2 增量迁移
- 市场情报页面骨架
- 最小市场扫描 runner：调用现有 `oh-story-claudecode` 扫榜脚本并保存 Markdown
- 最小市场结果绑定：复制扫描 Markdown 到目标书的 `对标/市场扫描/`

不包含：

- 完整市场趋势数据库
- 全平台自动定时抓取
- 高级智能推荐排序
- 市场雷达调度
- 选区工具完整 diff UI
- 完整自动发布闭环
- 能力绑定可视化编辑
- 完整拆空 `BooksPage`

---

## 现有代码复用边界

### 必须复用

- `fanqie-workbench/src/server/app.ts`：沿用现有 `register*Routes(app)` 注册方式。
- `fanqie-workbench/src/server/routes/sessions.ts`：保留 prompt、book-entry、chapter、stream、answer、interrupt 的既有行为。
- `fanqie-workbench/src/claude/terminal-runtime.ts`：复用 `ensureSession`、`sendText`、`capture`、`interrupt`、`stop`。
- `fanqie-workbench/src/claude/runtime-scheduler.ts`：继续保证同一本书串行执行。
- `fanqie-workbench/src/claude/chapter-command-builder.ts`：第一阶段作为 Action Registry 的章节命令底座，不重复写命令模板。
- `fanqie-workbench/src/web/components/live-log-panel.tsx`：右侧执行面板包装它，不重写 SSE 客户端。
- `fanqie-workbench/src/server/routes/books.ts`：已有 `GET /api/books/:bookId`、`GET /api/books/:bookId/sessions`、`GET /api/books/:bookId/publications`，新工作台直接使用。

### 第一阶段避免做

- 不删除 `BooksPage`。
- 不删除旧 `chapterActionMap`，只把它迁到 Action Registry 并保留旧 key 映射。
- 不改数据库 schema，除非测试证明无法满足最小闭环。
- 不把 Web 后端写成第二套 `story-long-write`。

---

## 文件结构

### 后端

- Create: `fanqie-workbench/src/server/routes/chapter-content.ts`  
  负责 `GET/PUT /api/chapters/:chapterId/content`，读取/保存章节 Markdown，做路径安全校验和运行中 session 冲突保护。

- Modify: `fanqie-workbench/src/server/app.ts`  
  注册章节内容、Action、市场扫描 route。

- Create: `fanqie-workbench/src/claude/terminal-capture-loop.ts`  
  抽出共享 capture loop：计算 pane delta、持续写入 session messages、识别 done、超时后标记 failed 或 waiting-answer。

- Modify: `fanqie-workbench/src/claude/terminal-session-runner.ts`  
  使用共享 capture loop，支持长运行章节动作。

- Modify: `fanqie-workbench/src/claude/book-entry-terminal-runner.ts`  
  复用共享 capture loop，保持 book-entry 现有行为不回归。

- Create: `fanqie-workbench/src/actions/action-registry.ts`  
  定义新旧 action key、scope、binding，并集中管理旧 `chapter-pipeline` 等兼容 key。

- Create: `fanqie-workbench/src/actions/action-command-builder.ts`  
  根据 action input 调用现有 `buildChapterCommand` 或市场 runner，生成发送给 Claude Code 的命令文本。

- Create: `fanqie-workbench/src/server/routes/actions.ts`  
  提供 `POST /api/actions`。新工作台只发产品动作；旧 `/api/sessions` 继续可用。

- Modify: `fanqie-workbench/src/server/routes/sessions.ts`  
  删除本文件内私有 `chapterActionMap`，改为调用 Action Registry；普通章节 `answer` 回传 tmux runtime，book-entry 逻辑保持优先。

- Create: `fanqie-workbench/src/market/market-scan-presets.ts`  
  定义扫榜 preset，并映射到 `oh-story-claudecode` 的真实脚本路径和参数。

- Create: `fanqie-workbench/src/market/market-scan-runner.ts`  
  使用 `node` + `spawn` 运行扫榜脚本，把 Markdown 保存到 `fanqie-workbench/data/market-scans/YYYY-MM-DD/`。

- Create: `fanqie-workbench/src/server/routes/market-scans.ts`  
  提供 `POST /api/market-scans`、`GET /api/market-scans`、`POST /api/market-scans/:scanId/bind-book`。

### 前端

- Create: `fanqie-workbench/src/web/pages/library-page.tsx`  
  新书库页，复用当前 `/api/books` 和 `/api/books/scan`。

- Create: `fanqie-workbench/src/web/pages/book-workspace-page.tsx`  
  单书工作台第一版，包含 Dashboard 占位、写作三栏、Claude 会话、创作流程、发布、资料 / 工具 tab。

- Create: `fanqie-workbench/src/web/components/chapter-editor.tsx`  
  章节 Markdown 编辑器，支持 dirty state、字数统计、保存、409 冲突提示。

- Create: `fanqie-workbench/src/web/components/claude-execution-panel.tsx`  
  包装 `LiveLogPanel`，增加动作标题、停止按钮和完整会话入口占位。

- Create: `fanqie-workbench/src/web/pages/market-intelligence-page.tsx`  
  市场情报页面骨架，展示扫榜 preset、最近结果、绑定到书按钮和简单趋势占位。

- Modify: `fanqie-workbench/src/web/app.tsx`  
  更新一级导航：书库、当前任务、市场情报、资料库、账号发布、设置。保留旧 `PromptPage` 作为设置/高级调试占位入口。

- Keep: `fanqie-workbench/src/web/pages/books-page.tsx`  
  第一阶段不拆空，只保证旧入口不回归。

### 测试

- Create: `fanqie-workbench/tests/server/chapter-content-route.test.ts`
- Create: `fanqie-workbench/tests/claude/terminal-capture-loop.test.ts`
- Create: `fanqie-workbench/tests/actions/action-registry.test.ts`
- Create: `fanqie-workbench/tests/server/action-route.test.ts`
- Create: `fanqie-workbench/tests/server/session-answer-runtime.test.ts`
- Create: `fanqie-workbench/tests/market/market-scan-runner.test.ts`
- Create: `fanqie-workbench/tests/server/market-scans-route.test.ts`
- Create: `fanqie-workbench/tests/web/chapter-editor.test.tsx`
- Create: `fanqie-workbench/tests/web/claude-execution-panel.test.tsx`
- Create: `fanqie-workbench/tests/web/book-workspace-page.test.tsx`
- Create: `fanqie-workbench/tests/web/app-navigation.test.tsx`
- Create: `fanqie-workbench/tests/web/market-intelligence-page.test.tsx`

---

# Task 1: 章节正文读写 API 与保存冲突保护

**Files:**

- Create: `fanqie-workbench/src/server/routes/chapter-content.ts`
- Modify: `fanqie-workbench/src/server/app.ts`
- Test: `fanqie-workbench/tests/server/chapter-content-route.test.ts`

**Goal:** 让 Web 编辑器读取和保存章节正文文件，同时避免用户保存覆盖正在运行的 Claude 章节任务。

- [ ] **Step 1: Write failing tests for read, save, unsafe path, and running-session conflict**

Create `fanqie-workbench/tests/server/chapter-content-route.test.ts` with tests covering these cases:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-content-route.test.ts
```

Expected: FAIL because route is not registered.

- [ ] **Step 3: Implement chapter content route**

Create `fanqie-workbench/src/server/routes/chapter-content.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

function isPathInside(parent: string, child: string) {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith('/')
}

type ChapterContentRow = {
  id: string
  title: string
  chapter_number: number
  source_path: string
  book_id: string
  root_path: string
}

function getChapterContentRow(chapterId: string) {
  const db = openDatabase(getDatabasePath())
  try {
    return db.prepare(
      `SELECT c.id, c.title, c.chapter_number, c.source_path, c.book_id, b.root_path
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    ).get(chapterId) as ChapterContentRow | undefined
  } finally {
    db.close()
  }
}

function assertSafeChapterPath(row: ChapterContentRow) {
  const rootPath = resolve(row.root_path)
  const sourcePath = resolve(row.source_path)
  if (!isPathInside(rootPath, sourcePath)) {
    return 'chapter source path must be inside book root'
  }
  if (extname(sourcePath) !== '.md') {
    return 'chapter source path must be a markdown file'
  }
  return null
}

function hasRunningClaudeSession(bookId: string) {
  const db = openDatabase(getDatabasePath())
  try {
    const row = db.prepare(
      `SELECT id
       FROM sessions
       WHERE book_id = ?
         AND kind = 'chapter'
         AND status IN ('running', 'waiting-answer')
       LIMIT 1`,
    ).get(bookId)
    return !!row
  } finally {
    db.close()
  }
}

function toResponseChapter(row: ChapterContentRow) {
  return {
    id: row.id,
    title: row.title,
    chapterNumber: row.chapter_number,
    sourcePath: resolve(row.source_path),
  }
}

export async function registerChapterContentRoutes(app: FastifyInstance) {
  app.get<{ Params: { chapterId: string } }>('/api/chapters/:chapterId/content', async (request, reply) => {
    const row = getChapterContentRow(request.params.chapterId)
    if (!row) return reply.code(404).send({ error: 'chapter not found' })

    const safetyError = assertSafeChapterPath(row)
    if (safetyError) return reply.code(400).send({ error: safetyError })

    const content = await readFile(resolve(row.source_path), 'utf8')
    return { chapter: toResponseChapter(row), content }
  })

  app.put<{ Params: { chapterId: string }; Body: { content?: string } }>('/api/chapters/:chapterId/content', async (request, reply) => {
    const content = request.body?.content
    if (typeof content !== 'string') return reply.code(400).send({ error: 'content is required' })

    const row = getChapterContentRow(request.params.chapterId)
    if (!row) return reply.code(404).send({ error: 'chapter not found' })

    const safetyError = assertSafeChapterPath(row)
    if (safetyError) return reply.code(400).send({ error: safetyError })

    if (hasRunningClaudeSession(row.book_id)) {
      return reply.code(409).send({ error: 'chapter is being modified by a running Claude session' })
    }

    await writeFile(resolve(row.source_path), content, 'utf8')
    return { saved: true }
  })
}
```

- [ ] **Step 4: Register route in app**

Modify `fanqie-workbench/src/server/app.ts`:

```ts
import { registerChapterContentRoutes } from './routes/chapter-content.js'
```

Add after `registerChapterRoutes(app)`:

```ts
await registerChapterContentRoutes(app)
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-content-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/server/routes/chapter-content.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/server/chapter-content-route.test.ts
git commit -m "feat: add chapter content API"
```

---

# Task 2: 共享 terminal capture loop

**Files:**

- Create: `fanqie-workbench/src/claude/terminal-capture-loop.ts`
- Modify: `fanqie-workbench/src/claude/terminal-session-runner.ts`
- Modify: `fanqie-workbench/src/claude/book-entry-terminal-runner.ts`
- Test: `fanqie-workbench/tests/claude/terminal-capture-loop.test.ts`

**Goal:** 把章节执行从“一次 capture”改成长运行 capture，并让 book-entry 和章节动作复用同一套 delta/timeout/done 行为。

- [ ] **Step 1: Write failing capture-loop tests**

Create `fanqie-workbench/tests/claude/terminal-capture-loop.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, getSessionById, getSessionMessages } from '../../src/db/repositories/sessions-repo.js'
import { runTerminalSessionCommand } from '../../src/claude/terminal-session-runner.js'
import type { TerminalRuntime } from '../../src/claude/terminal-runtime.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-terminal-loop-'))
  return resolve(dir, name)
}

function createCaptureRuntime(captures: string[]): TerminalRuntime {
  let index = 0
  return {
    ensureSession: async () => ({ sessionName: 'fanqie-book-book-1', created: true }),
    sendText: async () => {},
    capture: async () => captures[Math.min(index++, captures.length - 1)] ?? '',
    interrupt: async () => {},
    stop: async () => {},
  }
}

describe('terminal capture loop', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('captures multiple deltas until done marker appears', async () => {
    const databasePath = await createTempDatabasePath('loop.sqlite')
    const db = openDatabase(databasePath)
    const session = createSession(db, { kind: 'chapter', bookId: 'book-1', status: 'running', currentSkill: 'chapter.continue' })
    db.close()

    await runTerminalSessionCommand({
      databasePath,
      sessionId: session.id,
      bookId: 'book-1',
      command: '/story-long-write 继续写',
      runtime: createCaptureRuntime([
        '正在检查材料',
        '正在检查材料\n正在写正文',
        '正在检查材料\n正在写正文\n[WORKBENCH_STAGE: done]',
      ]),
      captureIntervalMs: 1,
      maxCaptureMs: 100,
    })

    const verifyDb = openDatabase(databasePath)
    const messages = getSessionMessages(verifyDb, session.id).map((message) => message.content).join('\n')
    const updated = getSessionById(verifyDb, session.id)
    verifyDb.close()

    expect(messages).toContain('正在检查材料')
    expect(messages).toContain('正在写正文')
    expect(messages).toContain('[WORKBENCH_STAGE: done]')
    expect(updated?.status).toBe('succeeded')
  })

  it('marks the session failed when capture times out before done', async () => {
    const databasePath = await createTempDatabasePath('timeout.sqlite')
    const db = openDatabase(databasePath)
    const session = createSession(db, { kind: 'chapter', bookId: 'book-1', status: 'running', currentSkill: 'chapter.continue' })
    db.close()

    await runTerminalSessionCommand({
      databasePath,
      sessionId: session.id,
      bookId: 'book-1',
      command: '/story-long-write 继续写',
      runtime: createCaptureRuntime(['一直运行', '一直运行', '一直运行']),
      captureIntervalMs: 1,
      maxCaptureMs: 3,
    })

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    const messages = getSessionMessages(verifyDb, session.id).map((message) => message.content).join('\n')
    verifyDb.close()

    expect(updated?.status).toBe('failed')
    expect(messages).toContain('terminal capture timed out')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-capture-loop.test.ts
```

Expected: FAIL because `terminal-session-runner.ts` only captures once.

- [ ] **Step 3: Implement shared capture loop**

Create `fanqie-workbench/src/claude/terminal-capture-loop.ts`:

```ts
import type Database from 'better-sqlite3'
import { appendSessionMessage, updateSessionPendingQuestion, updateSessionStatus, type SessionStatus } from '../db/repositories/sessions-repo.js'
import { getOrCreateEmitter } from './stream-capture.js'
import type { TerminalRuntime } from './terminal-runtime.js'

export type CaptureLoopCompletion =
  | { status: 'succeeded' }
  | { status: 'waiting-answer'; question: string }
  | { status: 'failed'; message: string }

export type RunTerminalCaptureLoopInput = {
  db: Database.Database
  sessionId: string
  bookId: string
  runtime: TerminalRuntime
  currentSkill?: string | null
  captureIntervalMs?: number
  maxCaptureMs?: number
  isComplete?: (capture: string) => boolean
  shouldWaitForAnswer?: (capture: string) => boolean
  getPendingQuestion?: (capture: string) => string
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function getCaptureDelta(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next.startsWith(previous)) return next.slice(previous.length)

  const previousLines = previous.split('\n')
  const nextLines = next.split('\n')
  const maxOverlap = Math.min(previousLines.length, nextLines.length)
  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousTail = previousLines.slice(previousLines.length - size).join('\n')
    const nextHead = nextLines.slice(0, size).join('\n')
    if (previousTail === nextHead) return nextLines.slice(size).join('\n')
  }
  return ''
}

function appendAndEmit(db: Database.Database, sessionId: string, stream: 'stdout' | 'stderr', content: string) {
  const emitter = getOrCreateEmitter(sessionId)
  const id = appendSessionMessage(db, sessionId, { role: 'assistant', stream, content })
  emitter.emit('log', { id, stream, chunk: content })
}

export async function runTerminalCaptureLoop(input: RunTerminalCaptureLoopInput): Promise<CaptureLoopCompletion> {
  const intervalMs = input.captureIntervalMs ?? 1000
  const maxMs = input.maxCaptureMs ?? 180000
  const isComplete = input.isComplete ?? ((capture: string) => /\[WORKBENCH_STAGE:\s*done\]/.test(capture))
  const shouldWaitForAnswer = input.shouldWaitForAnswer ?? (() => false)
  const getPendingQuestion = input.getPendingQuestion ?? ((capture: string) => {
    const tail = capture.split('\n').map((line) => line.trim()).filter(Boolean).slice(-8).join('\n')
    return tail || '请继续补充。'
  })

  const startedAt = Date.now()
  let previousCapture = ''
  let latestCapture = ''

  while (Date.now() - startedAt < maxMs) {
    await wait(intervalMs)
    latestCapture = await input.runtime.capture({ bookId: input.bookId })
    const delta = getCaptureDelta(previousCapture, latestCapture)
    previousCapture = latestCapture

    if (delta.trim()) appendAndEmit(input.db, input.sessionId, 'stdout', delta)

    if (isComplete(latestCapture)) {
      updateSessionStatus(input.db, input.sessionId, 'succeeded', input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('done', { status: 'succeeded' })
      return { status: 'succeeded' }
    }

    if (shouldWaitForAnswer(latestCapture)) {
      const question = getPendingQuestion(latestCapture)
      updateSessionPendingQuestion(input.db, input.sessionId, { question, options: [] })
      updateSessionStatus(input.db, input.sessionId, 'waiting-answer' as SessionStatus, input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('question', { toolUseId: input.sessionId, question, options: [] })
      return { status: 'waiting-answer', question }
    }
  }

  const message = 'terminal capture timed out before completion marker'
  appendAndEmit(input.db, input.sessionId, 'stderr', message)
  updateSessionStatus(input.db, input.sessionId, 'failed', input.currentSkill ?? undefined)
  getOrCreateEmitter(input.sessionId).emit('done', { status: 'failed' })
  return { status: 'failed', message }
}
```

- [ ] **Step 4: Update terminal-session-runner**

Modify `fanqie-workbench/src/claude/terminal-session-runner.ts` so it imports and uses `runTerminalCaptureLoop`. Keep `defaultRuntimeScheduler.run({ bookId })` around the whole operation. The input type must include:

```ts
captureIntervalMs?: number
maxCaptureMs?: number
isComplete?: (capture: string) => boolean
```

The runner must:

1. open DB
2. mark session running
3. ensure tmux session
4. append user input message
5. call `runtime.sendText`
6. call `runTerminalCaptureLoop`
7. close DB in `finally`

- [ ] **Step 5: Update book-entry-terminal-runner without changing behavior**

Modify `fanqie-workbench/src/claude/book-entry-terminal-runner.ts` to use `runTerminalCaptureLoop` with:

```ts
shouldWaitForAnswer: (capture) => !input.isComplete(capture),
isComplete: input.isComplete,
getPendingQuestion: getPendingQuestion,
currentSkill: 'book-entry',
```

Keep the existing materialization behavior: when `input.isComplete(stdout)` becomes true, materialize the generated book before marking succeeded. If implementation needs a special branch, keep book-entry status behavior covered by `tests/server/book-creation-session.test.ts`.

- [ ] **Step 6: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-capture-loop.test.ts tests/server/book-creation-session.test.ts tests/server/chapter-action-session.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add fanqie-workbench/src/claude/terminal-capture-loop.ts fanqie-workbench/src/claude/terminal-session-runner.ts fanqie-workbench/src/claude/book-entry-terminal-runner.ts fanqie-workbench/tests/claude/terminal-capture-loop.test.ts
git commit -m "feat: share terminal capture loop"
```

---

# Task 3: Action Registry 与旧 key 兼容层

**Files:**

- Create: `fanqie-workbench/src/actions/action-registry.ts`
- Create: `fanqie-workbench/src/actions/action-command-builder.ts`
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/actions/action-registry.test.ts`
- Test: `fanqie-workbench/tests/server/chapter-action-session.test.ts`

**Goal:** 前端新工作台发送产品动作如 `chapter.continue`；旧 `BooksPage` 继续发送 `chapter-pipeline` 等 key，后端统一映射到能力绑定。

- [ ] **Step 1: Write failing action registry tests**

Create `fanqie-workbench/tests/actions/action-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildActionCommand } from '../../src/actions/action-command-builder.js'
import { getActionBinding, normalizeActionKey } from '../../src/actions/action-registry.js'

describe('action registry', () => {
  it('contains default chapter action bindings', () => {
    expect(getActionBinding('chapter.continue')).toMatchObject({
      actionKey: 'chapter.continue',
      scope: 'chapter',
      capability: 'oh-story-claudecode',
      command: '/story-long-write',
      legacyCurrentSkill: 'chapter-pipeline',
    })
    expect(getActionBinding('chapter.deslop').command).toBe('/story-deslop')
    expect(getActionBinding('chapter.review').command).toBe('/story-review')
  })

  it('normalizes legacy currentSkill values', () => {
    expect(normalizeActionKey('chapter-pipeline')).toBe('chapter.continue')
    expect(normalizeActionKey('chapter-polish')).toBe('chapter.polish')
    expect(normalizeActionKey('chapter-deslop')).toBe('chapter.deslop')
    expect(normalizeActionKey('chapter-review')).toBe('chapter.review')
    expect(normalizeActionKey('chapter-rewrite')).toBe('chapter.rewrite')
  })

  it('throws for unknown actions', () => {
    expect(() => getActionBinding('unknown.action' as never)).toThrow('Unknown action')
  })

  it('builds a chapter command through the existing chapter command builder', () => {
    const command = buildActionCommand({
      actionKey: 'chapter.continue',
      bookTitle: '雾港疑局',
      bookRoot: '/tmp/book',
      chapterNumber: 37,
      chapterTitle: '暴雨夜的第二具尸体',
      chapterPath: '/tmp/book/正文/第037章_暴雨夜的第二具尸体.md',
    })

    expect(command).toContain('/story-long-write')
    expect(command).toContain('继续写《雾港疑局》第 37 章')
    expect(command).toContain('书籍目录：/tmp/book')
    expect(command).toContain('章节文件：/tmp/book/正文/第037章_暴雨夜的第二具尸体.md')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/actions/action-registry.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement `action-registry.ts`**

Create `fanqie-workbench/src/actions/action-registry.ts`:

```ts
export type ActionKey =
  | 'chapter.continue'
  | 'chapter.polish'
  | 'chapter.deslop'
  | 'chapter.review'
  | 'chapter.rewrite'
  | 'editor.selection.polish'
  | 'editor.selection.rewrite'
  | 'market.scan'
  | 'market.bindToBook'
  | 'publish.chapters'

export type ActionScope = 'book' | 'chapter' | 'selection' | 'market' | 'publish'

export type CapabilityBinding = {
  actionKey: ActionKey
  scope: ActionScope
  capability: 'oh-story-claudecode' | 'fanqie-workbench'
  command: string
  legacyCurrentSkill?: string
}

const bindings: Record<ActionKey, CapabilityBinding> = {
  'chapter.continue': { actionKey: 'chapter.continue', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-pipeline' },
  'chapter.polish': { actionKey: 'chapter.polish', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-polish' },
  'chapter.deslop': { actionKey: 'chapter.deslop', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-deslop', legacyCurrentSkill: 'chapter-deslop' },
  'chapter.review': { actionKey: 'chapter.review', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-review', legacyCurrentSkill: 'chapter-review' },
  'chapter.rewrite': { actionKey: 'chapter.rewrite', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-rewrite' },
  'editor.selection.polish': { actionKey: 'editor.selection.polish', scope: 'selection', capability: 'oh-story-claudecode', command: '/story-long-write' },
  'editor.selection.rewrite': { actionKey: 'editor.selection.rewrite', scope: 'selection', capability: 'oh-story-claudecode', command: '/story-long-write' },
  'market.scan': { actionKey: 'market.scan', scope: 'market', capability: 'oh-story-claudecode', command: 'market-scan-runner' },
  'market.bindToBook': { actionKey: 'market.bindToBook', scope: 'market', capability: 'fanqie-workbench', command: 'bind-market-scan-to-book' },
  'publish.chapters': { actionKey: 'publish.chapters', scope: 'publish', capability: 'fanqie-workbench', command: 'publish-runner' },
}

const legacyActionKeys: Record<string, ActionKey> = Object.fromEntries(
  Object.values(bindings)
    .filter((binding) => binding.legacyCurrentSkill)
    .map((binding) => [binding.legacyCurrentSkill as string, binding.actionKey]),
) as Record<string, ActionKey>

export function normalizeActionKey(value: string): ActionKey {
  if (value in bindings) return value as ActionKey
  const legacy = legacyActionKeys[value]
  if (legacy) return legacy
  throw new Error(`Unknown action: ${value}`)
}

export function getActionBinding(actionKey: ActionKey): CapabilityBinding {
  const binding = bindings[actionKey]
  if (!binding) throw new Error(`Unknown action: ${actionKey}`)
  return binding
}
```

- [ ] **Step 4: Implement `action-command-builder.ts`**

Create `fanqie-workbench/src/actions/action-command-builder.ts`:

```ts
import { buildChapterCommand, type ChapterCommandAction } from '../claude/chapter-command-builder.js'
import { normalizeActionKey, type ActionKey } from './action-registry.js'

export type BuildActionCommandInput = {
  actionKey: ActionKey | string
  bookTitle: string
  bookRoot: string
  chapterNumber: number
  chapterTitle: string
  chapterPath: string
  userHint?: string | null
}

const chapterActionByActionKey: Record<ActionKey, ChapterCommandAction | null> = {
  'chapter.continue': 'chapter-write',
  'chapter.polish': 'chapter-polish',
  'chapter.deslop': 'chapter-deslop',
  'chapter.review': 'chapter-review',
  'chapter.rewrite': 'chapter-rewrite',
  'editor.selection.polish': null,
  'editor.selection.rewrite': null,
  'market.scan': null,
  'market.bindToBook': null,
  'publish.chapters': null,
}

export function buildActionCommand(input: BuildActionCommandInput): string {
  const actionKey = normalizeActionKey(input.actionKey)
  const chapterAction = chapterActionByActionKey[actionKey]
  if (!chapterAction) throw new Error(`Action ${actionKey} does not build a chapter command`)

  return buildChapterCommand({
    action: chapterAction,
    bookTitle: input.bookTitle,
    bookRoot: input.bookRoot,
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    chapterPath: input.chapterPath,
    userHint: input.userHint,
  })
}
```

- [ ] **Step 5: Replace private `chapterActionMap` in sessions route**

Modify `fanqie-workbench/src/server/routes/sessions.ts`:

1. Remove the local `chapterActionMap` constant.
2. Import:

```ts
import { buildActionCommand } from '../../actions/action-command-builder.js'
import { normalizeActionKey } from '../../actions/action-registry.js'
```

3. Replace command building in the chapter branch with:

```ts
const actionKey = normalizeActionKey(currentSkill || 'chapter-pipeline')
const command = buildActionCommand({
  actionKey,
  bookTitle: chapter.book_title,
  bookRoot: chapter.book_root,
  chapterNumber: chapter.chapter_number,
  chapterTitle: chapter.title,
  chapterPath: chapter.source_path,
})
```

4. Keep `createSession(db, { kind, bookId, chapterId, currentSkill })` unchanged so old UI expectations still pass.

- [ ] **Step 6: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/actions/action-registry.test.ts tests/server/chapter-action-session.test.ts tests/server/session-chapter-execution.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add fanqie-workbench/src/actions/action-registry.ts fanqie-workbench/src/actions/action-command-builder.ts fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/tests/actions/action-registry.test.ts
git commit -m "feat: add action registry compatibility layer"
```

---

# Task 4: 普通章节 answer 回传 tmux runtime

**Files:**

- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/session-answer-runtime.test.ts`
- Existing regression: `fanqie-workbench/tests/server/book-creation-session.test.ts`

**Goal:** 当右侧 Claude 面板出现问题时，用户回答能发送回同一本书的 Claude Code tmux 会话；book-entry 的回答恢复逻辑保持优先。

- [ ] **Step 1: Write failing answer routing tests**

Create `fanqie-workbench/tests/server/session-answer-runtime.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, getSessionById } from '../../src/db/repositories/sessions-repo.js'

const sendText = vi.fn()
vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => ({
    ensureSession: vi.fn(),
    sendText,
    capture: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
  }),
}))

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-answer-runtime-'))
  return resolve(dir, name)
}

describe('session answer runtime routing', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.clearAllMocks()
  })

  it('sends ordinary chapter answers to the book tmux runtime', async () => {
    const databasePath = await createTempDatabasePath('answer.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      chapterId: 'chapter-1',
      status: 'waiting-answer',
      currentSkill: 'chapter.continue',
      pendingQuestionJson: JSON.stringify({ question: '先查资料吗？', options: [] }),
    })
    db.close()
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/answer`,
      payload: { answer: '先查资料' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ answered: true })
    expect(sendText).toHaveBeenCalledWith({ bookId: 'book-1', text: '先查资料' })

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    verifyDb.close()
    expect(updated?.status).toBe('running')
    expect(updated?.pendingQuestionJson).toBeNull()

    await app.close()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-answer-runtime.test.ts
```

Expected: FAIL with `no pending question for this session`.

- [ ] **Step 3: Implement chapter answer fallback after book-entry branch**

Modify `/api/sessions/:sessionId/answer` in `fanqie-workbench/src/server/routes/sessions.ts`.

Keep this order:

1. validate answer
2. load session
3. call `submitAnswer(sessionId, answer)` for in-process prompt sessions
4. handle `session.currentSkill === 'book-entry' && session.status === 'waiting-answer'`
5. handle ordinary book-bound sessions

Add after the book-entry branch:

```ts
if (session.bookId && session.status === 'waiting-answer') {
  const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
  await runtime.sendText({ bookId: session.bookId, text: answer })
  appendSessionMessage(db, sessionId, { role: 'user', stream: 'question', content: answer })
  updateSessionPendingQuestion(db, sessionId, null)
  updateSessionStatus(db, sessionId, 'running', session.currentSkill)
  db.close()
  return { answered: true }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-answer-runtime.test.ts tests/server/book-creation-session.test.ts tests/web/live-log-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/tests/server/session-answer-runtime.test.ts
git commit -m "feat: route chapter answers to runtime"
```

---

# Task 5: `/api/actions` 产品动作入口

**Files:**

- Create: `fanqie-workbench/src/server/routes/actions.ts`
- Modify: `fanqie-workbench/src/server/app.ts`
- Test: `fanqie-workbench/tests/server/action-route.test.ts`

**Goal:** 新工作台用 `/api/actions` 创建产品动作 session；旧 `/api/sessions` 不删除。

- [ ] **Step 1: Write failing action route tests**

Create `fanqie-workbench/tests/server/action-route.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

const runTerminalSessionCommand = vi.fn()
vi.mock('../../src/claude/terminal-session-runner.js', () => ({
  runTerminalSessionCommand: (...args: unknown[]) => runTerminalSessionCommand(...args),
}))

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

async function createFixture() {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-action-route-'))
  const databasePath = resolve(dir, 'workbench.sqlite')
  const db = openDatabase(databasePath)
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
  db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run('chapter-1', 'book-1', 1, '雾夜失踪', '/tmp/book/正文/第001章_雾夜失踪.md', '待写作')
  db.close()
  process.env.WORKBENCH_DB = databasePath
  return { databasePath }
}

describe('action route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.clearAllMocks()
  })

  it('creates a chapter action session and starts terminal runner', async () => {
    await createFixture()
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { actionKey: 'chapter.continue', bookId: 'book-1', chapterId: 'chapter-1' },
    })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(201)
    expect(body.session).toMatchObject({ kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', currentSkill: 'chapter.continue' })
    expect(runTerminalSessionCommand).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: body.session.id,
      bookId: 'book-1',
      command: expect.stringContaining('/story-long-write'),
    }))

    await app.close()
  })

  it('returns 400 for unknown action', async () => {
    await createFixture()
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { actionKey: 'unknown.action', bookId: 'book-1', chapterId: 'chapter-1' },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error).toContain('Unknown action')

    await app.close()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/action-route.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement actions route**

Create `fanqie-workbench/src/server/routes/actions.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { createSession } from '../../db/repositories/sessions-repo.js'
import { buildActionCommand } from '../../actions/action-command-builder.js'
import { getActionBinding, normalizeActionKey } from '../../actions/action-registry.js'
import { runTerminalSessionCommand } from '../../claude/terminal-session-runner.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

type ChapterActionRow = {
  id: string
  title: string
  source_path: string
  chapter_number: number
  book_id: string
  book_title: string
  book_root: string
}

export async function registerActionRoutes(app: FastifyInstance) {
  app.post<{ Body: { actionKey?: string; bookId?: string; chapterId?: string; userHint?: string } }>('/api/actions', async (request, reply) => {
    const { actionKey: rawActionKey, bookId, chapterId, userHint } = request.body || {}
    if (!rawActionKey) return reply.code(400).send({ error: 'actionKey is required' })

    let actionKey
    try {
      actionKey = normalizeActionKey(rawActionKey)
      const binding = getActionBinding(actionKey)
      if (binding.scope !== 'chapter') return reply.code(400).send({ error: 'only chapter actions are supported in phase 1' })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }

    if (!bookId) return reply.code(400).send({ error: 'bookId is required' })
    if (!chapterId) return reply.code(400).send({ error: 'chapterId is required' })

    const db = openDatabase(getDatabasePath())
    try {
      const chapter = db.prepare(
        `SELECT c.id, c.title, c.source_path, c.chapter_number, c.book_id,
                b.title AS book_title, b.root_path AS book_root
         FROM chapters c
         JOIN books b ON b.id = c.book_id
         WHERE c.id = ? AND c.book_id = ?`,
      ).get(chapterId, bookId) as ChapterActionRow | undefined

      if (!chapter) return reply.code(404).send({ error: 'chapter not found' })

      const session = createSession(db, {
        kind: 'chapter',
        bookId,
        chapterId,
        currentSkill: actionKey,
      })

      const command = buildActionCommand({
        actionKey,
        bookTitle: chapter.book_title,
        bookRoot: chapter.book_root,
        chapterNumber: chapter.chapter_number,
        chapterTitle: chapter.title,
        chapterPath: chapter.source_path,
        userHint,
      })

      void runTerminalSessionCommand({
        databasePath: getDatabasePath(),
        sessionId: session.id,
        bookId,
        command,
      })

      return reply.code(201).send({ session })
    } finally {
      db.close()
    }
  })
}
```

- [ ] **Step 4: Register route**

Modify `fanqie-workbench/src/server/app.ts`:

```ts
import { registerActionRoutes } from './routes/actions.js'
```

Add after session routes:

```ts
await registerActionRoutes(app)
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/action-route.test.ts tests/server/chapter-action-session.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/server/routes/actions.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/server/action-route.test.ts
git commit -m "feat: add product action route"
```

---

# Task 6: 章节编辑器组件

**Files:**

- Create: `fanqie-workbench/src/web/components/chapter-editor.tsx`
- Test: `fanqie-workbench/tests/web/chapter-editor.test.tsx`

**Goal:** 提供可复用章节 Markdown 编辑器，支持读取、编辑、保存、未保存提示、字数统计和 409 冲突提示。

- [ ] **Step 1: Write failing component tests**

Create `fanqie-workbench/tests/web/chapter-editor.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChapterEditor } from '../../src/web/components/chapter-editor.js'

describe('ChapterEditor', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/chapters/chapter-1/content' && !init) {
        return {
          ok: true,
          json: async () => ({
            chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1, sourcePath: '/tmp/book/正文/第001章_雾夜失踪.md' },
            content: '# 第001章 雾夜失踪\n\n旧内容\n',
          }),
        }
      }
      if (input === '/api/chapters/chapter-1/content' && init?.method === 'PUT') {
        return { ok: true, json: async () => ({ saved: true }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads chapter content', async () => {
    render(<ChapterEditor chapterId="chapter-1" />)
    expect(await screen.findByDisplayValue(/旧内容/)).toBeTruthy()
  })

  it('shows dirty state and word count after editing', async () => {
    render(<ChapterEditor chapterId="chapter-1" />)
    const editor = await screen.findByLabelText('章节正文')
    fireEvent.change(editor, { target: { value: '# 第001章 雾夜失踪\n\n新内容' } })
    expect(screen.getByText('未保存')).toBeTruthy()
    expect(screen.getByText(/字数/)).toBeTruthy()
  })

  it('saves edited content', async () => {
    const onSaved = vi.fn()
    render(<ChapterEditor chapterId="chapter-1" onSaved={onSaved} />)
    const editor = await screen.findByLabelText('章节正文')
    fireEvent.change(editor, { target: { value: '# 第001章 雾夜失踪\n\n新内容\n' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/chapters/chapter-1/content', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: '# 第001章 雾夜失踪\n\n新内容\n' }),
      }))
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('shows conflict when save returns 409', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (!init) return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '旧内容' }) }
      return { ok: false, status: 409, json: async () => ({ error: 'chapter is being modified by a running Claude session' }) }
    })

    render(<ChapterEditor chapterId="chapter-1" />)
    fireEvent.change(await screen.findByLabelText('章节正文'), { target: { value: '新内容' } })
    fireEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('Claude 正在修改本书，暂时不能覆盖保存。')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/chapter-editor.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement component**

Create `fanqie-workbench/src/web/components/chapter-editor.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

export function ChapterEditor({ chapterId, onSaved }: { chapterId: string; onSaved?: () => void }) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/chapters/${chapterId}/content`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setContent(data.content ?? '')
        setSavedContent(data.content ?? '')
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chapterId])

  const dirty = content !== savedContent
  const wordCount = useMemo(() => content.replace(/\s/g, '').length, [content])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chapters/${chapterId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        if (res.status === 409) {
          setError('Claude 正在修改本书，暂时不能覆盖保存。')
          return
        }
        const body = await res.json().catch(() => ({}))
        setError(body.error || '保存失败')
        return
      }
      setSavedContent(content)
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>正在加载章节…</div>

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
        <span style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>字数：{wordCount}</span>
        <span style={{ flex: 1 }} />
        {dirty && <span style={{ fontSize: fontSize.sm, color: 'var(--accent)' }}>未保存</span>}
        <button onClick={() => void save()} disabled={saving || !dirty} style={{ padding: '8px 14px', borderRadius: radius.md, border: 'none', background: 'var(--accent)', color: 'white', opacity: saving || !dirty ? 0.6 : 1 }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      {error && <div style={{ marginBottom: spacing.sm, color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}
      <textarea
        aria-label="章节正文"
        value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
        style={{
          flex: 1,
          minHeight: 520,
          padding: spacing.lg,
          borderRadius: radius.lg,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: fontSize.md,
          lineHeight: 1.8,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
    </section>
  )
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/chapter-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/components/chapter-editor.tsx fanqie-workbench/tests/web/chapter-editor.test.tsx
git commit -m "feat: add chapter editor"
```

---

# Task 7: Claude 执行面板组件

**Files:**

- Create: `fanqie-workbench/src/web/components/claude-execution-panel.tsx`
- Test: `fanqie-workbench/tests/web/claude-execution-panel.test.tsx`
- Existing regression: `fanqie-workbench/tests/web/live-log-panel.test.tsx`

**Goal:** 复用 `LiveLogPanel`，提供右侧执行面板标题、停止按钮和完成回调。

- [ ] **Step 1: Write failing component tests**

Create `fanqie-workbench/tests/web/claude-execution-panel.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClaudeExecutionPanel } from '../../src/web/components/claude-execution-panel.js'

vi.mock('../../src/web/components/live-log-panel.js', () => ({
  LiveLogPanel: ({ taskId, streamBase, onDone }: any) => (
    <div>
      <div>执行日志</div>
      <div>session:{taskId}</div>
      <div>stream:{streamBase}</div>
      <button onClick={() => onDone?.('succeeded')}>mock done</button>
    </div>
  ),
}))

describe('ClaudeExecutionPanel', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ interrupted: true }) })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows action label and session log', () => {
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" />)
    expect(screen.getByText('继续写本章')).toBeTruthy()
    expect(screen.getByText('执行日志')).toBeTruthy()
    expect(screen.getByText('stream:sessions')).toBeTruthy()
  })

  it('calls session interrupt when stop is clicked', async () => {
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" />)
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/s1/interrupt', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('calls onDone when LiveLogPanel completes', async () => {
    const onDone = vi.fn()
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" onDone={onDone} />)
    fireEvent.click(screen.getByText('mock done'))
    expect(onDone).toHaveBeenCalledWith('succeeded')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/claude-execution-panel.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement component**

Create `fanqie-workbench/src/web/components/claude-execution-panel.tsx`:

```tsx
import { LiveLogPanel } from './live-log-panel.js'
import { spacing, fontSize, radius } from '../styles/tokens.js'

export function ClaudeExecutionPanel({ sessionId, actionLabel, onDone }: { sessionId: string | null; actionLabel?: string; onDone?: (status: string) => void }) {
  const stop = async () => {
    if (!sessionId) return
    await fetch(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' })
  }

  if (!sessionId) {
    return (
      <aside style={{ padding: spacing.lg, border: '1px dashed var(--border)', borderRadius: radius.lg, color: 'var(--text-muted)' }}>
        还没有运行中的 Claude 动作。
      </aside>
    )
  }

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <div>
          <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>当前动作</div>
          <h2 style={{ margin: 0, fontSize: fontSize.lg }}>{actionLabel || 'Claude 执行中'}</h2>
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={() => void stop()} style={{ padding: '8px 12px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          停止
        </button>
      </div>
      <LiveLogPanel taskId={sessionId} streamBase="sessions" onDone={onDone} />
    </aside>
  )
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/claude-execution-panel.test.tsx tests/web/live-log-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/components/claude-execution-panel.tsx fanqie-workbench/tests/web/claude-execution-panel.test.tsx
git commit -m "feat: add Claude execution panel"
```

---

# Task 8: 单书写作工作台页面

**Files:**

- Create: `fanqie-workbench/src/web/pages/book-workspace-page.tsx`
- Test: `fanqie-workbench/tests/web/book-workspace-page.test.tsx`

**Goal:** 实现单书工作台第一版：左侧章节列表，中间章节编辑器，右侧 Claude 执行面板。

- [ ] **Step 1: Write failing page tests**

Create `fanqie-workbench/tests/web/book-workspace-page.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookWorkspacePage } from '../../src/web/pages/book-workspace-page.js'

vi.mock('../../src/web/components/chapter-editor.js', () => ({
  ChapterEditor: ({ chapterId }: any) => <div>编辑器:{chapterId}</div>,
}))

vi.mock('../../src/web/components/claude-execution-panel.js', () => ({
  ClaudeExecutionPanel: ({ sessionId, actionLabel, onDone }: any) => (
    <div>
      <div>执行面板:{sessionId || 'empty'}</div>
      <div>{actionLabel}</div>
      <button onClick={() => onDone?.('succeeded')}>完成</button>
    </div>
  ),
}))

describe('BookWorkspacePage', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => ({
        book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book' },
        chapters: [
          { id: 'chapter-1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' },
          { id: 'chapter-2', chapter_number: 2, title: '旧案回声', stage: '已初稿' },
        ],
        summary: { activeSessionId: null, activeChapterId: null },
      }) }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/actions' && init?.method === 'POST') return { ok: true, json: async () => ({ session: { id: 'session-1', kind: 'chapter', status: 'running' } }) }
      throw new Error(`unexpected fetch ${input}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads book and chapters', async () => {
    render(<BookWorkspacePage bookId="book-1" />)
    expect(await screen.findByText('雾港疑局')).toBeTruthy()
    expect(screen.getByText('雾夜失踪')).toBeTruthy()
    expect(screen.getByText('旧案回声')).toBeTruthy()
  })

  it('opens selected chapter in editor', async () => {
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('旧案回声'))
    expect(screen.getByText('编辑器:chapter-2')).toBeTruthy()
  })

  it('starts chapter continue action through /api/actions', async () => {
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('继续写本章'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/actions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ actionKey: 'chapter.continue', bookId: 'book-1', chapterId: 'chapter-1' }),
      }))
      expect(screen.getByText('执行面板:session-1')).toBeTruthy()
    })
  })

  it('refreshes book data when session completes', async () => {
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('继续写本章'))
    fireEvent.click(await screen.findByText('完成'))

    await waitFor(() => {
      const bookFetches = (globalThis as any).fetch.mock.calls.filter(([url]: [string]) => url === '/api/books/book-1')
      expect(bookFetches.length).toBeGreaterThanOrEqual(2)
    })
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/book-workspace-page.test.tsx
```

Expected: FAIL because page does not exist.

- [ ] **Step 3: Implement page**

Create `fanqie-workbench/src/web/pages/book-workspace-page.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { ChapterEditor } from '../components/chapter-editor.js'
import { ClaudeExecutionPanel } from '../components/claude-execution-panel.js'
import { spacing, fontSize, radius } from '../styles/tokens.js'

type ChapterRow = { id: string; chapter_number: number; title: string; stage: string }
type BookDetail = { book: { id: string; title: string; root_path: string }; chapters: ChapterRow[]; summary?: { activeSessionId?: string | null; activeChapterId?: string | null } }

export function BookWorkspacePage({ bookId, onBack }: { bookId: string; onBack?: () => void }) {
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeActionLabel, setActiveActionLabel] = useState<string>('')

  const load = async () => {
    const [bookResponse] = await Promise.all([
      fetch(`/api/books/${bookId}`),
      fetch(`/api/books/${bookId}/sessions`),
      fetch(`/api/books/${bookId}/publications`),
    ])
    const nextDetail = await bookResponse.json()
    setDetail(nextDetail)
    setSelectedChapterId((current) => current || nextDetail.summary?.activeChapterId || nextDetail.chapters?.[0]?.id || null)
    setActiveSessionId(nextDetail.summary?.activeSessionId || null)
  }

  useEffect(() => {
    void load()
  }, [bookId])

  const selectedChapter = detail?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null

  const startAction = async (actionKey: string, label: string) => {
    if (!selectedChapterId) return
    const response = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionKey, bookId, chapterId: selectedChapterId }),
    })
    if (!response.ok) return
    const body = await response.json()
    setActiveSessionId(body.session.id)
    setActiveActionLabel(label)
  }

  if (!detail) return <div>正在加载书籍…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        {onBack && <button onClick={onBack}>返回书库</button>}
        <div>
          <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>{detail.book.title}</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>单书工作台</div>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: spacing.sm, color: 'var(--text-muted)', fontSize: fontSize.sm }}>
        <span>Dashboard</span><span>写作</span><span>Claude 会话</span><span>创作流程</span><span>发布</span><span>资料 / 工具</span>
      </nav>

      <main style={{ display: 'grid', gridTemplateColumns: '220px minmax(420px, 1fr) 360px', gap: spacing.lg, alignItems: 'start' }}>
        <aside style={{ border: '1px solid var(--border)', borderRadius: radius.lg, padding: spacing.md }}>
          <h2 style={{ fontSize: fontSize.md }}>章节</h2>
          {detail.chapters.map((chapter) => (
            <button key={chapter.id} onClick={() => setSelectedChapterId(chapter.id)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: spacing.xs, padding: spacing.sm, borderRadius: radius.md, border: selectedChapterId === chapter.id ? '1px solid var(--accent)' : '1px solid transparent', background: selectedChapterId === chapter.id ? 'var(--accent-subtle)' : 'transparent', color: 'var(--text-primary)' }}>
              <div>{chapter.title}</div>
              <small style={{ color: 'var(--text-muted)' }}>第 {chapter.chapter_number} 章 · {chapter.stage}</small>
            </button>
          ))}
        </aside>

        <section>
          <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
            <button onClick={() => void startAction('chapter.continue', '继续写本章')} disabled={!selectedChapter}>继续写本章</button>
            <button onClick={() => void startAction('chapter.deslop', '去 AI 味本章')} disabled={!selectedChapter}>去 AI 味本章</button>
            <button onClick={() => void startAction('chapter.review', '审稿本章')} disabled={!selectedChapter}>审稿本章</button>
          </div>
          {selectedChapterId && <ChapterEditor key={selectedChapterId} chapterId={selectedChapterId} />}
        </section>

        <ClaudeExecutionPanel sessionId={activeSessionId} actionLabel={activeActionLabel} onDone={() => void load()} />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/book-workspace-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/pages/book-workspace-page.tsx fanqie-workbench/tests/web/book-workspace-page.test.tsx
git commit -m "feat: add book writing workspace"
```

---

# Task 9: 书库页与全局导航增量迁移

**Files:**

- Create: `fanqie-workbench/src/web/pages/library-page.tsx`
- Modify: `fanqie-workbench/src/web/app.tsx`
- Test: `fanqie-workbench/tests/web/app-navigation.test.tsx`
- Existing regression: `fanqie-workbench/tests/web/books-page-session.test.tsx`

**Goal:** 默认入口改为“书库”，加入 v0.2 六项一级导航；旧 `BooksPage` 保持可测试、不删除。

- [ ] **Step 1: Write failing navigation tests**

Create `fanqie-workbench/tests/web/app-navigation.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/web/app.js'

class MockMatchMedia {
  matches = false
  addEventListener() {}
  removeEventListener() {}
}

describe('App navigation', () => {
  beforeEach(() => {
    ;(window as any).matchMedia = () => new MockMatchMedia()
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      if (input === '/api/books/book-1') return { ok: true, json: async () => ({ book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book' }, chapters: [], summary: {} }) }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/market-scans') return { ok: true, json: async () => ({ scans: [] }) }
      return { ok: true, json: async () => ({}) }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows v0.2 navigation and defaults to library', async () => {
    render(<App />)
    expect(await screen.findByText('书库')).toBeTruthy()
    expect(screen.getByText('当前任务')).toBeTruthy()
    expect(screen.getByText('市场情报')).toBeTruthy()
    expect(screen.getByText('资料库')).toBeTruthy()
    expect(screen.getByText('账号发布')).toBeTruthy()
    expect(screen.getByText('设置')).toBeTruthy()
    expect(screen.getByText('新建一本书')).toBeTruthy()
    expect(screen.getByText('扫描 novels/')).toBeTruthy()
  })

  it('opens book workspace from library', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/books/book-1'))
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/app-navigation.test.tsx
```

Expected: FAIL because `LibraryPage` and new nav do not exist.

- [ ] **Step 3: Implement `LibraryPage`**

Create `fanqie-workbench/src/web/pages/library-page.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

type Book = { id: string; title: string; root_path: string; account_id: string | null }

export function LibraryPage({ onOpenBook }: { onOpenBook: (bookId: string) => void }) {
  const [books, setBooks] = useState<Book[]>([])

  const loadBooks = async () => {
    const response = await fetch('/api/books')
    const body = await response.json()
    setBooks(body.books || [])
  }

  useEffect(() => {
    void loadBooks()
  }, [])

  const scanBooks = async () => {
    await fetch('/api/books/scan', { method: 'POST' })
    await loadBooks()
  }

  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        <div>
          <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>书库</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>选择一本书进入单书工作台。</p>
        </div>
        <span style={{ flex: 1 }} />
        <button>新建一本书</button>
        <button onClick={() => void scanBooks()}>扫描 novels/</button>
      </header>
      <div style={{ display: 'grid', gap: spacing.md }}>
        {books.map((book) => (
          <button key={book.id} onClick={() => onOpenBook(book.id)} style={{ textAlign: 'left', padding: spacing.lg, border: '1px solid var(--border)', borderRadius: radius.lg, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            <strong>{book.title}</strong>
            <div style={{ color: 'var(--text-muted)', marginTop: spacing.xs }}>{book.root_path}</div>
          </button>
        ))}
        {books.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无书籍</div>}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Update App navigation**

Modify `fanqie-workbench/src/web/app.tsx`:

1. Import:

```ts
import { LibraryPage } from './pages/library-page.js'
import { BookWorkspacePage } from './pages/book-workspace-page.js'
import { MarketIntelligencePage } from './pages/market-intelligence-page.js'
```

2. Replace page type with:

```ts
type Page = 'library' | 'tasks' | 'market' | 'resources' | 'publishing' | 'settings'
```

3. Use nav labels:

```ts
书库
当前任务
市场情报
资料库
账号发布
设置
```

4. Add state:

```ts
const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
```

5. Default page remains library:

```ts
const [page, setPage] = useState<Page>('library')
```

6. Main content mapping:

```tsx
{page === 'library' && (selectedBookId
  ? <BookWorkspacePage bookId={selectedBookId} onBack={() => setSelectedBookId(null)} />
  : <LibraryPage onOpenBook={setSelectedBookId} />)}
{page === 'tasks' && <div>当前任务</div>}
{page === 'market' && <MarketIntelligencePage />}
{page === 'resources' && <div>资料库</div>}
{page === 'publishing' && <AccountsPage />}
{page === 'settings' && <PromptPage />}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/app-navigation.test.tsx tests/web/books-page-session.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/web/pages/library-page.tsx fanqie-workbench/src/web/app.tsx fanqie-workbench/tests/web/app-navigation.test.tsx
git commit -m "feat: update workbench navigation"
```

---

# Task 10: 市场扫描 runner

**Files:**

- Create: `fanqie-workbench/src/market/market-scan-presets.ts`
- Create: `fanqie-workbench/src/market/market-scan-runner.ts`
- Test: `fanqie-workbench/tests/market/market-scan-runner.test.ts`

**Goal:** 接入 `oh-story-claudecode` 现有扫榜脚本，保存 Markdown 结果。

**Real script paths:**

- `oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js`
- `oh-story-claudecode/skills/story-long-scan/scripts/qidian-rank-scraper.js`
- `oh-story-claudecode/skills/story-short-scan/scripts/dz-browse-scraper.js`
- `oh-story-claudecode/skills/story-short-scan/scripts/heiyan-booklist-scraper.js`

- [ ] **Step 1: Write failing runner tests**

Create `fanqie-workbench/tests/market/market-scan-runner.test.ts`:

```ts
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { getMarketScanPreset } from '../../src/market/market-scan-presets.js'
import { runMarketScan } from '../../src/market/market-scan-runner.js'

function createMockSpawn() {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('# 番茄女频阅读榜\n'))
      child.emit('close', 0)
    })
    return child
  })
}

describe('market scan runner', () => {
  it('maps presets to existing oh-story scripts and args', () => {
    const preset = getMarketScanPreset('fanqie-female-reading')
    expect(preset.scriptPath).toBe('oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js')
    expect(preset.args).toEqual(['--channel', '0', '--type', '2'])
  })

  it('spawns node with script, preset args, and output directory', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'fanqie-market-runner-'))
    const spawn = createMockSpawn()

    const result = await runMarketScan({ preset: 'fanqie-female-reading', workspaceRoot: root, spawn })

    expect(spawn).toHaveBeenCalledWith('node', expect.arrayContaining([
      resolve(root, 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js'),
      '--channel', '0', '--type', '2',
      '--outdir', expect.stringContaining('data/market-scans'),
    ]), expect.any(Object))
    expect(result.status).toBe('succeeded')
    expect(result.outputFiles.length).toBeGreaterThan(0)
    await expect(readdir(result.outputDir)).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/fanqie-female-reading.*\.md/)]))
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/market/market-scan-runner.test.ts
```

Expected: FAIL because market files do not exist.

- [ ] **Step 3: Implement presets**

Create `fanqie-workbench/src/market/market-scan-presets.ts`:

```ts
export type MarketScanPresetKey =
  | 'fanqie-female-reading'
  | 'fanqie-male-reading'
  | 'qidian-signnewbook'
  | 'qidian-hotsales'
  | 'dz-female'
  | 'heiyan-booklist'

export type MarketScanPreset = {
  key: MarketScanPresetKey
  label: string
  scriptPath: string
  args: string[]
}

const presets: Record<MarketScanPresetKey, MarketScanPreset> = {
  'fanqie-female-reading': {
    key: 'fanqie-female-reading',
    label: '番茄女频阅读榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js',
    args: ['--channel', '0', '--type', '2'],
  },
  'fanqie-male-reading': {
    key: 'fanqie-male-reading',
    label: '番茄男频阅读榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js',
    args: ['--channel', '1', '--type', '2'],
  },
  'qidian-signnewbook': {
    key: 'qidian-signnewbook',
    label: '起点签约作者新书榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/qidian-rank-scraper.js',
    args: ['--rank', 'signnewbook'],
  },
  'qidian-hotsales': {
    key: 'qidian-hotsales',
    label: '起点畅销榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/qidian-rank-scraper.js',
    args: ['--rank', 'hotsales'],
  },
  'dz-female': {
    key: 'dz-female',
    label: '点众女频短篇',
    scriptPath: 'oh-story-claudecode/skills/story-short-scan/scripts/dz-browse-scraper.js',
    args: ['--channel', 'female'],
  },
  'heiyan-booklist': {
    key: 'heiyan-booklist',
    label: '黑岩短篇书库',
    scriptPath: 'oh-story-claudecode/skills/story-short-scan/scripts/heiyan-booklist-scraper.js',
    args: [],
  },
}

export function listMarketScanPresets() {
  return Object.values(presets)
}

export function getMarketScanPreset(key: MarketScanPresetKey | string) {
  const preset = presets[key as MarketScanPresetKey]
  if (!preset) throw new Error(`Unknown market scan preset: ${key}`)
  return preset
}
```

- [ ] **Step 4: Implement runner**

Create `fanqie-workbench/src/market/market-scan-runner.ts`:

```ts
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getMarketScanPreset, type MarketScanPresetKey } from './market-scan-presets.js'

type SpawnLike = typeof nodeSpawn

export async function runMarketScan(input: { preset: MarketScanPresetKey | string; workspaceRoot: string; spawn?: SpawnLike }) {
  const preset = getMarketScanPreset(input.preset)
  const spawn = input.spawn ?? nodeSpawn
  const date = new Date().toISOString().slice(0, 10)
  const outputDir = resolve(input.workspaceRoot, 'fanqie-workbench', 'data', 'market-scans', date)
  await mkdir(outputDir, { recursive: true })

  const script = resolve(input.workspaceRoot, preset.scriptPath)
  const args = [script, ...preset.args, '--outdir', outputDir]
  const output = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolvePromise, reject) => {
    const child = spawn('node', args, { cwd: input.workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', (exitCode) => resolvePromise({ stdout, stderr, exitCode }))
  })

  if (output.exitCode !== 0) {
    return { status: 'failed' as const, preset: preset.key, outputDir, outputFiles: [], error: output.stderr || `market scan exited with ${output.exitCode}` }
  }

  const fallbackFile = resolve(outputDir, `${preset.key}-${Date.now()}.md`)
  const existingFiles = await readdir(outputDir).catch(() => [])
  if (!existingFiles.some((file) => file.endsWith('.md')) && output.stdout.trim()) {
    await writeFile(fallbackFile, output.stdout, 'utf8')
  }

  const files = await readdir(outputDir)
  const outputFiles = files.filter((file) => file.endsWith('.md')).map((file) => resolve(outputDir, file))
  return { status: 'succeeded' as const, preset: preset.key, outputDir, outputFiles }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/market/market-scan-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/market/market-scan-presets.ts fanqie-workbench/src/market/market-scan-runner.ts fanqie-workbench/tests/market/market-scan-runner.test.ts
git commit -m "feat: add market scan runner"
```

---

# Task 11: 市场扫描 API 与最小绑定

**Files:**

- Create: `fanqie-workbench/src/server/routes/market-scans.ts`
- Modify: `fanqie-workbench/src/server/app.ts`
- Test: `fanqie-workbench/tests/server/market-scans-route.test.ts`

**Goal:** 提供市场扫描 HTTP API，并支持把一次扫描 Markdown 复制到目标书 `对标/市场扫描/`。

- [ ] **Step 1: Write failing route tests**

Create `fanqie-workbench/tests/server/market-scans-route.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

vi.mock('../../src/market/market-scan-runner.js', () => ({
  runMarketScan: vi.fn(async () => ({
    status: 'succeeded',
    preset: 'fanqie-female-reading',
    outputDir: '/tmp/scans/2026-05-18',
    outputFiles: ['/tmp/scans/2026-05-18/fanqie-female-reading.md'],
  })),
}))

async function createFixture(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), `fanqie-market-api-${name}-`))
  const databasePath = resolve(dir, 'workbench.sqlite')
  const bookRoot = resolve(dir, 'book')
  await mkdir(resolve(bookRoot, '对标', '市场扫描'), { recursive: true })
  const scanDir = resolve(dir, 'fanqie-workbench', 'data', 'market-scans', '2026-05-18')
  await mkdir(scanDir, { recursive: true })
  const scanFile = resolve(scanDir, 'fanqie-female-reading.md')
  await writeFile(scanFile, '# 番茄女频阅读榜\n', 'utf8')

  const db = openDatabase(databasePath)
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', bookRoot)
  db.close()

  process.env.WORKBENCH_DB = databasePath
  process.env.WORKBENCH_ROOT = dir
  return { dir, scanFile, bookRoot }
}

describe('market scans route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    delete process.env.WORKBENCH_ROOT
    vi.clearAllMocks()
  })

  it('runs a market scan preset', async () => {
    await createFixture('post')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({ method: 'POST', url: '/api/market-scans', payload: { preset: 'fanqie-female-reading' } })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.status).toBe('succeeded')
    expect(body.preset).toBe('fanqie-female-reading')
    expect(body.outputFiles).toEqual(expect.arrayContaining(['/tmp/scans/2026-05-18/fanqie-female-reading.md']))

    await app.close()
  })

  it('lists existing markdown scan results', async () => {
    const { dir } = await createFixture('list')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({ method: 'GET', url: '/api/market-scans' })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.scans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringContaining('2026-05-18'), fileName: 'fanqie-female-reading.md' }),
    ]))
    expect(body.scans[0].path).toContain(resolve(dir, 'fanqie-workbench', 'data', 'market-scans'))

    await app.close()
  })

  it('binds a scan markdown file to a book', async () => {
    const { bookRoot } = await createFixture('bind')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/market-scans/2026-05-18%2Ffanqie-female-reading.md/bind-book',
      payload: { bookId: 'book-1' },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.boundPath).toBe(resolve(bookRoot, '对标', '市场扫描', 'fanqie-female-reading.md'))
    await expect(readFile(body.boundPath, 'utf8')).resolves.toContain('番茄女频阅读榜')

    await app.close()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/market-scans-route.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement market scan routes**

Create `fanqie-workbench/src/server/routes/market-scans.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'
import { runMarketScan } from '../../market/market-scan-runner.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

function getWorkspaceRoot() {
  return process.env.WORKBENCH_ROOT || resolve(import.meta.dirname, '..', '..', '..', '..')
}

function getScanRoot() {
  return resolve(getWorkspaceRoot(), 'fanqie-workbench', 'data', 'market-scans')
}

async function listMarkdownScans() {
  const root = getScanRoot()
  const dates = await readdir(root).catch(() => [])
  const scans: Array<{ id: string; date: string; fileName: string; path: string }> = []
  for (const date of dates) {
    const dateDir = resolve(root, date)
    const files = await readdir(dateDir).catch(() => [])
    for (const fileName of files.filter((file) => file.endsWith('.md'))) {
      scans.push({ id: `${date}/${fileName}`, date, fileName, path: resolve(dateDir, fileName) })
    }
  }
  return scans.sort((a, b) => b.id.localeCompare(a.id))
}

export async function registerMarketScanRoutes(app: FastifyInstance) {
  app.post<{ Body: { preset?: string } }>('/api/market-scans', async (request, reply) => {
    if (!request.body?.preset) return reply.code(400).send({ error: 'preset is required' })
    try {
      return await runMarketScan({ preset: request.body.preset, workspaceRoot: getWorkspaceRoot() })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/market-scans', async () => ({ scans: await listMarkdownScans() }))

  app.post<{ Params: { scanId: string }; Body: { bookId?: string } }>('/api/market-scans/:scanId/bind-book', async (request, reply) => {
    const { bookId } = request.body || {}
    if (!bookId) return reply.code(400).send({ error: 'bookId is required' })

    const scans = await listMarkdownScans()
    const scan = scans.find((item) => item.id === decodeURIComponent(request.params.scanId))
    if (!scan) return reply.code(404).send({ error: 'market scan not found' })

    const db = openDatabase(getDatabasePath())
    try {
      const book = db.prepare('SELECT id, root_path FROM books WHERE id = ?').get(bookId) as { id: string; root_path: string } | undefined
      if (!book) return reply.code(404).send({ error: 'book not found' })

      const targetDir = resolve(book.root_path, '对标', '市场扫描')
      await mkdir(targetDir, { recursive: true })
      const boundPath = resolve(targetDir, basename(scan.path))
      await copyFile(scan.path, boundPath)
      return { bound: true, boundPath }
    } finally {
      db.close()
    }
  })
}
```

- [ ] **Step 4: Register route**

Modify `fanqie-workbench/src/server/app.ts`:

```ts
import { registerMarketScanRoutes } from './routes/market-scans.js'
```

Add:

```ts
await registerMarketScanRoutes(app)
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/market-scans-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/server/routes/market-scans.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/server/market-scans-route.test.ts
git commit -m "feat: add market scan API"
```

---

# Task 12: 市场情报页面

**Files:**

- Create: `fanqie-workbench/src/web/pages/market-intelligence-page.tsx`
- Test: `fanqie-workbench/tests/web/market-intelligence-page.test.tsx`
- Modify: `fanqie-workbench/src/web/app.tsx` if Task 9 did not already connect the page

**Goal:** 实现市场情报页面骨架：扫榜 preset、最近结果、绑定到书入口、趋势占位。

- [ ] **Step 1: Write failing page tests**

Create `fanqie-workbench/tests/web/market-intelligence-page.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarketIntelligencePage } from '../../src/web/pages/market-intelligence-page.js'

describe('MarketIntelligencePage', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/market-scans' && !init) return { ok: true, json: async () => ({ scans: [{ id: '2026-05-18/fanqie-female-reading.md', fileName: 'fanqie-female-reading.md', date: '2026-05-18' }] }) }
      if (input === '/api/market-scans' && init?.method === 'POST') return { ok: true, json: async () => ({ status: 'succeeded', preset: 'fanqie-female-reading', outputFiles: ['/tmp/fanqie.md'] }) }
      return { ok: true, json: async () => ({}) }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows scan presets', async () => {
    render(<MarketIntelligencePage />)
    expect(await screen.findByText('番茄女频阅读榜')).toBeTruthy()
    expect(screen.getByText('番茄男频阅读榜')).toBeTruthy()
    expect(screen.getByText('起点签约作者新书榜')).toBeTruthy()
    expect(screen.getByText('起点畅销榜')).toBeTruthy()
    expect(screen.getByText('点众女频短篇')).toBeTruthy()
    expect(screen.getByText('黑岩短篇书库')).toBeTruthy()
  })

  it('runs a preset scan', async () => {
    render(<MarketIntelligencePage />)
    fireEvent.click(await screen.findByText('番茄女频阅读榜'))
    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/market-scans', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ preset: 'fanqie-female-reading' }),
      }))
    })
  })

  it('shows recent scan results and bind button', async () => {
    render(<MarketIntelligencePage />)
    expect(await screen.findByText('fanqie-female-reading.md')).toBeTruthy()
    expect(screen.getByText('绑定到书')).toBeTruthy()
    expect(screen.getByText('趋势分析')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/market-intelligence-page.test.tsx
```

Expected: FAIL because page does not exist.

- [ ] **Step 3: Implement page**

Create `fanqie-workbench/src/web/pages/market-intelligence-page.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

const presets = [
  { key: 'fanqie-female-reading', label: '番茄女频阅读榜' },
  { key: 'fanqie-male-reading', label: '番茄男频阅读榜' },
  { key: 'qidian-signnewbook', label: '起点签约作者新书榜' },
  { key: 'qidian-hotsales', label: '起点畅销榜' },
  { key: 'dz-female', label: '点众女频短篇' },
  { key: 'heiyan-booklist', label: '黑岩短篇书库' },
]

type Scan = { id: string; date: string; fileName: string; path?: string }

export function MarketIntelligencePage() {
  const [scans, setScans] = useState<Scan[]>([])
  const [running, setRunning] = useState<string | null>(null)

  const loadScans = async () => {
    const response = await fetch('/api/market-scans')
    const body = await response.json()
    setScans(body.scans || [])
  }

  useEffect(() => {
    void loadScans()
  }, [])

  const runPreset = async (preset: string) => {
    setRunning(preset)
    try {
      await fetch('/api/market-scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      })
      await loadScans()
    } finally {
      setRunning(null)
    }
  }

  return (
    <section style={{ display: 'grid', gap: spacing.lg }}>
      <header>
        <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>市场情报</h1>
        <p style={{ color: 'var(--text-muted)' }}>第一阶段先接入手动扫榜和 Markdown 结果绑定。</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing.md }}>
        {presets.map((preset) => (
          <button key={preset.key} onClick={() => void runPreset(preset.key)} disabled={running === preset.key} style={{ padding: spacing.lg, borderRadius: radius.lg, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            {running === preset.key ? '扫描中…' : preset.label}
          </button>
        ))}
      </div>

      <section style={{ border: '1px solid var(--border)', borderRadius: radius.lg, padding: spacing.lg }}>
        <h2 style={{ marginTop: 0 }}>最近扫描结果</h2>
        {scans.map((scan) => (
          <div key={scan.id} style={{ display: 'flex', alignItems: 'center', gap: spacing.md, padding: `${spacing.sm}px 0`, borderTop: '1px solid var(--border)' }}>
            <span>{scan.fileName}</span>
            <span style={{ color: 'var(--text-muted)' }}>{scan.date}</span>
            <span style={{ flex: 1 }} />
            <button>绑定到书</button>
          </div>
        ))}
        {scans.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无扫描结果</div>}
      </section>

      <section style={{ border: '1px dashed var(--border)', borderRadius: radius.lg, padding: spacing.lg, color: 'var(--text-muted)' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>趋势分析</h2>
        第一阶段展示扫描结果列表；趋势图表进入第二阶段。
      </section>
    </section>
  )
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/market-intelligence-page.test.tsx tests/web/app-navigation.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/pages/market-intelligence-page.tsx fanqie-workbench/tests/web/market-intelligence-page.test.tsx fanqie-workbench/src/web/app.tsx
git commit -m "feat: add market intelligence page"
```

---

# Task 13: 回归验证与手动 UI 验证

**Files:**

- Modify: only files changed by previous tasks if regressions appear
- Test: existing and new test suite

**Goal:** 确认第一阶段没有破坏开书、旧 BooksPage、章节动作、发布底座和 session streaming。

- [ ] **Step 1: Run focused server tests**

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-content-route.test.ts tests/server/action-route.test.ts tests/server/market-scans-route.test.ts tests/server/session-answer-runtime.test.ts tests/server/book-creation-session.test.ts tests/server/chapter-action-session.test.ts tests/server/session-chapter-execution.test.ts tests/server/books-route.test.ts tests/server/book-session-route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

```bash
cd fanqie-workbench && npm test -- tests/web/chapter-editor.test.tsx tests/web/claude-execution-panel.test.tsx tests/web/book-workspace-page.test.tsx tests/web/market-intelligence-page.test.tsx tests/web/app-navigation.test.tsx tests/web/live-log-panel.test.tsx tests/web/books-page-session.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused action/market/claude tests**

```bash
cd fanqie-workbench && npm test -- tests/actions/action-registry.test.ts tests/market/market-scan-runner.test.ts tests/claude/terminal-capture-loop.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
cd fanqie-workbench && npm test
```

Expected: PASS.

- [ ] **Step 5: Fix regressions introduced by this phase only**

If tests fail, fix only files touched by this phase unless the failure proves a pre-existing broken test fixture. Do not do unrelated UI redesign, schema migration, or cleanup.

- [ ] **Step 6: Start development server**

```bash
cd fanqie-workbench && npm run dev:all
```

Expected: Fastify starts on `127.0.0.1:4310` and Vite starts on `127.0.0.1:5173`.

- [ ] **Step 7: Browser manual validation**

Use the browser and verify this path:

```text
书库
→ 看到已有书
→ 点击一本书进入单书工作台
→ 点击章节
→ 编辑正文
→ 保存
→ 点击继续写本章
→ 右侧执行面板出现 session 日志
→ 如果 Claude 提问，输入回答
→ session 完成后章节区域刷新
→ 打开市场情报
→ 点击“番茄女频阅读榜”
→ 看到最近扫描结果
→ 使用 API 或页面入口绑定到书
→ 目标书目录出现 对标/市场扫描/*.md
```

- [ ] **Step 8: Final status check**

```bash
git status --short
```

Expected: only intended phase1 files changed.

- [ ] **Step 9: Final commit if there are regression fixes**

```bash
git add <phase1 files changed during regression fixes>
git commit -m "fix: stabilize Xiaofanqie workspace phase 1"
```

---

## 执行顺序建议

严格按任务顺序执行：

1. 章节正文读写 API 与保存冲突保护
2. 共享 terminal capture loop
3. Action Registry 与旧 key 兼容层
4. 普通章节 answer 回传 tmux runtime
5. `/api/actions` 产品动作入口
6. 章节编辑器组件
7. Claude 执行面板组件
8. 单书写作工作台页面
9. 书库页与全局导航增量迁移
10. 市场扫描 runner
11. 市场扫描 API 与最小绑定
12. 市场情报页面
13. 回归验证与手动 UI 验证

原因：

- Task 1-5 先建立后端闭环和兼容层。
- Task 6-9 建立新写作 UI，但不破坏旧 `BooksPage`。
- Task 10-12 接市场情报最小能力。
- Task 13 做回归和浏览器验证。

---

## 自查

Spec 第一阶段覆盖情况：

- 书库：Task 9
- 单书工作台：Task 8
- 写作三栏：Task 6, 7, 8
- 章节编辑器：Task 1, 6
- 章节内容读写 API：Task 1
- 保存时避免覆盖运行中 Claude 写入：Task 1
- 长运行 Claude runtime：Task 2
- 右侧执行面板：Task 7
- Action Registry：Task 3, 5
- 旧 session 行为兼容：Task 3, 4, 9, 13
- 用户回答回传同一书级会话：Task 4
- 生成后刷新编辑器：Task 8
- 用户保存修改：Task 1, 6
- 市场情报页面骨架：Task 12
- 扫榜脚本最小 runner：Task 10, 11
- 市场结果最小绑定到书：Task 11, 12
- 回归验证：Task 13

主要风险控制：

- 不删除 `BooksPage`，只新增 `LibraryPage` 和 `BookWorkspacePage`。
- 不删除 `/api/sessions`，只新增 `/api/actions`。
- `book-entry` answer 分支优先保留。
- 共享 capture loop 前后都跑 `book-creation-session` 和 `chapter-action-session` 回归。
- 市场绑定只做 Markdown 文件复制，不新增市场数据库表。

---

## 执行选项

Plan revised and saved to `docs/superpowers/plans/2026-05-18-xiaofanqie-web-shape-v02-phase1.md`. Two execution options:

1. **Subagent-Driven（推荐）**  
   每个任务派一个 fresh subagent，实现后主线程 review，适合这类多任务、多回归的计划。

2. **Inline Execution**  
   在当前会话中使用 `superpowers:executing-plans`，按计划分批执行并设置检查点。

请选择执行方式。
