# 多平台发布底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Book-centered multi-platform publishing foundation where one local book can track its publishing state across many platforms.

**Architecture:** `Book` remains the local source object and `BooksPage` is the main workbench. Publishing state is modeled as `Book -> many BookPublications -> many ChapterPublications`, with platform accounts, book binding, and chapter publishing kept as separate layers. Platform-specific browser URLs, selectors, login checks, binding, publishing, and verification live behind a Playwright page-oriented `PublishPlatformAdapter`.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, Vitest, Playwright-style page adapters.

---

## Non-negotiable direction from handoff

- The product center is `BooksPage`, not a task page, account page, or single-platform Fanqie page.
- The core model is exactly: `Book -> many BookPublications -> many ChapterPublications`.
- Do not put long-term remote IDs on `books` / `chapters`; legacy `remote_*` columns are migration inputs only.
- Login, binding, and publishing are separate layers:
  - `PlatformAccount`: session/profile/cookies/health.
  - `BookPublication`: local book to platform book binding and target account.
  - `ChapterPublication`: per-chapter publish/sync/verify state.
- Common skeleton first; wire Fanqie first; Qimao/Qidian remain adapter scaffolds until their platform details are researched.
- Do not commit from this plan unless the user explicitly asks for commits.

## Current baseline before continuing

Already implemented and verified in the current working tree:

- Canonical fresh schema creates `platform_accounts`, `book_publications`, and `chapter_publications`.
- Fresh `books` and `chapters` do **not** get `remote_book_id` / `remote_id`.
- Legacy Fanqie `accounts` / `books.remote_book_id` / `chapters.remote_id` backfill into the new publication tables.
- Repository files exist for platform accounts, book publications, and chapter publications.
- Focused tests passing previously:
  - `tests/db/multi-platform-schema.test.ts`
  - `tests/db/publications-repo.test.ts`

This plan resumes by aligning that baseline to the latest handoff, then continuing with adapters, routes, and UI.

---

## File map

### Existing files to modify

- `fanqie-workbench/src/domain/platform.ts` — known platform list plus arbitrary platform string support.
- `fanqie-workbench/src/domain/platform-account.ts` — `PlatformAccountRecord` shape matching handoff.
- `fanqie-workbench/src/domain/publication.ts` — `BookPublicationStatus` and `ChapterPublicationStatus` matching handoff.
- `fanqie-workbench/src/db/schema.ts` — allow nullable `platform_accounts.profile_path` for non-browser/cookie-only accounts.
- `fanqie-workbench/src/db/client.ts` — keep additive migrations/backfill transaction-safe; do not re-add fresh `remote_*` columns.
- `fanqie-workbench/src/db/repositories/platform-accounts-repo.ts` — complete CRUD and support arbitrary platform strings.
- `fanqie-workbench/src/db/repositories/book-publications-repo.ts` — complete CRUD for binding/status updates and summary support.
- `fanqie-workbench/src/db/repositories/chapter-publications-repo.ts` — complete per-publication chapter mapping helpers.
- `fanqie-workbench/src/publish/fanqie-adapter.ts` — implement the new `PublishPlatformAdapter` contract for Fanqie skeleton.
- `fanqie-workbench/src/publish/publish-job-service.ts` — plan jobs by `bookPublicationId`, not `accountId`.
- `fanqie-workbench/src/publish/publish-runner.ts` — publish through `BookPublication` + adapter, not direct book/account state.
- `fanqie-workbench/src/server/routes/accounts.ts` — expose platform-account routes; remove fake account activation hot path.
- `fanqie-workbench/src/server/routes/books.ts` — expose Book-centered publication routes and status summaries.
- `fanqie-workbench/src/server/app.ts` — route registration only if needed.
- `fanqie-workbench/src/web/pages/accounts-page.tsx` — platform account management as support surface.
- `fanqie-workbench/src/web/pages/books-page.tsx` — main workbench showing platform publications under each book.

### New files to create

- `fanqie-workbench/src/publish/publisher-adapter.ts` — exact handoff adapter interface and shared input types.
- `fanqie-workbench/src/publish/platform-registry.ts` — adapter lookup/registration by platform string.
- `fanqie-workbench/src/publish/qimao-adapter.ts` — Qimao adapter scaffold.
- `fanqie-workbench/src/publish/qidian-adapter.ts` — Qidian adapter scaffold.
- `fanqie-workbench/tests/domain/publishing-model.test.ts` — domain contract tests.
- `fanqie-workbench/tests/publish/platform-registry.test.ts` — adapter registry tests.
- `fanqie-workbench/tests/server/platform-accounts-route.test.ts` — platform account route tests.
- `fanqie-workbench/tests/server/book-publications-route.test.ts` — Book-centered publication route tests.
- `fanqie-workbench/tests/web/multi-platform-workbench.test.tsx` — BooksPage/AccountsPage integration smoke tests.

---

### Task 1: Align Domain Types and Repository CRUD with Handoff

**Purpose:** Bring the already-added multi-platform schema/repos into exact agreement with the handoff before building routes or UI on top.

**Files:**
- Modify: `fanqie-workbench/src/domain/platform.ts`
- Modify: `fanqie-workbench/src/domain/platform-account.ts`
- Modify: `fanqie-workbench/src/domain/publication.ts`
- Modify: `fanqie-workbench/src/db/schema.ts`
- Modify: `fanqie-workbench/src/db/repositories/platform-accounts-repo.ts`
- Modify: `fanqie-workbench/src/db/repositories/book-publications-repo.ts`
- Modify: `fanqie-workbench/src/db/repositories/chapter-publications-repo.ts`
- Test: `fanqie-workbench/tests/domain/publishing-model.test.ts`
- Test: `fanqie-workbench/tests/db/publications-repo.test.ts`
- Test: `fanqie-workbench/tests/db/multi-platform-schema.test.ts`

- [ ] **Step 1: Add failing domain/schema tests**

Create `fanqie-workbench/tests/domain/publishing-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KNOWN_PLATFORMS, getPlatformLabel, isKnownPlatform, isSupportedPlatform } from '../../src/domain/platform'

describe('publishing domain model', () => {
  it('knows the first three platform skeletons and accepts future platform strings', () => {
    expect(KNOWN_PLATFORMS).toEqual(['fanqie', 'qimao', 'qidian'])
    expect(isKnownPlatform('fanqie')).toBe(true)
    expect(isKnownPlatform('qimao')).toBe(true)
    expect(isKnownPlatform('qidian')).toBe(true)
    expect(isKnownPlatform('custom-platform')).toBe(false)
    expect(isSupportedPlatform('custom-platform')).toBe(true)
    expect(isSupportedPlatform('')).toBe(false)
    expect(isSupportedPlatform('   ')).toBe(false)
  })

  it('provides stable labels for known platforms and falls back to the raw custom platform name', () => {
    expect(getPlatformLabel('fanqie')).toBe('番茄')
    expect(getPlatformLabel('qimao')).toBe('七猫')
    expect(getPlatformLabel('qidian')).toBe('起点')
    expect(getPlatformLabel('custom-platform')).toBe('custom-platform')
  })
})
```

Extend `fanqie-workbench/tests/db/multi-platform-schema.test.ts` with:

```ts
it('allows platform account profile_path to be null for non-browser account flows', async () => {
  const path = await tempDb('nullable-profile.sqlite')
  const db = openDatabase(path)
  const columns = db.prepare('PRAGMA table_info(platform_accounts)').all() as Array<{ name: string; notnull: number }>
  const profilePath = columns.find((column) => column.name === 'profile_path')

  expect(profilePath?.notnull).toBe(0)
  db.close()
})
```

Extend `fanqie-workbench/tests/db/publications-repo.test.ts` with:

```ts
it('supports qimao and future custom platform accounts', () => {
  const db = openDatabase(':memory:')

  const qimao = createPlatformAccount(db, { platform: 'qimao', label: '七猫A' })
  const custom = createPlatformAccount(db, { platform: 'custom-platform', label: '自定义平台' })

  expect(qimao.platform).toBe('qimao')
  expect(custom.platform).toBe('custom-platform')
  expect(listPlatformAccounts(db, 'qimao')).toEqual([expect.objectContaining({ id: qimao.id })])
  expect(listPlatformAccounts(db, 'custom-platform')).toEqual([expect.objectContaining({ id: custom.id })])
  db.close()
})

it('updates book publication binding and pause state', () => {
  const db = openDatabase(':memory:')
  db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()
  const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })
  const publication = createBookPublication(db, { bookId: 'b1', platform: 'fanqie', platformAccountId: account.id })

  updateBookPublicationBinding(db, publication.id, { platformBookId: 'fanqie-book-1', status: 'bound' })
  expect(getBookPublicationById(db, publication.id)).toMatchObject({
    platformBookId: 'fanqie-book-1',
    status: 'bound',
  })

  updateBookPublicationStatus(db, publication.id, 'paused')
  expect(getBookPublicationById(db, publication.id)).toMatchObject({ status: 'paused' })
  db.close()
})
```

- [ ] **Step 2: Run tests to verify they fail for the current mismatch**

Run:

```bash
cd fanqie-workbench && npx vitest run tests/domain/publishing-model.test.ts tests/db/multi-platform-schema.test.ts tests/db/publications-repo.test.ts
```

Expected: FAIL because `qimao`/custom platform support, nullable `profile_path`, and book-publication update helpers are not fully aligned yet.

- [ ] **Step 3: Update platform domain helpers**

Replace `fanqie-workbench/src/domain/platform.ts` with:

```ts
export const KNOWN_PLATFORMS = ['fanqie', 'qimao', 'qidian'] as const

export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number]
export type SupportedPlatform = KnownPlatform | (string & {})

const PLATFORM_LABELS: Record<KnownPlatform, string> = {
  fanqie: '番茄',
  qimao: '七猫',
  qidian: '起点',
}

export function isKnownPlatform(value: string): value is KnownPlatform {
  return KNOWN_PLATFORMS.includes(value as KnownPlatform)
}

export function isSupportedPlatform(value: unknown): value is SupportedPlatform {
  return typeof value === 'string' && value.trim().length > 0
}

export function getPlatformLabel(platform: SupportedPlatform) {
  return isKnownPlatform(platform) ? PLATFORM_LABELS[platform] : platform
}
```

- [ ] **Step 4: Update handoff domain records**

Set `PlatformAccountRecord.profilePath` to nullable and make account status explicit:

```ts
// fanqie-workbench/src/domain/platform-account.ts
import type { SupportedPlatform } from './platform.js'

export type PlatformAccountStatus = 'needs-login' | 'active' | 'expired'

export type PlatformAccountRecord = {
  id: string
  platform: SupportedPlatform
  label: string
  profilePath: string | null
  cookiesJson: string | null
  status: PlatformAccountStatus
  lastCheckedAt: string | null
  createdAt: string
}
```

Set publication statuses to the handoff shape:

```ts
// fanqie-workbench/src/domain/publication.ts
import type { SupportedPlatform } from './platform.js'

export type BookPublicationStatus = 'draft' | 'bound' | 'paused'
export type ChapterPublicationStatus = 'pending' | 'synced' | 'published' | 'failed'

export type BookPublicationRecord = {
  id: string
  bookId: string
  platform: SupportedPlatform
  platformAccountId: string
  platformBookId: string | null
  status: BookPublicationStatus
  createdAt: string
  updatedAt: string
}

export type ChapterPublicationRecord = {
  id: string
  chapterId: string
  bookPublicationId: string
  platformChapterId: string | null
  status: ChapterPublicationStatus
  lastPublishedAt: string | null
  updatedAt: string
}
```

- [ ] **Step 5: Make `platform_accounts.profile_path` nullable in canonical schema**

In `fanqie-workbench/src/db/schema.ts`, change:

```sql
profile_path TEXT NOT NULL,
```

to:

```sql
profile_path TEXT,
```

Do not add destructive migrations for existing DBs. Existing rows with non-null `profile_path` remain valid.

- [ ] **Step 6: Complete repository CRUD helpers**

In `fanqie-workbench/src/db/repositories/book-publications-repo.ts`, add:

```ts
export function getBookPublicationById(db: Database.Database, id: string): BookPublicationRecord | null {
  const row = db.prepare(
    `SELECT id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at
     FROM book_publications
     WHERE id = ?`,
  ).get(id) as BookPublicationRow | undefined

  return row ? mapBookPublicationRow(row) : null
}

export function updateBookPublicationBinding(
  db: Database.Database,
  id: string,
  input: { platformBookId: string | null; status: BookPublicationStatus },
) {
  db.prepare(
    `UPDATE book_publications
     SET platform_book_id = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.platformBookId, input.status, new Date().toISOString(), id)
}

export function updateBookPublicationStatus(db: Database.Database, id: string, status: BookPublicationStatus) {
  db.prepare('UPDATE book_publications SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id)
}
```

Also ensure `platform-accounts-repo.ts` accepts `SupportedPlatform` strings and maps nullable `profile_path` to `profilePath: string | null`.

- [ ] **Step 7: Verify focused tests pass**

Run:

```bash
cd fanqie-workbench && npx vitest run tests/domain/publishing-model.test.ts tests/db/multi-platform-schema.test.ts tests/db/publications-repo.test.ts
```

Expected: PASS.

---

### Task 2: Implement Playwright Page-Oriented Adapter Contract and Registry

**Purpose:** Stop platform behavior from leaking into routes/runners and create the common skeleton for Fanqie, Qimao, and Qidian.

**Files:**
- Create: `fanqie-workbench/src/publish/publisher-adapter.ts`
- Create: `fanqie-workbench/src/publish/platform-registry.ts`
- Modify: `fanqie-workbench/src/publish/fanqie-adapter.ts`
- Create: `fanqie-workbench/src/publish/qimao-adapter.ts`
- Create: `fanqie-workbench/src/publish/qidian-adapter.ts`
- Test: `fanqie-workbench/tests/publish/platform-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

```ts
// fanqie-workbench/tests/publish/platform-registry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getPublishPlatformAdapter, listPublishPlatformAdapters } from '../../src/publish/platform-registry'

describe('publish platform registry', () => {
  it('registers fanqie, qimao, and qidian skeleton adapters', () => {
    expect(listPublishPlatformAdapters().map((adapter) => adapter.platform)).toEqual(['fanqie', 'qimao', 'qidian'])
    expect(getPublishPlatformAdapter('fanqie')?.platform).toBe('fanqie')
    expect(getPublishPlatformAdapter('qimao')?.platform).toBe('qimao')
    expect(getPublishPlatformAdapter('qidian')?.platform).toBe('qidian')
    expect(getPublishPlatformAdapter('custom-platform')).toBeNull()
  })

  it('Fanqie adapter opens the Fanqie author backend through the page object', async () => {
    const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => 'https://author.fanqie.com') }
    const adapter = getPublishPlatformAdapter('fanqie')

    await adapter?.openBackend(page)

    expect(page.goto).toHaveBeenCalledWith('https://author.fanqie.com', { waitUntil: 'domcontentloaded' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd fanqie-workbench && npx vitest run tests/publish/platform-registry.test.ts
```

Expected: FAIL because the new contract/registry files do not exist yet.

- [ ] **Step 3: Add exact handoff adapter interface**

```ts
// fanqie-workbench/src/publish/publisher-adapter.ts
import type { ChapterPublicationStatus } from '../domain/publication.js'
import type { SupportedPlatform } from '../domain/platform.js'

export type PublishPlatformPage = {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>
  url(): string
}

export type LocalBookForBinding = {
  id: string
  title: string
  rootPath: string
}

export type PublishChapterInput = {
  bookPublicationId: string
  chapterId: string
  platformBookId: string
  platformChapterId: string | null
  title: string
  content: string
}

export type VerifyChapterInput = {
  platformBookId: string
  platformChapterId: string
  title: string
}

export interface PublishPlatformAdapter {
  platform: SupportedPlatform
  openBackend(page: PublishPlatformPage): Promise<void>
  ensureLoggedIn(page: PublishPlatformPage): Promise<void>
  listBooks(page: PublishPlatformPage): Promise<Array<{ id: string; title: string }>>
  bindBook(page: PublishPlatformPage, localBook: LocalBookForBinding): Promise<{ platformBookId: string }>
  publishChapter(page: PublishPlatformPage, input: PublishChapterInput): Promise<{ platformChapterId?: string; status: ChapterPublicationStatus }>
  verifyChapter(page: PublishPlatformPage, input: VerifyChapterInput): Promise<boolean>
}

export class AdapterNotConfiguredError extends Error {
  constructor(platform: SupportedPlatform, capability: string) {
    super(`${platform} adapter does not implement ${capability} yet`)
  }
}
```

- [ ] **Step 4: Implement Fanqie/Qimao/Qidian skeleton adapters**

Fanqie should open the real backend URL; other capabilities can throw `AdapterNotConfiguredError` until the real Fanqie wiring task.

```ts
// fanqie-workbench/src/publish/fanqie-adapter.ts
import { AdapterNotConfiguredError, type PublishPlatformAdapter } from './publisher-adapter.js'

export const FANQIE_AUTHOR_URL = 'https://author.fanqie.com'

export const fanqieAdapter: PublishPlatformAdapter = {
  platform: 'fanqie',
  async openBackend(page) {
    await page.goto(FANQIE_AUTHOR_URL, { waitUntil: 'domcontentloaded' })
  },
  async ensureLoggedIn(page) {
    if (page.url().includes('login')) throw new Error('Fanqie account needs login')
  },
  async listBooks() { throw new AdapterNotConfiguredError('fanqie', 'listBooks') },
  async bindBook() { throw new AdapterNotConfiguredError('fanqie', 'bindBook') },
  async publishChapter() { throw new AdapterNotConfiguredError('fanqie', 'publishChapter') },
  async verifyChapter() { throw new AdapterNotConfiguredError('fanqie', 'verifyChapter') },
}
```

For `qimao-adapter.ts` and `qidian-adapter.ts`, implement the same interface with platform values `'qimao'` and `'qidian'`; `openBackend` may navigate to the known backend home URL if known, otherwise throw `AdapterNotConfiguredError(platform, 'openBackend')`.

- [ ] **Step 5: Implement registry**

```ts
// fanqie-workbench/src/publish/platform-registry.ts
import type { SupportedPlatform } from '../domain/platform.js'
import type { PublishPlatformAdapter } from './publisher-adapter.js'
import { fanqieAdapter } from './fanqie-adapter.js'
import { qimaoAdapter } from './qimao-adapter.js'
import { qidianAdapter } from './qidian-adapter.js'

const adapters = new Map<string, PublishPlatformAdapter>([
  [fanqieAdapter.platform, fanqieAdapter],
  [qimaoAdapter.platform, qimaoAdapter],
  [qidianAdapter.platform, qidianAdapter],
])

export function listPublishPlatformAdapters() {
  return Array.from(adapters.values())
}

export function getPublishPlatformAdapter(platform: SupportedPlatform) {
  return adapters.get(platform) ?? null
}
```

- [ ] **Step 6: Verify focused tests pass**

```bash
cd fanqie-workbench && npx vitest run tests/publish/platform-registry.test.ts
```

Expected: PASS.

---

### Task 3: Replace Fake Account Hot Path with Platform Account Routes

**Purpose:** Move login/session management into the platform-account layer without fake “capture session makes account active” behavior.

**Files:**
- Modify: `fanqie-workbench/src/server/routes/accounts.ts`
- Modify: `fanqie-workbench/src/server/app.ts` only if route registration changes
- Test: `fanqie-workbench/tests/server/platform-accounts-route.test.ts`

- [ ] **Step 1: Write failing route tests**

```ts
// fanqie-workbench/tests/server/platform-accounts-route.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

let previousDb: string | undefined

beforeEach(async () => {
  previousDb = process.env.WORKBENCH_DB
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-platform-routes-'))
  process.env.WORKBENCH_DB = resolve(dir, 'workbench.sqlite')
})

afterEach(() => {
  if (previousDb === undefined) delete process.env.WORKBENCH_DB
  else process.env.WORKBENCH_DB = previousDb
})

describe('platform account routes', () => {
  it('creates, lists, updates, and deletes platform accounts', async () => {
    const app = await buildServer()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/platform-accounts',
      payload: { platform: 'qimao', label: '七猫A' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body)

    const listRes = await app.inject({ method: 'GET', url: '/api/platform-accounts?platform=qimao' })
    expect(listRes.statusCode).toBe(200)
    expect(JSON.parse(listRes.body).accounts).toEqual([expect.objectContaining({ id: created.id, platform: 'qimao' })])

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/platform-accounts/${created.id}`,
      payload: { label: '七猫主号' },
    })
    expect(patchRes.statusCode).toBe(200)
    expect(JSON.parse(patchRes.body)).toMatchObject({ id: created.id, label: '七猫主号' })

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/platform-accounts/${created.id}` })
    expect(deleteRes.statusCode).toBe(204)
    await app.close()
  })

  it('does not expose the old fake capture-session endpoint', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/api/accounts/some-id/capture-session' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd fanqie-workbench && npx vitest run tests/server/platform-accounts-route.test.ts
```

Expected: FAIL because `/api/platform-accounts` routes are not implemented and the fake legacy route still exists.

- [ ] **Step 3: Implement platform account routes in `accounts.ts`**

Required endpoints:

```http
GET    /api/platform-accounts?platform=fanqie
POST   /api/platform-accounts
GET    /api/platform-accounts/:id
PATCH  /api/platform-accounts/:id
DELETE /api/platform-accounts/:id
POST   /api/platform-accounts/:id/login-session
POST   /api/platform-accounts/:id/check-health
```

Behavior:
- `POST` validates non-empty `platform` and `label` with `isSupportedPlatform()`.
- `PATCH` supports `label`, `status`, and `cookiesJson` only.
- `login-session` may return `202` with `{ started: false, reason: 'adapter login not wired yet' }` until Fanqie wiring, but must not mark the account active falsely.
- `check-health` may return the stored status until real session health exists, but must not fake success.
- Remove or stop registering `/api/accounts/:id/capture-session`.

- [ ] **Step 4: Verify focused route tests pass**

```bash
cd fanqie-workbench && npx vitest run tests/server/platform-accounts-route.test.ts
```

Expected: PASS.

---

### Task 4: Add Book-Centered Publication Routes and Status Summaries

**Purpose:** Make the API naturally support one Book showing many platform targets, their bound accounts, platform book IDs, per-status chapter counts, latest publish result, and whether publishing can continue.

**Files:**
- Modify: `fanqie-workbench/src/db/repositories/book-publications-repo.ts`
- Modify: `fanqie-workbench/src/db/repositories/chapter-publications-repo.ts`
- Modify: `fanqie-workbench/src/server/routes/books.ts`
- Test: `fanqie-workbench/tests/server/book-publications-route.test.ts`

- [ ] **Step 1: Write failing Book publication route tests**

```ts
// fanqie-workbench/tests/server/book-publications-route.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { buildServer } from '../../src/server/app'

let previousDb: string | undefined
let dbPath: string

beforeEach(async () => {
  previousDb = process.env.WORKBENCH_DB
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-book-publication-routes-'))
  dbPath = resolve(dir, 'workbench.sqlite')
  process.env.WORKBENCH_DB = dbPath
})

afterEach(() => {
  if (previousDb === undefined) delete process.env.WORKBENCH_DB
  else process.env.WORKBENCH_DB = previousDb
})

describe('book publication routes', () => {
  it('creates and lists publication targets under a local book with status counts', async () => {
    const db = openDatabase(dbPath)
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '可发布')`).run()
    db.prepare(`INSERT INTO platform_accounts (id, platform, label, profile_path, status, created_at) VALUES ('pa1', 'fanqie', '番茄A', 'p1', 'active', '2026-05-13T00:00:00.000Z')`).run()
    db.close()

    const app = await buildServer()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/books/b1/publications',
      payload: { platform: 'fanqie', platformAccountId: 'pa1' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body)

    const listRes = await app.inject({ method: 'GET', url: '/api/books/b1/publications' })
    expect(listRes.statusCode).toBe(200)
    expect(JSON.parse(listRes.body).publications).toEqual([
      expect.objectContaining({
        id: created.id,
        platform: 'fanqie',
        platformAccountId: 'pa1',
        account: expect.objectContaining({ id: 'pa1', label: '番茄A', status: 'active' }),
        chapterStatusCounts: { pending: 0, synced: 0, published: 0, failed: 0 },
        latestPublishedAt: null,
        canPublish: true,
      }),
    ])
    await app.close()
  })

  it('lists chapter publication rows for a publication target', async () => {
    const db = openDatabase(dbPath)
    db.exec(`
      INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book');
      INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '可发布');
      INSERT INTO platform_accounts (id, platform, label, profile_path, status, created_at) VALUES ('pa1', 'fanqie', '番茄A', 'p1', 'active', '2026-05-13T00:00:00.000Z');
      INSERT INTO book_publications (id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at) VALUES ('bp1', 'b1', 'fanqie', 'pa1', 'fanqie-book-1', 'bound', '2026-05-13T00:00:00.000Z', '2026-05-13T00:00:00.000Z');
      INSERT INTO chapter_publications (id, chapter_id, book_publication_id, platform_chapter_id, status, last_published_at, updated_at) VALUES ('cp1', 'c1', 'bp1', 'fanqie-ch-1', 'published', '2026-05-13T01:00:00.000Z', '2026-05-13T01:00:00.000Z');
    `)
    db.close()

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/api/book-publications/bp1/chapters' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).chapterPublications).toEqual([
      expect.objectContaining({ chapterId: 'c1', platformChapterId: 'fanqie-ch-1', status: 'published' }),
    ])
    await app.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd fanqie-workbench && npx vitest run tests/server/book-publications-route.test.ts
```

Expected: FAIL because the routes and summaries do not exist yet.

- [ ] **Step 3: Add repository summary helpers**

Add a helper that returns publication rows joined to account label/status plus aggregate counts from `chapter_publications`:

```ts
export type BookPublicationSummary = BookPublicationRecord & {
  account: { id: string; label: string; status: string }
  chapterStatusCounts: Record<'pending' | 'synced' | 'published' | 'failed', number>
  latestPublishedAt: string | null
  canPublish: boolean
}
```

`canPublish` is true only when the publication is not `paused` and the bound account is `active`.

- [ ] **Step 4: Implement Book-centered publication routes**

Required endpoints:

```http
GET    /api/books/:bookId/publications
POST   /api/books/:bookId/publications
GET    /api/book-publications/:id
PATCH  /api/book-publications/:id
GET    /api/book-publications/:id/chapters
POST   /api/book-publications/:id/publish-chapters
POST   /api/book-publications/:id/verify-chapters
```

Behavior:
- `GET /api/books/:bookId/publications` returns summaries for BooksPage.
- `POST /api/books/:bookId/publications` creates the binding target in `draft` state.
- `PATCH /api/book-publications/:id` supports changing `platformAccountId`, `platformBookId`, and `status` within the handoff status set.
- Publish/verify endpoints may return a clear `501`/not-wired response until Task 5, but they must be publication-centric, not `/api/books/:id/publish`.

- [ ] **Step 5: Verify focused route tests pass**

```bash
cd fanqie-workbench && npx vitest run tests/server/book-publications-route.test.ts
```

Expected: PASS.

---

### Task 5: Make Publish Planning and Runner Publication-Centric

**Purpose:** Ensure all publishing work starts from `BookPublication`, uses the adapter registry, and writes results to `ChapterPublication`.

**Files:**
- Modify: `fanqie-workbench/src/publish/publish-job-service.ts`
- Modify: `fanqie-workbench/src/publish/publish-runner.ts`
- Modify: `fanqie-workbench/src/server/routes/books.ts`
- Test: `fanqie-workbench/tests/publish/publish-job-service.test.ts`
- Test: `fanqie-workbench/tests/publish/publish-runner.test.ts`

- [ ] **Step 1: Write failing publish planning tests**

The test should assert `planPublishJob()` requires `bookPublicationId` and `platformAccountId`, sorts `可发布` chapters by `chapterNumber`, and no longer returns `accountId` as the primary job object.

- [ ] **Step 2: Update `publish-job-service.ts`**

Required shape:

```ts
export function planPublishJob(input: {
  bookPublicationId: string
  platformAccountId: string
  mode: 'dry-run' | 'assisted' | 'auto'
  chapters: Array<{ id: string; stage: string; chapterNumber: number }>
}) {
  if (!input.platformAccountId) {
    throw new Error('Book publication must be bound to a platform account before publishing')
  }

  const chapterIds = input.chapters
    .filter((chapter) => chapter.stage === '可发布')
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => chapter.id)

  return {
    id: `${input.bookPublicationId}:${input.mode}`,
    bookPublicationId: input.bookPublicationId,
    platformAccountId: input.platformAccountId,
    mode: input.mode,
    chapterIds,
    status: 'queued' as const,
  }
}
```

- [ ] **Step 3: Write failing runner tests with a fake adapter**

Test with an injected fake adapter/page so no real browser is opened. The runner should:
- load one `BookPublication`;
- bind the remote book if `platformBookId` is null;
- publish each planned chapter;
- upsert `chapter_publications` with returned `platformChapterId` and status;
- preserve partial successes when a later chapter fails.

- [ ] **Step 4: Implement minimal publication-centric runner**

Runner input should identify `bookPublicationId`, not `bookId + accountId`. The runner should obtain platform/account/book/chapter data from DB, call `getPublishPlatformAdapter(publication.platform)`, and write results via publication repositories. Do not implement guessed real Fanqie endpoints in this task.

- [ ] **Step 5: Verify focused publish tests pass**

```bash
cd fanqie-workbench && npx vitest run tests/publish/publish-job-service.test.ts tests/publish/publish-runner.test.ts
```

Expected: PASS.

---

### Task 6: Wire Fanqie as the First Real Platform Path

**Purpose:** Use the common skeleton for the first platform only, without deep-diving Qimao/Qidian yet.

**Files:**
- Modify: `fanqie-workbench/src/publish/account-session.ts`
- Modify: `fanqie-workbench/src/publish/fanqie-adapter.ts`
- Modify: `fanqie-workbench/src/server/routes/accounts.ts`
- Modify: `fanqie-workbench/src/server/routes/books.ts`
- Test: `fanqie-workbench/tests/publish/fanqie-adapter.test.ts`

- [ ] **Step 1: Add tests for Fanqie adapter/browser-session integration using fake pages**

Tests should cover:
- `openBackend(page)` navigates to `https://author.fanqie.com`.
- `ensureLoggedIn(page)` rejects obvious login URLs.
- `bindBook()` and `publishChapter()` are still explicit not-configured errors until actual API recording confirms endpoints.

- [ ] **Step 2: Connect `login-session` to platform adapter opening**

`POST /api/platform-accounts/:id/login-session` should:
- load the `PlatformAccount`;
- resolve `getPublishPlatformAdapter(account.platform)`;
- open the browser profile with `account.profilePath` when present;
- call `adapter.openBackend(page)`;
- return `202` without marking the account active until cookies/session verification is implemented.

- [ ] **Step 3: Keep Qimao/Qidian scaffolds inert**

Qimao/Qidian adapters should remain discoverable in the registry but not used for real publishing until researched.

- [ ] **Step 4: Verify focused tests pass**

```bash
cd fanqie-workbench && npx vitest run tests/publish/fanqie-adapter.test.ts tests/server/platform-accounts-route.test.ts
```

Expected: PASS.

---

### Task 7: Upgrade BooksPage into the Main Multi-Platform Workbench

**Purpose:** Show publishing state under each book rather than sending users to account/task/platform-centric flows.

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Modify: `fanqie-workbench/src/web/pages/accounts-page.tsx`
- Test: `fanqie-workbench/tests/web/multi-platform-workbench.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Tests should mock fetch and assert:
- `BooksPage` loads `/api/books/:bookId/publications` for expanded books.
- Expanded book UI shows “发布平台” / publication target cards.
- A target card displays platform label, account label, `platformBookId`, pending/synced/published/failed counts, latest publish time, and disabled/enabled publish action from `canPublish`.
- `AccountsPage` uses `/api/platform-accounts`, not the old fake `/api/accounts/:id/capture-session` path.

- [ ] **Step 2: Render publication summaries under each book**

Use the API response from Task 4. Do not create a top-level publication page. The user should start at a book, then inspect each platform target.

- [ ] **Step 3: Add “新增发布平台” flow**

First version can be a simple modal/dropdown that:
- selects platform (`fanqie`, `qimao`, `qidian`, or custom string later);
- selects an account filtered by platform;
- posts to `/api/books/:bookId/publications`.

- [ ] **Step 4: Keep account page as supporting management UI**

Accounts page should manage platform accounts, but should not become the publishing workbench.

- [ ] **Step 5: Run UI tests and manual smoke test**

```bash
cd fanqie-workbench && npx vitest run tests/web/multi-platform-workbench.test.tsx
cd fanqie-workbench && npm run dev:all
```

Manual checks:
- Books page lists local books.
- Expanding a book shows platform publication targets.
- Accounts page can create platform accounts.
- No UI path calls the fake capture-session endpoint.

---

### Task 8: Remove Hot-Path Single-Platform Assumptions

**Purpose:** Make sure the active product path no longer depends on account-centric or Fanqie-only routing/data.

**Files:**
- Modify as needed after grep results.
- Test: affected route/UI/db tests.

- [ ] **Step 1: Search for old hot-path assumptions**

Run:

```bash
cd fanqie-workbench && rg "/api/accounts|capture-session|/api/books/.*/publish|remote_book_id|remote_id|account_id" src tests
```

Expected allowed matches:
- `remote_book_id` / `remote_id` only in legacy migration/backfill tests or compatibility code.
- `account_id` only in local legacy book compatibility or migration paths, not in new publish routes/runners/UI.
- `/api/accounts` only in tests that prove the old fake hot path is gone, or removed entirely.

- [ ] **Step 2: Remove or rewrite active hot-path uses**

Rewrite active uses to:
- `/api/platform-accounts`
- `/api/books/:bookId/publications`
- `/api/book-publications/:id/...`
- `platformBookId`
- `platformChapterId`

- [ ] **Step 3: Run focused regression suite**

```bash
cd fanqie-workbench && npx vitest run \
  tests/domain/publishing-model.test.ts \
  tests/db/multi-platform-schema.test.ts \
  tests/db/publications-repo.test.ts \
  tests/publish/platform-registry.test.ts \
  tests/server/platform-accounts-route.test.ts \
  tests/server/book-publications-route.test.ts \
  tests/web/multi-platform-workbench.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run full test suite if focused suite is green**

```bash
cd fanqie-workbench && npx vitest run
```

Expected: PASS or a clearly documented pre-existing failure unrelated to the publishing architecture shift.

---

## Execution order

1. Task 1 — align existing schema/types/repos with handoff.
2. Task 2 — add adapter contract/registry skeleton.
3. Task 3 — platform account routes.
4. Task 4 — Book-centered publication routes and summaries.
5. Task 5 — publication-centric planning/runner.
6. Task 6 — Fanqie first wiring only after skeleton exists.
7. Task 7 — BooksPage main workbench UI.
8. Task 8 — remove active single-platform assumptions.

Do not start Qimao/Qidian real platform implementation in this plan. They exist as skeleton adapters only.
