# 开书 (book.create) 想法≠书名 + 书名确认 + 延迟建目录 + 封面按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 开书 take a free-form 想法 (creative brief), have the agent propose & user-confirm a 书名 during clarify-direction, defer `novels/{书名}/` directory creation + DB backfill until the title is locked, and add a 生成封面 button per book in the library.

**Architecture:** The `/api/agent-sessions/book-create` route inserts a placeholder books row (`root_path = 'pending:{bookId}'`) and hands the agent runner an `onBookNamed` callback plus the raw `idea`. `clarify-direction` no longer writes files; it asks a 5th `ask_user` question proposing 3 candidate titles and returns `{ directionLocked, directionSummary, bookTitle }`. After any phase emits `bookTitle`, the runner invokes `onBookNamed`, which mkdir's the real directory, backfills the row (de-duping with `（2）`/`（3）` suffixes), and mutates `bookMeta.title`/`bookMeta.rootPath` in place so later phases (`scaffold-book`) and tools land in the real path. The 封面 button calls a minimal stub endpoint (no reusable skill-trigger entry exists in this backend yet).

**Tech Stack:** Fastify 5, better-sqlite3, React 19, vitest, TypeScript ESM (.js import suffixes)

---

## Investigation findings (cover endpoint)

- The cover skill source lives **outside** this backend at workspace root `oh-story-claudecode/` (skill `story-cover`). It is a Claude-skill channel (GPT-Image-2), **not** an agentic-loop tool.
- The agentic backend (`fanqie-workbench/src/server/routes/`) has **no** existing cover route, no generic skill-trigger HTTP entry, and no `cover`/`封面` reference in `src/`. The only skill-adjacent route is `story-setup` (see `tests/server/story-setup-route.test.ts`).
- **Conclusion (matches spec section E):** there is no reusable skill-trigger backend entry to wire the button to. Per the spec, we ship the **minimal closure**: a new `POST /api/books/:bookId/cover` stub endpoint that validates the book has a real (non-`pending:`) root_path and returns `202 { status: 'queued' }` (placeholder; actual story-cover wiring is deferred and explicitly does not block A–D). The library button calls this endpoint. This is called out as a known stub in Task 6.
- **Books route shape (verified):** the books route export is `registerBookRoutes(app)` (singular "Book", takes only `app`). It does NOT receive a `deps.db`; each handler opens its own connection via `openDatabase(getDatabasePath())` where `getDatabasePath()` reads `process.env.WORKBENCH_DB || 'data/workbench.sqlite'`. Tests (`tests/server/books-route.test.ts`) set `process.env.WORKBENCH_DB = testDbPath`, seed the schema into that file with `new Database(testDbPath); db.exec(schemaSql)`, then call `registerBookRoutes(app)`. Task 6 follows this exact pattern (NOT the `{ db }` deps pattern used by `registerAgentSessionsRoutes`).

---

## File Structure

| File | Action | Task |
|---|---|---|
| `fanqie-workbench/src/agentic/phases/phase.ts` | Modify — add `idea?: string` to `BookMeta` | 1 |
| `fanqie-workbench/src/agentic/agent-runner.ts` | Modify — add `onBookNamed?` to `AgentRunnerOptions`; call it after onComplete merge | 2 |
| `fanqie-workbench/src/agentic/agent-runner-pool.ts` | Modify — thread `onBookNamed` through `PoolStartInput` → `createAgentRunner` | 2 |
| `fanqie-workbench/src/agentic/agent-service.ts` | Modify — add `onBookNamed?` to `AgentStartInput`; forward to pool | 2 |
| `fanqie-workbench/src/agentic/phases/clarify-direction.ts` | Modify — drop `write_file`; add 5th title question; return `bookTitle` | 3 |
| `fanqie-workbench/src/agentic/phases/scaffold-book.ts` | Modify — also write `设定/方向.md` from `directionSummary` | 4 |
| `fanqie-workbench/src/server/routes/agent-sessions.ts` | Modify — `book-create` body `{ idea }`, placeholder row, `onBookNamed` impl, cleanup on failed/cancelled | 5 |
| `fanqie-workbench/src/server/routes/books.ts` | Modify — add `POST /api/books/:bookId/cover` stub inside `registerBookRoutes` | 6 |
| `fanqie-workbench/src/web/components/book-creation-modal.tsx` | Modify — send `{ idea }`; running-title no longer reuses idea | 7 |
| `fanqie-workbench/src/web/pages/library-page.tsx` | Modify — add 生成封面 button per card | 8 |
| `fanqie-workbench/tests/agentic/agent-runner.test.ts` | Modify — add `onBookNamed` cases | 2 |
| `fanqie-workbench/tests/agentic/phases/clarify-direction.test.ts` | Modify — title question + no write_file | 3 |
| `fanqie-workbench/tests/agentic/phases/scaffold-book.test.ts` | Modify — writes 设定/方向.md | 4 |
| `fanqie-workbench/tests/server/book-create-route.test.ts` | Modify — `{ idea }`, placeholder, onBookNamed, cleanup | 5 |
| `fanqie-workbench/tests/server/books-cover-route.test.ts` | Create — cover stub endpoint | 6 |
| `fanqie-workbench/tests/web/book-creation-modal.test.tsx` | Create — modal sends `{ idea }`, title not reused | 7 |
| `fanqie-workbench/tests/web/library-page.test.tsx` | Modify — 生成封面 button renders + triggers request; fix existing `{ title }` expectation to `{ idea }` | 7, 8 |

**Canonical types (must be identical everywhere they appear):**

```typescript
// phase.ts
export interface BookMeta {
  id: string
  title: string
  rootPath: string
  idea?: string
}

// agent-runner.ts (AgentRunnerOptions), agent-runner-pool.ts (PoolStartInput),
// agent-service.ts (AgentStartInput) — same optional field, same signature:
onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
```

---

## Task 1 — Add `idea?` to BookMeta

**Files:**
- Modify: `fanqie-workbench/src/agentic/phases/phase.ts`
- Test: covered indirectly; this is a pure type-widening change, exercised by Task 3 & Task 5 tests. No standalone test file (YAGNI — a type-only optional field has no runtime behavior to assert in isolation).

Steps:
- [ ] Apply the minimal implementation — add `idea?: string` to `BookMeta`:

```typescript
import type { ChatResult } from '../providers/provider.js'

export interface BookMeta {
  id: string
  title: string
  rootPath: string
  /** Raw 开书想法 (creative brief). Only set for book.create; used by clarify-direction to propose candidate titles. */
  idea?: string
}

export interface ChapterMeta {
  id: string
  chapterNumber: number
  title: string
  sourcePath: string
  stage: string
}

export interface PhaseContext {
  bookId: string
  bookRoot: string
  chapterId: string | null
  bookMeta: BookMeta
  chapter: ChapterMeta | null
  previousPhaseResults: Record<string, unknown>
}

export interface Phase {
  name: string
  tools: string[]
  maxIterations: number
  systemPrompt(ctx: PhaseContext): string
  initialUserMessage(ctx: PhaseContext): string
  onComplete?(ctx: PhaseContext, result: ChatResult): Promise<Record<string, unknown> | void>
}
```

- [ ] Typecheck compiles (no test yet — verified by Task 3 build):

```
cd fanqie-workbench && npx tsc --noEmit
```
Expected: exits 0 (no errors).

- [ ] Commit:

```
git add fanqie-workbench/src/agentic/phases/phase.ts
git commit -m "feat(agentic): add optional idea field to BookMeta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Runner threads `onBookNamed` and calls it after a phase emits `bookTitle`

**Files:**
- Modify: `fanqie-workbench/src/agentic/agent-runner.ts`
- Modify: `fanqie-workbench/src/agentic/agent-runner-pool.ts`
- Modify: `fanqie-workbench/src/agentic/agent-service.ts`
- Test: `fanqie-workbench/tests/agentic/agent-runner.test.ts`

Steps:

- [ ] Write the failing test. Append these two cases to `tests/agentic/agent-runner.test.ts`. They use a fake provider that returns no tool calls (so each phase ends immediately) and two fake phases — the first returns `bookTitle` via `onComplete`, the second asserts the ctx it receives. Match the existing FakeProvider/EventEmitter style already in that file.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import type { AgentRunnerOptions } from '../../src/agentic/agent-runner.js'
import type { Phase } from '../../src/agentic/phases/phase.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'

// A provider that always returns a plain assistant message with no tool calls,
// so every phase completes after a single iteration.
function noToolProvider(content = 'ok'): LlmProvider {
  return {
    async chat({ onDelta }) {
      onDelta?.(content)
      return { content, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 } }
    },
  } as unknown as LlmProvider
}

const fakeToolRegistry = {
  listFiltered: () => [],
  execute: async () => ({ ok: true, result: '' }),
} as any

const fakeTraceStore = {
  createTrace: () => 1,
  appendEvent: () => {},
  addUsage: () => {},
  endTrace: () => {},
} as any

function baseOpts(overrides: Partial<AgentRunnerOptions>): AgentRunnerOptions {
  return {
    bookId: 'book-1',
    chapterId: null,
    bookMeta: { id: 'book-1', title: '占位', rootPath: 'pending:book-1' },
    chapter: null,
    phases: [],
    actionKey: 'book.create',
    provider: noToolProvider(),
    toolRegistry: fakeToolRegistry,
    traceStore: fakeTraceStore,
    sessionId: 'sess-1',
    model: 'test-model',
    emitter: new EventEmitter(),
    ...overrides,
  }
}

describe('agent-runner onBookNamed', () => {
  it('calls onBookNamed when a phase emits bookTitle and routes later phases to the new path', async () => {
    const seenRoots: string[] = []
    const namingPhase: Phase = {
      name: 'naming',
      tools: [],
      maxIterations: 1,
      systemPrompt: () => 'sys',
      initialUserMessage: () => 'go',
      async onComplete() {
        return { directionLocked: true, directionSummary: 'dir', bookTitle: '雾港疑局' }
      },
    }
    const laterPhase: Phase = {
      name: 'later',
      tools: [],
      maxIterations: 1,
      systemPrompt: (ctx) => {
        seenRoots.push(ctx.bookRoot)
        return 'sys'
      },
      initialUserMessage: () => 'go',
    }

    const onBookNamed = vi.fn(async (title: string) => ({
      title,
      rootPath: `/novels/${title}`,
    }))

    const opts = baseOpts({ phases: [namingPhase, laterPhase], onBookNamed })
    const runner = createAgentRunner(opts)
    await runner.start()

    expect(onBookNamed).toHaveBeenCalledTimes(1)
    expect(onBookNamed).toHaveBeenCalledWith('雾港疑局')
    expect(opts.bookMeta.title).toBe('雾港疑局')
    expect(opts.bookMeta.rootPath).toBe('/novels/雾港疑局')
    // later phase must have seen the new path, not the pending placeholder
    expect(seenRoots).toEqual(['/novels/雾港疑局'])
    expect(runner.status).toBe('succeeded')
  })

  it('does not call onBookNamed when no phase emits bookTitle (chapter.continue stays unchanged)', async () => {
    const plainPhase: Phase = {
      name: 'plain',
      tools: [],
      maxIterations: 1,
      systemPrompt: () => 'sys',
      initialUserMessage: () => 'go',
      async onComplete() {
        return { somethingElse: true }
      },
    }
    const onBookNamed = vi.fn(async (title: string) => ({ title, rootPath: '/x' }))
    const opts = baseOpts({
      actionKey: 'chapter.continue',
      phases: [plainPhase],
      onBookNamed,
    })
    const runner = createAgentRunner(opts)
    await runner.start()

    expect(onBookNamed).not.toHaveBeenCalled()
    expect(opts.bookMeta.rootPath).toBe('pending:book-1')
    expect(runner.status).toBe('succeeded')
  })

  it('works when onBookNamed is absent and a phase emits bookTitle (no crash)', async () => {
    const namingPhase: Phase = {
      name: 'naming',
      tools: [],
      maxIterations: 1,
      systemPrompt: () => 'sys',
      initialUserMessage: () => 'go',
      async onComplete() {
        return { bookTitle: '某书' }
      },
    }
    const opts = baseOpts({ phases: [namingPhase] }) // no onBookNamed
    const runner = createAgentRunner(opts)
    await runner.start()
    expect(runner.status).toBe('succeeded')
  })
})
```

- [ ] Run it (expected FAIL — `onBookNamed` is not yet on `AgentRunnerOptions`, so TS-compile/runtime fails and `onBookNamed` is never called):

```
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```
Expected: FAIL (new `onBookNamed` describe block fails; existing cases still pass).

- [ ] Implement in `agent-runner.ts` — add the field to `AgentRunnerOptions` and the call after the onComplete merge:

Add to the `AgentRunnerOptions` interface (after `onAskUserPending?`):

```typescript
  onAskUserPending?: (pending: boolean) => void
  /** Only set for book.create. Called after a phase produces `bookTitle`; backfills directory + DB and returns the final title/rootPath. */
  onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
```

Replace the existing onComplete merge block:

```typescript
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) Object.assign(previousPhaseResults, update)
          }
          emit({ type: 'phase-done', phase: phase.name })
```

with:

```typescript
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) {
              Object.assign(previousPhaseResults, update)
              const namedTitle = (update as { bookTitle?: unknown }).bookTitle
              if (typeof namedTitle === 'string' && namedTitle && opts.onBookNamed) {
                const { title, rootPath } = await opts.onBookNamed(namedTitle)
                opts.bookMeta.title = title
                opts.bookMeta.rootPath = rootPath
              }
            }
          }
          emit({ type: 'phase-done', phase: phase.name })
```

- [ ] Implement in `agent-runner-pool.ts` — add `onBookNamed?` to `PoolStartInput` and forward it:

Add to `PoolStartInput` (after `emitter: EventEmitter`):

```typescript
  emitter: EventEmitter
  onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
```

In `start()`, add the field to the `createAgentRunner({ ... })` call (after `emitter: input.emitter,`):

```typescript
        emitter: input.emitter,
        onBookNamed: input.onBookNamed,
```

- [ ] Implement in `agent-service.ts` — add `onBookNamed?` to `AgentStartInput` and forward in `start()`:

Add to `AgentStartInput` (after `emitter: EventEmitter`):

```typescript
  emitter: EventEmitter
  onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
```

In `start(input)`, add to the `pool.start({ ... })` call (after `emitter: input.emitter,`):

```typescript
        emitter: input.emitter,
        onBookNamed: input.onBookNamed,
```

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```
Expected: PASS (all cases including the 3 new ones).

- [ ] Run the pool + service tests to confirm no regression:

```
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner-pool.test.ts tests/agentic/agent-service.test.ts
```
Expected: PASS.

- [ ] Commit:

```
git add fanqie-workbench/src/agentic/agent-runner.ts fanqie-workbench/src/agentic/agent-runner-pool.ts fanqie-workbench/src/agentic/agent-service.ts fanqie-workbench/tests/agentic/agent-runner.test.ts
git commit -m "feat(agentic): thread onBookNamed callback through runner/pool/service

Runner invokes onBookNamed after a phase emits bookTitle, then mutates
bookMeta.title/rootPath in place so later phases use the real path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — clarify-direction: drop write_file, add 5th title question, return bookTitle

**Files:**
- Modify: `fanqie-workbench/src/agentic/phases/clarify-direction.ts`
- Test: `fanqie-workbench/tests/agentic/phases/clarify-direction.test.ts`

Steps:

- [ ] Write the failing test. Replace the contents of `tests/agentic/phases/clarify-direction.test.ts` with the following (asserts: `write_file` is NOT in tools, `ask_user` IS; systemPrompt mentions the idea + a 5th 书名 step; onComplete returns `bookTitle` parsed from the agent's final content).

```typescript
import { describe, it, expect } from 'vitest'
import { clarifyDirectionPhase } from '../../../src/agentic/phases/clarify-direction.js'
import type { PhaseContext } from '../../../src/agentic/phases/phase.js'
import type { ChatResult } from '../../../src/agentic/providers/provider.js'

function ctx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'book-1',
    bookRoot: 'pending:book-1',
    chapterId: null,
    bookMeta: { id: 'book-1', title: '占位', rootPath: 'pending:book-1', idea: '女频豪门追妻火葬场，带悬疑线' },
    chapter: null,
    previousPhaseResults: {},
    ...overrides,
  }
}

describe('clarifyDirectionPhase', () => {
  it('uses ask_user and does NOT use write_file', () => {
    expect(clarifyDirectionPhase.tools).toContain('ask_user')
    expect(clarifyDirectionPhase.tools).not.toContain('write_file')
  })

  it('system prompt references the idea and a 5th 书名 confirmation step', () => {
    const prompt = clarifyDirectionPhase.systemPrompt(ctx())
    expect(prompt).toContain('女频豪门追妻火葬场，带悬疑线') // idea passed through
    expect(prompt).toContain('书名')
    expect(prompt).toMatch(/3\s*个候选书名|3 个候选/)
    expect(prompt).not.toContain('write_file')
    expect(prompt).not.toContain('设定/方向.md') // clarify no longer writes files
  })

  it('onComplete returns directionLocked, directionSummary and bookTitle parsed from final content', async () => {
    const result = {
      content: '方向已锁定。\nBOOK_TITLE: 雾港疑局',
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1 },
    } as ChatResult
    const update = await clarifyDirectionPhase.onComplete!(ctx(), result)
    expect(update).toMatchObject({
      directionLocked: true,
      bookTitle: '雾港疑局',
    })
    expect((update as Record<string, unknown>).directionSummary).toContain('方向已锁定')
  })

  it('onComplete falls back to a trimmed title when no BOOK_TITLE marker present', async () => {
    const result = {
      content: '随便一句没有标记的话',
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1 },
    } as ChatResult
    const update = await clarifyDirectionPhase.onComplete!(ctx(), result)
    // must still produce a non-empty bookTitle so the runner can name the book
    expect(typeof (update as Record<string, unknown>).bookTitle).toBe('string')
    expect((update as Record<string, unknown>).bookTitle).toBeTruthy()
  })
})
```

- [ ] Run it (expected FAIL — current phase still lists `write_file`, prompt lacks the 5th step and idea, onComplete has no `bookTitle`):

```
cd fanqie-workbench && npx vitest run tests/agentic/phases/clarify-direction.test.ts
```
Expected: FAIL.

- [ ] Implement — replace the full contents of `src/agentic/phases/clarify-direction.ts`:

```typescript
import type { Phase } from './phase.js'

/** Parse the confirmed title out of the agent's final message.
 * The agent is instructed to end with a `BOOK_TITLE: <书名>` line after the
 * user picks one of the candidate titles. Falls back to the first non-empty
 * line so the runner always gets a usable name. */
function parseBookTitle(content: string): string {
  const marker = content.match(/BOOK_TITLE:\s*(.+)/i)
  if (marker) {
    return marker[1].trim().replace(/[《》]/g, '').trim()
  }
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return (firstLine ?? '新书').replace(/[《》]/g, '').slice(0, 40).trim() || '新书'
}

export const clarifyDirectionPhase: Phase = {
  name: 'clarify-direction',
  tools: ['ask_user'],
  maxIterations: 14,
  systemPrompt(ctx) {
    const idea = ctx.bookMeta.idea ?? '（未提供，向用户确认）'
    return [
      `你正在帮用户开新书。用户的开书想法（创作 brief）是：「${idea}」`,
      `注意：开书想法不是书名，只是方向参考。不要把它当书名。`,
      ``,
      `职责：依次用 ask_user 工具问 5 个问题，锁定写作方向并确认书名。本阶段不写任何文件。`,
      ``,
      `必问 5 个：`,
      `1. 题材 / 核心梗（豪门追妻、重生复仇、系统流、剑修、悬疑等）`,
      `2. 主投平台（番茄 / 起点 / 七猫 / 晋江 / 知乎短篇）`,
      `3. 篇幅与节奏（短篇 30 章 / 中篇 100-200 章 / 长篇 300+ 章）`,
      `4. 开篇钩子方向 + 主角设定大方向（穿越 / 重生 / 现代 / 古代 + 男频/女频 + 主角性别）`,
      `5. 书名确认：基于「开书想法 + 上面问到的题材/平台/篇幅」，用 ask_user 给出 3 个候选书名 + "其它(自定义)"，让用户选定最终书名。`,
      ``,
      `前 4 个问题，每个用 ask_user 给 3-5 个常见选项 + "其它(自定义)"。`,
      ``,
      `5 个都问完后，输出两部分：`,
      `- 一段方向汇总（Markdown，包含 题材/平台/篇幅/钩子 4 个小节），供后续阶段落盘；`,
      `- 最后单独一行：\`BOOK_TITLE: <用户选定的书名>\`（不带书名号）。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const idea = ctx.bookMeta.idea ?? ''
    return `请开始向用户提问，确定写作方向并确认书名。开书想法：「${idea}」。`
  },
  async onComplete(_ctx, result) {
    return {
      directionLocked: true,
      directionSummary: result.content,
      bookTitle: parseBookTitle(result.content),
    }
  },
}
```

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/agentic/phases/clarify-direction.test.ts
```
Expected: PASS.

- [ ] Commit:

```
git add fanqie-workbench/src/agentic/phases/clarify-direction.ts fanqie-workbench/tests/agentic/phases/clarify-direction.test.ts
git commit -m "feat(agentic): clarify-direction asks for book title, drops write_file

Removes the write_file tool (no directory exists yet), adds a 5th ask_user
step proposing 3 candidate titles from idea+题材/平台/篇幅, and returns
bookTitle/directionSummary via onComplete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — scaffold-book writes 设定/方向.md from directionSummary

**Files:**
- Modify: `fanqie-workbench/src/agentic/phases/scaffold-book.ts`
- Test: `fanqie-workbench/tests/agentic/phases/scaffold-book.test.ts`

Steps:

- [ ] Write the failing test. Append a case to `tests/agentic/phases/scaffold-book.test.ts` asserting the systemPrompt now instructs writing `设定/方向.md` first and embeds the `directionSummary` from `previousPhaseResults` (so the agent can reproduce it). Match the existing file's `ctx` helper style.

```typescript
import { describe, it, expect } from 'vitest'
import { scaffoldBookPhase } from '../../../src/agentic/phases/scaffold-book.js'
import type { PhaseContext } from '../../../src/agentic/phases/phase.js'

function ctx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'book-1',
    bookRoot: '/novels/雾港疑局',
    chapterId: null,
    bookMeta: { id: 'book-1', title: '雾港疑局', rootPath: '/novels/雾港疑局' },
    chapter: null,
    previousPhaseResults: { directionSummary: '## 题材\n现代悬疑\n## 平台\n番茄' },
    ...overrides,
  }
}

describe('scaffoldBookPhase writes 设定/方向.md', () => {
  it('system prompt instructs writing 设定/方向.md from the direction summary', () => {
    const prompt = scaffoldBookPhase.systemPrompt(ctx())
    expect(prompt).toContain('设定/方向.md')
    // the direction summary must be embedded so the agent can reproduce it
    expect(prompt).toContain('现代悬疑')
    expect(scaffoldBookPhase.tools).toContain('write_file')
  })
})
```

> Note: if the existing test file already imports/declares `ctx` or `describe` blocks, ADD only the new `describe` block (and reuse the file's existing helpers) rather than re-declaring imports. The snippet above is the standalone shape; deduplicate against existing content.

- [ ] Run it (expected FAIL — current prompt does not mention `设定/方向.md` and does not embed the summary):

```
cd fanqie-workbench && npx vitest run tests/agentic/phases/scaffold-book.test.ts
```
Expected: FAIL.

- [ ] Implement — replace the full contents of `src/agentic/phases/scaffold-book.ts`:

```typescript
import type { Phase } from './phase.js'

export const scaffoldBookPhase: Phase = {
  name: 'scaffold-book',
  tools: ['read_file', 'write_file'],
  maxIterations: 18,
  systemPrompt(ctx) {
    const summary = String(ctx.previousPhaseResults.directionSummary ?? '（方向汇总缺失，按常识填写）')
    return [
      `你正在为《${ctx.bookMeta.title}》搭建初始项目结构。bookRoot = ${ctx.bookRoot}`,
      ``,
      `先用 write_file 写 设定/方向.md，内容就是下面这段方向汇总（原样落盘，可补全小标题）：`,
      `---`,
      summary,
      `---`,
      ``,
      `然后依次用 write_file 写以下 9 个文件：`,
      ``,
      `1. 大纲/总纲.md     — 3-5 卷大纲，每卷一段 200 字左右`,
      `2. 设定/世界观.md   — 时代背景、地理、势力、规则（200-400 字）`,
      `3. 设定/角色/主角.md — 主角档案（姓名、年龄、背景、动机、性格、外貌、关键经历），约 300 字`,
      `4. 设定/角色/反派.md — 反派档案（同上），约 200 字`,
      `5. 追踪/上下文.md   — 写：本书开始（无任何已发生剧情）`,
      `6. 追踪/伏笔.md     — 写：伏笔追踪表（空列）`,
      `7. 追踪/时间线.md   — 写：时间线追踪表（空列）`,
      `8. 大纲/细纲_第001章.md — 第一章细纲：场景设定、出场人物、关键事件、信息揭示、章末钩子，约 300-500 字`,
      `9. 正文/第001章.md       — 仅写一个占位标题行 \`# 第一章\` 和一行注释 \`<!-- 正文待 agent 续写 -->\`，不要写正文`,
      ``,
      `加上开头的 设定/方向.md 共 10 个文件，每个都必须用 write_file 实际写入。完成后用一句话报告。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `根据已锁定的方向，开始搭建《${ctx.bookMeta.title}》项目结构（先写 设定/方向.md）。`
  },
  async onComplete() {
    return { scaffolded: true }
  },
}
```

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/agentic/phases/scaffold-book.test.ts
```
Expected: PASS.

- [ ] Commit:

```
git add fanqie-workbench/src/agentic/phases/scaffold-book.ts fanqie-workbench/tests/agentic/phases/scaffold-book.test.ts
git commit -m "feat(agentic): scaffold-book writes 设定/方向.md from directionSummary

clarify-direction no longer writes to disk, so scaffold-book now persists
the direction summary as the first of 10 files.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — book-create route: `{ idea }` body, placeholder row, onBookNamed impl, cleanup on failed/cancelled

**Files:**
- Modify: `fanqie-workbench/src/server/routes/agent-sessions.ts`
- Test: `fanqie-workbench/tests/server/book-create-route.test.ts`

Steps:

- [ ] Write the failing test. Replace the contents of `tests/server/book-create-route.test.ts` with the following. It builds a Fastify app with an in-memory better-sqlite3 db, stubs `deps.service.start` to (a) capture the passed `onBookNamed`/`bookMeta`/`actionKey` and (b) drive it like the real runner would (call `onBookNamed`, then emit `done`). Match the existing server-test conventions (build app, inject, in-memory db seeded with `schemaSql`).

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'

let app: FastifyInstance
let db: Database.Database
let workspace: string

function makeDb() {
  const d = new Database(':memory:')
  d.exec(schemaSql)
  return d
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'book-create-'))
  process.env.WORKSPACE_ROOT = workspace
  db = makeDb()
})

afterEach(async () => {
  await app?.close()
  db?.close()
  rmSync(workspace, { recursive: true, force: true })
  delete process.env.WORKSPACE_ROOT
  vi.restoreAllMocks()
})

describe('POST /api/agent-sessions/book-create', () => {
  it('accepts { idea }, inserts a placeholder books row with pending root_path, and starts the agent with onBookNamed + idea', async () => {
    let captured: any = null
    const service: any = {
      start: vi.fn(async (input: any) => {
        captured = input
        // do NOT emit done here; assert the placeholder state first
        return { status: 'running', traceId: 1 }
      }),
      cancel: vi.fn(),
      get: vi.fn(),
      submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { idea: '女频豪门追妻火葬场，带悬疑线' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.bookId).toBeTruthy()
    expect(body.sessionId).toBeTruthy()

    // placeholder row exists with pending root_path
    const row: any = db.prepare('SELECT id, title, root_path FROM books WHERE id = ?').get(body.bookId)
    expect(row).toBeTruthy()
    expect(row.root_path).toBe(`pending:${body.bookId}`)
    expect(row.title.length).toBeGreaterThan(0)

    // service.start got actionKey, the idea on bookMeta, and an onBookNamed callback
    expect(captured.actionKey).toBe('book.create')
    expect(captured.bookMeta.idea).toBe('女频豪门追妻火葬场，带悬疑线')
    expect(captured.bookMeta.rootPath).toBe(`pending:${body.bookId}`)
    expect(typeof captured.onBookNamed).toBe('function')
  })

  it('rejects missing idea with 400', async () => {
    const service: any = { start: vi.fn(), cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn() }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('onBookNamed creates the directory, backfills the row, and returns the final path', async () => {
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => {
        onBookNamed = input.onBookNamed
        return { status: 'running', traceId: 1 }
      }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: '随便想法' } })
    const bookId = res.json().bookId

    const out = await onBookNamed!('雾港疑局')
    expect(out.title).toBe('雾港疑局')
    expect(out.rootPath).toBe(join(workspace, 'novels', '雾港疑局'))
    expect(existsSync(out.rootPath)).toBe(true)

    const row: any = db.prepare('SELECT title, root_path FROM books WHERE id = ?').get(bookId)
    expect(row.title).toBe('雾港疑局')
    expect(row.root_path).toBe(join(workspace, 'novels', '雾港疑局'))
  })

  it('onBookNamed appends （2） on title/dir collision', async () => {
    // pre-seed an existing book with the same title + real dir
    const existingId = 'existing-book'
    const existingRoot = join(workspace, 'novels', '雾港疑局')
    db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run(existingId, '雾港疑局', existingRoot)

    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })

    const out = await onBookNamed!('雾港疑局')
    expect(out.title).toBe('雾港疑局（2）')
    expect(out.rootPath).toBe(join(workspace, 'novels', '雾港疑局（2）'))
    expect(existsSync(out.rootPath)).toBe(true)
  })

  it('deletes the placeholder books row when the agent finishes failed before naming', async () => {
    let emitter: EventEmitter | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    // still pending (never named) -> failed must delete the ghost row
    emitter!.emit('event', { type: 'done', status: 'failed' })
    await new Promise((r) => setTimeout(r, 0))

    const row = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)
    expect(row).toBeUndefined()
  })

  it('does NOT delete the row when failed AFTER naming (real root_path present)', async () => {
    let emitter: EventEmitter | null = null
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    await onBookNamed!('已命名书') // backfills real root_path
    emitter!.emit('event', { type: 'done', status: 'failed' })
    await new Promise((r) => setTimeout(r, 0))

    const row: any = db.prepare('SELECT root_path FROM books WHERE id = ?').get(bookId)
    expect(row).toBeTruthy()
    expect(row.root_path).not.toMatch(/^pending:/)
  })

  it('inserts chapter 1 with absolute source_path on succeeded', async () => {
    let emitter: EventEmitter | null = null
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    await onBookNamed!('成稿书')
    emitter!.emit('event', { type: 'done', status: 'succeeded' })
    await new Promise((r) => setTimeout(r, 0))

    const ch: any = db.prepare('SELECT chapter_number, source_path FROM chapters WHERE book_id = ?').get(bookId)
    expect(ch.chapter_number).toBe(1)
    expect(ch.source_path).toBe(join(workspace, 'novels', '成稿书', '正文', '第001章.md'))
  })
})
```

- [ ] Run it (expected FAIL — route still reads `title`, eager-mkdirs, has no `onBookNamed`/cleanup):

```
cd fanqie-workbench && npx vitest run tests/server/book-create-route.test.ts
```
Expected: FAIL.

- [ ] Implement — in `src/server/routes/agent-sessions.ts` replace the entire `app.post('/api/agent-sessions/book-create', ...)` handler (lines ~106-165) with:

```typescript
  app.post<{ Body: { idea: string } }>(
    '/api/agent-sessions/book-create',
    async (req, reply) => {
      const idea = req.body?.idea?.trim()
      if (!idea) {
        return reply.code(400).send({ error: 'idea is required' })
      }

      const workspaceRoot = process.env.WORKSPACE_ROOT ?? resolvePath(process.cwd(), '..')
      const bookId = randomUUID()
      // Placeholder row: title = truncated idea, root_path = pending:{bookId}
      // (satisfies NOT NULL UNIQUE; never used as a real filesystem path).
      const placeholderTitle = idea.slice(0, 20)
      const placeholderRoot = `pending:${bookId}`
      deps.db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, placeholderTitle, placeholderRoot)

      // onBookNamed: called by the runner once clarify-direction confirms a title.
      const onBookNamed = async (title: string): Promise<{ title: string; rootPath: string }> => {
        const clean = title.replace(/[\\/]/g, ' ').trim() || '新书'
        let finalTitle = clean
        let n = 2
        // de-dup against existing book titles AND existing directories
        const titleTaken = (t: string) => {
          const dup = deps.db.prepare(`SELECT id FROM books WHERE title = ? AND id != ?`).get(t, bookId)
          if (dup) return true
          return existsSync(join(workspaceRoot, 'novels', t))
        }
        while (titleTaken(finalTitle)) {
          finalTitle = `${clean}（${n}）`
          n += 1
        }
        const bookRoot = join(workspaceRoot, 'novels', finalTitle)
        await mkdir(bookRoot, { recursive: true })
        deps.db.prepare(`UPDATE books SET title = ?, root_path = ? WHERE id = ?`).run(finalTitle, bookRoot, bookId)
        return { title: finalTitle, rootPath: bookRoot }
      }

      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      emitter.on('event', (ev: any) => {
        if (ev.type !== 'done') return
        activeBookIds.delete(bookId)
        const current: any = deps.db.prepare(`SELECT root_path FROM books WHERE id = ?`).get(bookId)
        const stillPending = !current || String(current.root_path).startsWith('pending:')
        if (ev.status === 'succeeded') {
          if (!current || stillPending) return
          try {
            const bookRoot = current.root_path as string
            const existing = deps.db.prepare(`SELECT id FROM chapters WHERE book_id = ? AND chapter_number = ?`).get(bookId, 1)
            if (!existing) {
              const chapterId = randomUUID()
              deps.db.prepare(
                `INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`,
              ).run(chapterId, bookId, 1, '第一章', join(bookRoot, '正文', '第001章.md'), '待写作')
            }
          } catch (err) {
            console.error('[book-create] failed to insert chapter 1:', err)
          }
        } else {
          // failed / cancelled: if we never got a real path, delete the ghost row
          if (stillPending) {
            try {
              deps.db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId)
            } catch (err) {
              console.error('[book-create] failed to clean up placeholder row:', err)
            }
          }
        }
      })
      activeBookIds.add(bookId)

      try {
        const runner = await deps.service.start({
          actionKey: 'book.create',
          bookMeta: { id: bookId, title: placeholderTitle, rootPath: placeholderRoot, idea },
          chapter: null,
          sessionId, emitter,
          onBookNamed,
        })
        return { sessionId, bookId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        activeBookIds.delete(bookId)
        // start failed before anything ran — remove the placeholder row
        try { deps.db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId) } catch { /* ignore */ }
        return reply.code(500).send({ error: err.message })
      }
    },
  )
```

- [ ] Add the `existsSync` import at the top of the file. Change the existing fs import line:

```typescript
import { mkdir } from 'node:fs/promises'
```

to:

```typescript
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
```

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/server/book-create-route.test.ts
```
Expected: PASS.

- [ ] Run the existing bootstrap test to confirm no regression (it asserts chapter-1 insertion on succeeded):

```
cd fanqie-workbench && npx vitest run tests/server/book-create-chapter-bootstrap.test.ts
```
Expected: PASS. If this legacy test still posts `{ title }` and asserts eager mkdir, UPDATE it to the new `{ idea }` + onBookNamed flow (drive `onBookNamed` before emitting succeeded) — do not weaken the new behavior to satisfy the old test.

- [ ] Commit:

```
git add fanqie-workbench/src/server/routes/agent-sessions.ts fanqie-workbench/tests/server/book-create-route.test.ts fanqie-workbench/tests/server/book-create-chapter-bootstrap.test.ts
git commit -m "feat(server): book-create accepts idea, defers dir creation via onBookNamed

Inserts a placeholder books row (root_path=pending:), passes idea+onBookNamed
to the agent, mkdirs+backfills on naming (with （2） collision suffix), and
deletes the ghost row on failed/cancelled before naming.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — Cover stub endpoint `POST /api/books/:bookId/cover` (minimal closure)

> **Minimal closure (see Investigation findings):** no reusable story-cover skill-trigger backend entry exists in `fanqie-workbench`. This task ships only a validated stub so the library button has a real target. Actual GPT-Image-2 / story-cover wiring is deferred and out of scope for Plan 1; it must not block A–D.

**Files:**
- Modify: `fanqie-workbench/src/server/routes/books.ts` (export `registerBookRoutes`, singular)
- Test: `fanqie-workbench/tests/server/books-cover-route.test.ts` (Create)

**Important (verified):** the export is `registerBookRoutes(app)` and handlers open their own DB via `openDatabase(getDatabasePath())`, where `getDatabasePath()` returns `process.env.WORKBENCH_DB || 'data/workbench.sqlite'`. There is NO `deps.db`. The test must seed a temp sqlite file and point `WORKBENCH_DB` at it (mirroring `tests/server/books-route.test.ts`).

Steps:

- [ ] Write the failing test `tests/server/books-cover-route.test.ts`. It seeds a temp sqlite file with one book having a real root_path and one still-`pending:`, points `WORKBENCH_DB` at it, registers `registerBookRoutes(app)`, and asserts the cover endpoint returns 202/queued for the real one, 409 for the pending one, 404 for unknown.

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerBookRoutes } from '../../src/server/routes/books.js'

let app: FastifyInstance
let tmp: string
let dbPath: string
let prevDb: string | undefined

beforeEach(() => {
  prevDb = process.env.WORKBENCH_DB
  tmp = mkdtempSync(join(tmpdir(), 'books-cover-'))
  dbPath = join(tmp, 'test.sqlite')
  process.env.WORKBENCH_DB = dbPath
  const db = new Database(dbPath)
  db.exec(schemaSql)
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('real-1', '雾港疑局', '/novels/雾港疑局')
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('pending-1', '占位', 'pending:pending-1')
  db.close()
  app = Fastify()
  registerBookRoutes(app)
})

afterEach(async () => {
  await app?.close()
  rmSync(tmp, { recursive: true, force: true })
  if (prevDb === undefined) delete process.env.WORKBENCH_DB
  else process.env.WORKBENCH_DB = prevDb
})

describe('POST /api/books/:bookId/cover', () => {
  it('queues a cover job for a book with a real root_path', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/real-1/cover' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ status: 'queued' })
  })

  it('returns 409 for a book that is still pending', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/pending-1/cover' })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for an unknown book', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/nope/cover' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] Run it (expected FAIL — endpoint does not exist; Fastify returns 404 for the unregistered route, so the 202/409 assertions fail):

```
cd fanqie-workbench && npx vitest run tests/server/books-cover-route.test.ts
```
Expected: FAIL.

- [ ] Implement — inside `registerBookRoutes` in `src/server/routes/books.ts`, add the route alongside the other `app.<verb>` registrations. It opens its own DB via the existing `openDatabase(getDatabasePath())` + `db.close()` pattern used by every other handler in this file:

```typescript
  // Minimal closure for the 生成封面 button. story-cover is a separate Claude-skill
  // channel (not the agentic loop); actual GPT-Image-2 wiring is deferred. For now
  // this validates the book is fully created and returns a queued placeholder.
  app.post<{ Params: { bookId: string } }>(
    '/api/books/:bookId/cover',
    async (request, reply) => {
      const db = openDatabase(getDatabasePath())
      try {
        const book = db.prepare('SELECT id, title, root_path FROM books WHERE id = ?').get(request.params.bookId) as
          | { id: string; title: string; root_path: string }
          | undefined
        if (!book) return reply.code(404).send({ error: 'book not found' })
        if (book.root_path.startsWith('pending:')) {
          return reply.code(409).send({ error: 'book is still being created' })
        }
        // TODO(plan-1 follow-up): trigger story-cover skill (GPT-Image-2) into book.root_path.
        return reply.code(202).send({ status: 'queued', bookId: book.id })
      } finally {
        db.close()
      }
    },
  )
```

> `openDatabase` and `getDatabasePath` are already imported/defined at the top of `books.ts` — no new imports needed.

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/server/books-cover-route.test.ts
```
Expected: PASS.

- [ ] Run existing books-route tests for no regression:

```
cd fanqie-workbench && npx vitest run tests/server/books-route.test.ts
```
Expected: PASS.

- [ ] Commit:

```
git add fanqie-workbench/src/server/routes/books.ts fanqie-workbench/tests/server/books-cover-route.test.ts
git commit -m "feat(server): minimal POST /api/books/:bookId/cover stub endpoint

Validated queued-placeholder for the library 生成封面 button. story-cover
skill wiring (GPT-Image-2) deferred; does not block book.create flow.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — Modal sends `{ idea }`; running-title no longer reuses idea

**Files:**
- Modify: `fanqie-workbench/src/web/components/book-creation-modal.tsx`
- Test: `fanqie-workbench/tests/web/book-creation-modal.test.tsx` (Create)
- Modify: `fanqie-workbench/tests/web/library-page.test.tsx` (fix the existing `{ title }` assertion to `{ idea }`)

Steps:

- [ ] Write the failing test `tests/web/book-creation-modal.test.tsx`. Uses the FakeSocket pattern from `library-page.test.tsx`. Asserts: submit posts `{ idea }` (not `{ title }`); after sessionId is set the running modal title is `正在创建新书…` and does NOT contain the idea text.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookCreationModal } from '../../src/web/components/book-creation-modal.js'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  listeners: Record<string, ((e: any) => void)[]> = {}
  sent: any[] = []
  constructor(public url: string) { FakeSocket.last = this }
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ??= []).push(cb) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() {}
  fire(type: string, evt: any) { (this.listeners[type] ?? []).forEach((cb) => cb(evt)) }
}

describe('BookCreationModal', () => {
  beforeEach(() => {
    FakeSocket.last = null
    ;(globalThis as any).WebSocket = FakeSocket as any
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts { idea } (not { title }) on submit', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'sess-1', bookId: 'b-1', status: 'running', traceId: 't-1' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookCreationModal open onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/agent-sessions/book-create', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idea: '现代悬疑复仇文，强反转' }),
      }))
    })
  })

  it('running modal title is 正在创建新书… and does not reuse the idea as a title', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessionId: 'sess-1', bookId: 'b-1', status: 'running', traceId: 't-1' }),
    }))

    render(<BookCreationModal open onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    expect(await screen.findByRole('heading', { name: '正在创建新书…' })).toBeTruthy()
    expect(screen.queryByText(/正在创建《现代悬疑复仇文，强反转》/)).toBeNull()
  })
})
```

- [ ] Run it (expected FAIL — modal posts `{ title: idea }` and titles the running modal `正在创建《...》`):

```
cd fanqie-workbench && npx vitest run tests/web/book-creation-modal.test.tsx
```
Expected: FAIL.

- [ ] Implement — in `src/web/components/book-creation-modal.tsx`:

Change the POST body in `submit()`:

```typescript
        body: JSON.stringify({ title: idea.trim() }),
```
to:

```typescript
        body: JSON.stringify({ idea: idea.trim() }),
```

Change the running modal title:

```typescript
      <Modal open={open} onClose={onClose} title={`正在创建《${idea.trim()}》`} footer={<Button variant="ghost" onClick={onClose}>关闭</Button>}>
```
to:

```typescript
      <Modal open={open} onClose={onClose} title="正在创建新书…" footer={<Button variant="ghost" onClick={onClose}>关闭</Button>}>
```

- [ ] Run the new modal test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/web/book-creation-modal.test.tsx
```
Expected: PASS.

- [ ] Fix the existing library-page test that still expects `{ title }`. In `tests/web/library-page.test.tsx`, change:

```typescript
        body: JSON.stringify({ title: '现代悬疑复仇文' }),
```
to:

```typescript
        body: JSON.stringify({ idea: '现代悬疑复仇文' }),
```

- [ ] Run library-page tests to confirm the fix (still PASS for the existing creation-modal cases):

```
cd fanqie-workbench && npx vitest run tests/web/library-page.test.tsx
```
Expected: PASS (the 生成封面 assertions added in Task 8 are not here yet).

- [ ] Commit:

```
git add fanqie-workbench/src/web/components/book-creation-modal.tsx fanqie-workbench/tests/web/book-creation-modal.test.tsx fanqie-workbench/tests/web/library-page.test.tsx
git commit -m "feat(web): book-creation modal posts { idea }, neutral running title

Sends { idea } instead of { title }; running modal reads 正在创建新书…
so the idea is no longer impersonating the book title.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Library 生成封面 button per book card

**Files:**
- Modify: `fanqie-workbench/src/web/pages/library-page.tsx`
- Test: `fanqie-workbench/tests/web/library-page.test.tsx`

Steps:

- [ ] Write the failing test. Append this case to `tests/web/library-page.test.tsx` (inside the existing `describe`). It renders one book, clicks 生成封面, and asserts a POST to `/api/books/:id/cover`.

```typescript
  it('renders a 生成封面 button per book and posts to the cover endpoint on click', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      if (input === '/api/books/book-1/cover' && init?.method === 'POST') return { ok: true, status: 202, json: async () => ({ status: 'queued' }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    const coverBtn = await screen.findByText('生成封面')
    fireEvent.click(coverBtn)

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/books/book-1/cover', expect.objectContaining({ method: 'POST' }))
    })
  })
```

- [ ] Run it (expected FAIL — no 生成封面 button exists yet):

```
cd fanqie-workbench && npx vitest run tests/web/library-page.test.tsx
```
Expected: FAIL (the new case fails; others pass).

- [ ] Implement — in `src/web/pages/library-page.tsx`:

Add a handler alongside `deleteBook` (after the `deleteBook` function, before `return`):

```typescript
  const generateCover = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation()
    setError(null)
    try {
      const response = await fetch(`/api/books/${book.id}/cover`, { method: 'POST' })
      if (!response.ok && response.status !== 202) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || '封面生成失败')
      }
      setScanMessage(`已开始为《${book.title}》生成封面`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '封面生成失败')
    }
  }
```

Add the button to each card, between the open-book button and the delete button:

```typescript
              <button onClick={() => onOpenBook(book.id)} style={{ flex: 1, textAlign: 'left', padding: spacing.lg, border: '1px solid var(--border)', borderRadius: radius.lg, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <strong>{book.title}</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: spacing.xs }}>{book.root_path}</div>
              </button>
              <button onClick={(e) => void generateCover(book, e)} title="生成封面" style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: radius.md, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: fontSize.sm, flexShrink: 0 }}>生成封面</button>
              <button onClick={(e) => void deleteBook(book, e)} title="删除此书" style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: radius.md, background: 'transparent', color: 'var(--red)', cursor: 'pointer', fontSize: fontSize.sm, flexShrink: 0 }}>删除</button>
```

- [ ] Run the test (expected PASS):

```
cd fanqie-workbench && npx vitest run tests/web/library-page.test.tsx
```
Expected: PASS (all cases).

- [ ] Commit:

```
git add fanqie-workbench/src/web/pages/library-page.tsx fanqie-workbench/tests/web/library-page.test.tsx
git commit -m "feat(web): add 生成封面 button to each library book card

Posts to POST /api/books/:bookId/cover (minimal cover stub) alongside 删除.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — Full regression sweep

**Files:** none (verification only).

Steps:

- [ ] Run the full agentic + server + web suites touched by this plan:

```
cd fanqie-workbench && npx vitest run tests/agentic tests/server tests/web
```
Expected: PASS (no regressions). If a pre-existing test asserted the old `book-create` `{ title }` contract or eager mkdir beyond the ones updated in Tasks 5 & 7, update it to the new contract (the new behavior is the source of truth).

- [ ] Run the entire suite:

```
cd fanqie-workbench && npm test
```
Expected: PASS (matches 验收标准 "`npm test` 不回归").

- [ ] If everything is green, no commit needed (verification only). If a test was updated to the new contract, commit it:

```
git add -A
git commit -m "test: update legacy book-create assertions to idea/deferred-dir contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review against spec Part 1 (A–E + 验收标准)

- **A. Modal single 想法 textarea, body `{ idea }`, neutral running title** → Task 7. Single textarea kept (label 开书想法), body `{ idea }`, running title `正在创建新书…`, idea no longer impersonates title. Slash/space restriction removed (route no longer validates `[\\/ ]`). ✓
- **B. clarify-direction: drop write_file, 5th title question, onComplete `{ directionLocked, directionSummary, bookTitle }`, idea passed through** → Task 3. idea threaded via `BookMeta.idea` (Task 1, recommended single approach — chose the BookMeta field, NOT initialResults, per the "pick ONE" instruction). ✓
- **C. Runner `onBookNamed?` threaded through service+pool; called after onComplete merge when `bookTitle` set; mutates `bookMeta.title`/`rootPath` in place** → Tasks 1+2. Signature identical in `AgentRunnerOptions`, `PoolStartInput`, `AgentStartInput`: `onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>`. Verified consistent across all three. ✓
- **C. Route placeholder `root_path = 'pending:'+bookId`, truncated placeholder title; onBookNamed computes `join(workspaceRoot,'novels',title)`, `（2）/（3）` on collision (title row OR dir), mkdir, UPDATE, return final** → Task 5. ✓
- **D. scaffold-book also writes `设定/方向.md` from `directionSummary`; chapter-1 absolute `source_path`** → Task 4 (设定/方向.md) + Task 5 (chapter-1 absolute path on succeeded, gated on non-pending root_path). ✓
- **Error handling: failed/cancelled before naming deletes placeholder row** → Task 5 (done handler checks `pending:` prefix; also start-failure path deletes row). ✓
- **E. Library 生成封面 button + cover endpoint; investigate existing cover/skill triggers; minimal stub if none** → Investigation findings (no reusable entry; `oh-story-claudecode/story-cover` is out-of-process skill) + Task 6 (minimal validated stub 202/queued, 409 pending, 404 unknown, added to the verified `registerBookRoutes`/`openDatabase`/`WORKBENCH_DB` pattern) + Task 8 (button). Clearly marked minimal closure, non-blocking. ✓
- **验收标准:** new book → idea only → answers → candidate-title confirmation (Task 3) → real `novels/{书名}/` only after naming (Task 5) → scaffold (Task 4) → library shows confirmed title (Task 5 backfill) → chapter 1 exists (Task 5) → continue-write usable (unchanged path). Cancel before naming leaves no ghost row / no empty dir (Task 5). 生成封面 button present + triggers request (Task 8). `npm test` no regression (Task 9). ✓

**Type/placeholder consistency:** `onBookNamed` signature byte-identical in all 3 interfaces and all test stubs. `BookMeta.idea?: string` used uniformly. No `TODO`/"similar to"/"add validation" placeholders in any implementation code block (the single `TODO(plan-1 follow-up)` comment is the explicitly-deferred story-cover wiring, which the spec sanctions as the minimal-closure boundary).

**Open questions / risks:**
- Books route shape is now **verified**: export is `registerBookRoutes(app)` (singular), no `deps.db`, opens its own DB via `openDatabase(getDatabasePath())` with `WORKBENCH_DB`. Task 6 uses this exact pattern.
- The old `tests/server/book-create-route.test.ts` cases assert a `{ title }` body, eager `mkdir`, 400-on-slash, and 409-on-duplicate-title. The new flow accepts `{ idea }` (slashes allowed in the idea), defers mkdir, and resolves duplicates by suffixing during `onBookNamed` (so the route no longer 409s on submit). Task 5 **replaces** that file with the new-contract cases (it does not preserve the 400-slash / 409-duplicate-on-submit behavior — those moved to `onBookNamed`'s `（2）` suffixing). This is intentional, not a regression.
- Legacy `tests/server/book-create-chapter-bootstrap.test.ts` encodes the old `{ title }` + eager-mkdir + immediate-succeeded contract; Task 5's regression step updates it to drive `onBookNamed` before emitting succeeded (or, simpler, deletes it since `book-create-route.test.ts` now covers chapter-1 insertion + failure-no-chapter). Pick deletion-or-update during Task 5 and note which in the commit.
- `parseBookTitle` relies on the agent emitting a `BOOK_TITLE:` marker; the fallback (first non-empty line, capped 40 chars) guarantees a non-empty title.
