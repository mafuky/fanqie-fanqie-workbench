# 番茄小说真实集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub account management and publishing with real Fanqie (番茄小说) author backend integration — login via Playwright or cookie paste, API-based health checks, HTTP API client for book/chapter CRUD, and real publish flow.

**Architecture:** API-first approach — Playwright only for user login (popup browser) and API discovery (request interception). All business operations (create book, upload chapter, sync status) use direct HTTP API calls with saved cookies. Two login paths: Playwright popup (primary) and cookie paste (fallback).

**Tech Stack:** Fastify, better-sqlite3, Playwright (runtime for login/recording), React 19, vitest

---

### Task 1: DB Schema + Domain Type Updates

**Files:**
- Modify: `fanqie-workbench/src/db/schema.ts`
- Modify: `fanqie-workbench/src/db/client.ts`
- Modify: `fanqie-workbench/src/domain/account.ts`
- Modify: `fanqie-workbench/src/domain/book.ts`
- Modify: `fanqie-workbench/src/domain/chapter.ts`
- Test: `fanqie-workbench/tests/smoke/schema-columns.test.ts`

- [ ] **Step 1: Write a failing test that verifies new columns exist**

```typescript
// tests/smoke/schema-columns.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { unlinkSync } from 'node:fs'

const TEST_DB = 'data/test-schema.sqlite'

describe('schema includes new columns', () => {
  afterEach(() => { try { unlinkSync(TEST_DB) } catch {} })

  it('accounts table has cookies_json column', () => {
    const db = openDatabase(TEST_DB)
    const info = db.prepare("PRAGMA table_info('accounts')").all() as Array<{ name: string }>
    db.close()
    expect(info.map((c) => c.name)).toContain('cookies_json')
  })

  it('books table has remote_book_id column', () => {
    const db = openDatabase(TEST_DB)
    const info = db.prepare("PRAGMA table_info('books')").all() as Array<{ name: string }>
    db.close()
    expect(info.map((c) => c.name)).toContain('remote_book_id')
  })

  it('chapters table has remote_id column', () => {
    const db = openDatabase(TEST_DB)
    const info = db.prepare("PRAGMA table_info('chapters')").all() as Array<{ name: string }>
    db.close()
    expect(info.map((c) => c.name)).toContain('remote_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/smoke/schema-columns.test.ts`
Expected: FAIL — columns don't exist yet

- [ ] **Step 3: Update schema.ts to add new columns**

In `fanqie-workbench/src/db/schema.ts`, add the columns to the CREATE TABLE statements:

```typescript
export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  profile_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'needs-login',
  cookies_json TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  account_id TEXT REFERENCES accounts(id),
  remote_book_id TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT '待写作',
  remote_id TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  book_id TEXT,
  chapter_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  chunk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
`
```

Note: Since `openDatabase` runs `CREATE TABLE IF NOT EXISTS`, existing databases won't get the new columns automatically. Add migration logic after the schema exec in `client.ts`:

```typescript
// src/db/client.ts
import Database from 'better-sqlite3'
import { schemaSql } from './schema.js'

export function openDatabase(path: string) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  migrateIfNeeded(db)
  return db
}

function migrateIfNeeded(db: Database.Database) {
  const accountCols = db.prepare("PRAGMA table_info('accounts')").all() as Array<{ name: string }>
  if (!accountCols.some((c) => c.name === 'cookies_json')) {
    db.exec('ALTER TABLE accounts ADD COLUMN cookies_json TEXT')
  }

  const bookCols = db.prepare("PRAGMA table_info('books')").all() as Array<{ name: string }>
  if (!bookCols.some((c) => c.name === 'remote_book_id')) {
    db.exec('ALTER TABLE books ADD COLUMN remote_book_id TEXT')
  }

  const chapterCols = db.prepare("PRAGMA table_info('chapters')").all() as Array<{ name: string }>
  if (!chapterCols.some((c) => c.name === 'remote_id')) {
    db.exec('ALTER TABLE chapters ADD COLUMN remote_id TEXT')
  }
}
```

- [ ] **Step 4: Update domain types**

`fanqie-workbench/src/domain/account.ts`:
```typescript
export type AccountStatus = 'active' | 'expired' | 'needs-login'

export type AccountRecord = {
  id: string
  label: string
  profilePath: string
  status: AccountStatus
  cookiesJson: string | null
  lastCheckedAt: string | null
  createdAt: string
}
```

`fanqie-workbench/src/domain/book.ts`:
```typescript
export type BookRecord = {
  id: string
  title: string
  rootPath: string
  accountId: string | null
  remoteBookId: string | null
}
```

Add `remoteId` to chapter types. In `fanqie-workbench/src/domain/chapter.ts`, add at the end of the file:
```typescript
export type ChapterRecord = {
  id: string
  bookId: string
  chapterNumber: number
  title: string
  sourcePath: string
  stage: ChapterStage
  remoteId: string | null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/smoke/schema-columns.test.ts`
Expected: PASS

- [ ] **Step 6: Run all existing tests to verify no regressions**

Run: `cd fanqie-workbench && npx vitest run`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
cd fanqie-workbench
git add src/db/schema.ts src/db/client.ts src/domain/account.ts src/domain/book.ts src/domain/chapter.ts tests/smoke/schema-columns.test.ts
git commit -m "feat: add schema columns for cookies, remote book/chapter IDs"
```

---

### Task 2: Cookie Store — Parse & Serialize

**Files:**
- Create: `fanqie-workbench/src/publish/cookie-store.ts`
- Test: `fanqie-workbench/tests/publish/cookie-store.test.ts`

- [ ] **Step 1: Write failing tests for cookie parsing**

```typescript
// tests/publish/cookie-store.test.ts
import { describe, expect, it } from 'vitest'
import { parseCookieString, parseCookieJson, serializeCookieHeader, type FanqieCookie } from '../../src/publish/cookie-store'

describe('cookie-store', () => {
  describe('parseCookieString', () => {
    it('parses semicolon-separated key=value pairs', () => {
      const result = parseCookieString('sessionid=abc123; token=xyz789', 'author.fanqie.com')
      expect(result).toEqual([
        { name: 'sessionid', value: 'abc123', domain: 'author.fanqie.com', path: '/' },
        { name: 'token', value: 'xyz789', domain: 'author.fanqie.com', path: '/' },
      ])
    })

    it('handles values with equals signs', () => {
      const result = parseCookieString('data=a=b=c; id=1', 'author.fanqie.com')
      expect(result[0].value).toBe('a=b=c')
    })

    it('trims whitespace', () => {
      const result = parseCookieString('  foo = bar ;  baz = qux  ', 'author.fanqie.com')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'foo', value: 'bar' })
    })

    it('returns empty array for empty string', () => {
      expect(parseCookieString('', 'author.fanqie.com')).toEqual([])
    })
  })

  describe('parseCookieJson', () => {
    it('parses JSON array of cookie objects', () => {
      const json = JSON.stringify([
        { name: 'sid', value: '123', domain: '.fanqie.com', path: '/' },
      ])
      const result = parseCookieJson(json)
      expect(result).toEqual([
        { name: 'sid', value: '123', domain: '.fanqie.com', path: '/' },
      ])
    })

    it('throws on invalid JSON', () => {
      expect(() => parseCookieJson('not json')).toThrow()
    })

    it('throws on non-array JSON', () => {
      expect(() => parseCookieJson('{"name":"a"}')).toThrow()
    })
  })

  describe('serializeCookieHeader', () => {
    it('serializes cookies to Cookie header format', () => {
      const cookies: FanqieCookie[] = [
        { name: 'a', value: '1', domain: 'd', path: '/' },
        { name: 'b', value: '2', domain: 'd', path: '/' },
      ]
      expect(serializeCookieHeader(cookies)).toBe('a=1; b=2')
    })

    it('returns empty string for empty array', () => {
      expect(serializeCookieHeader([])).toBe('')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/publish/cookie-store.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement cookie-store.ts**

```typescript
// src/publish/cookie-store.ts

export type FanqieCookie = {
  name: string
  value: string
  domain: string
  path: string
}

export function parseCookieString(raw: string, domain: string): FanqieCookie[] {
  if (!raw.trim()) return []

  return raw.split(';').map((pair) => {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) return null
    const name = pair.slice(0, eqIdx).trim()
    const value = pair.slice(eqIdx + 1).trim()
    if (!name) return null
    return { name, value, domain, path: '/' }
  }).filter((c): c is FanqieCookie => c !== null)
}

export function parseCookieJson(json: string): FanqieCookie[] {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) {
    throw new Error('Cookie JSON must be an array')
  }
  return parsed.map((c: any) => ({
    name: String(c.name),
    value: String(c.value),
    domain: String(c.domain || 'author.fanqie.com'),
    path: String(c.path || '/'),
  }))
}

export function serializeCookieHeader(cookies: FanqieCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/publish/cookie-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/publish/cookie-store.ts tests/publish/cookie-store.test.ts
git commit -m "feat: add cookie parse/serialize utilities"
```

---

### Task 3: Accounts Repo — Cookie CRUD

**Files:**
- Modify: `fanqie-workbench/src/db/repositories/accounts-repo.ts`
- Test: `fanqie-workbench/tests/db/accounts-repo-cookies.test.ts`

- [ ] **Step 1: Write failing tests for cookie storage**

```typescript
// tests/db/accounts-repo-cookies.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import {
  createAccount,
  getAccountById,
  updateAccountCookies,
  getAccountCookies,
} from '../../src/db/repositories/accounts-repo'
import { unlinkSync } from 'node:fs'

const TEST_DB = 'data/test-accounts-cookies.sqlite'

describe('accounts-repo cookie operations', () => {
  afterEach(() => { try { unlinkSync(TEST_DB) } catch {} })

  it('new accounts have null cookies_json', () => {
    const db = openDatabase(TEST_DB)
    const account = createAccount(db, '测试号')
    expect(account.cookiesJson).toBeNull()
    db.close()
  })

  it('stores and retrieves cookies', () => {
    const db = openDatabase(TEST_DB)
    const account = createAccount(db, '主号')
    const cookiesJson = JSON.stringify([{ name: 'sid', value: '123', domain: '.fanqie.com', path: '/' }])

    updateAccountCookies(db, account.id, cookiesJson)

    const stored = getAccountCookies(db, account.id)
    expect(stored).toBe(cookiesJson)

    const full = getAccountById(db, account.id)
    expect(full?.cookiesJson).toBe(cookiesJson)
    db.close()
  })

  it('returns null cookies for nonexistent account', () => {
    const db = openDatabase(TEST_DB)
    const cookies = getAccountCookies(db, 'nonexistent')
    expect(cookies).toBeNull()
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/db/accounts-repo-cookies.test.ts`
Expected: FAIL — `updateAccountCookies` and `getAccountCookies` not exported

- [ ] **Step 3: Add cookie methods to accounts-repo.ts**

Add these functions to `fanqie-workbench/src/db/repositories/accounts-repo.ts`:

```typescript
export function updateAccountCookies(db: Database.Database, id: string, cookiesJson: string) {
  db.prepare('UPDATE accounts SET cookies_json = ? WHERE id = ?').run(cookiesJson, id)
}

export function getAccountCookies(db: Database.Database, id: string): string | null {
  const row = db.prepare('SELECT cookies_json FROM accounts WHERE id = ?').get(id) as { cookies_json: string | null } | undefined
  return row?.cookies_json ?? null
}
```

Also update `createAccount` to return `cookiesJson: null` and update `getAccountById` / `getAccounts` to include `cookiesJson` in the mapping:

In `createAccount`, change the return to include `cookiesJson: null`.

In `getAccountById` and `getAccounts`, add `cookies_json` to the SELECT and map it to `cookiesJson` in the return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/db/accounts-repo-cookies.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd fanqie-workbench && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
cd fanqie-workbench
git add src/db/repositories/accounts-repo.ts tests/db/accounts-repo-cookies.test.ts
git commit -m "feat: add cookie CRUD to accounts repo"
```

---

### Task 4: FanqieApiClient — HTTP Client with Rate Limiting

**Files:**
- Create: `fanqie-workbench/src/publish/fanqie-api-client.ts`
- Test: `fanqie-workbench/tests/publish/fanqie-api-client.test.ts`

- [ ] **Step 1: Write failing tests for the API client**

```typescript
// tests/publish/fanqie-api-client.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { FanqieApiClient, SessionExpiredError, type FanqieCookie } from '../../src/publish/fanqie-api-client'

const TEST_COOKIES: FanqieCookie[] = [
  { name: 'sessionid', value: 'test123', domain: '.fanqie.com', path: '/' },
]

describe('FanqieApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends cookies in request header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    await client.checkSession()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(options.headers.Cookie).toBe('sessionid=test123')
  })

  it('checkSession returns true on success', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { user_id: '1' } }), { status: 200 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    const result = await client.checkSession()
    expect(result).toBe(true)
  })

  it('checkSession returns false on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    const result = await client.checkSession()
    expect(result).toBe(false)
  })

  it('getBookList throws SessionExpiredError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    await expect(client.getBookList()).rejects.toThrow(SessionExpiredError)
  })

  it('getBookList returns parsed book list', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: { book_list: [{ book_id: '111', book_name: '测试小说', word_count: 50000 }] },
    }), { status: 200 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    const books = await client.getBookList()
    expect(books).toEqual([{ bookId: '111', bookName: '测试小说', wordCount: 50000 }])
  })

  it('createChapter returns remote chapter id', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: { item_id: 'ch999' },
    }), { status: 200 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    const chapterId = await client.createChapter('book1', '第一章', '正文内容...')
    expect(chapterId).toBe('ch999')
  })

  it('enforces rate limiting between requests', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }))

    const client = new FanqieApiClient(TEST_COOKIES)
    const start = Date.now()
    await client.checkSession()
    await client.checkSession()
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(400) // at least ~500ms gap with some tolerance
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/publish/fanqie-api-client.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement FanqieApiClient**

```typescript
// src/publish/fanqie-api-client.ts
import { serializeCookieHeader, type FanqieCookie } from './cookie-store.js'

export type { FanqieCookie } from './cookie-store.js'

export class SessionExpiredError extends Error {
  constructor() { super('Session expired — please log in again') }
}

export type FanqieBook = {
  bookId: string
  bookName: string
  wordCount: number
}

export type FanqieChapter = {
  itemId: string
  title: string
  wordCount: number
}

export type CreateBookParams = {
  bookName: string
  genre?: string
  abstract?: string
}

const MIN_REQUEST_INTERVAL = 500

export class FanqieApiClient {
  private baseUrl = 'https://author.fanqie.com'
  private cookieHeader: string
  private lastRequestAt = 0

  constructor(private cookies: FanqieCookie[]) {
    this.cookieHeader = serializeCookieHeader(cookies)
  }

  async checkSession(): Promise<boolean> {
    try {
      const res = await this.request('/api/v1/author/book/list', { method: 'GET' }, true)
      return res.ok
    } catch {
      return false
    }
  }

  async getBookList(): Promise<FanqieBook[]> {
    const data = await this.requestJson('/api/v1/author/book/list')
    const list = data?.book_list ?? []
    return list.map((b: any) => ({
      bookId: String(b.book_id),
      bookName: String(b.book_name),
      wordCount: Number(b.word_count ?? 0),
    }))
  }

  async getBookInfo(bookId: string): Promise<any> {
    return this.requestJson(`/api/v1/author/book/info?book_id=${bookId}`)
  }

  async createBook(params: CreateBookParams): Promise<string> {
    const data = await this.requestJson('/api/v1/author/book/create', {
      method: 'POST',
      body: JSON.stringify({
        book_name: params.bookName,
        genre: params.genre ?? '',
        abstract: params.abstract ?? '',
      }),
    })
    return String(data.book_id)
  }

  async getChapterList(bookId: string): Promise<FanqieChapter[]> {
    const data = await this.requestJson(`/api/v1/author/chapter/list?book_id=${bookId}`)
    const list = data?.item_list ?? []
    return list.map((c: any) => ({
      itemId: String(c.item_id),
      title: String(c.title),
      wordCount: Number(c.word_count ?? 0),
    }))
  }

  async createChapter(bookId: string, title: string, content: string): Promise<string> {
    const data = await this.requestJson('/api/v1/author/chapter/create', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, title, content }),
    })
    return String(data.item_id)
  }

  async updateChapter(chapterId: string, title: string, content: string): Promise<void> {
    await this.requestJson('/api/v1/author/chapter/update', {
      method: 'POST',
      body: JSON.stringify({ item_id: chapterId, title, content }),
    })
  }

  private async requestJson(path: string, init?: RequestInit): Promise<any> {
    const res = await this.request(path, init, false)
    if (res.status === 401 || res.status === 302) {
      throw new SessionExpiredError()
    }
    const json = await res.json()
    if (json.code !== 0) {
      throw new Error(`Fanqie API error: code=${json.code} msg=${json.message ?? 'unknown'}`)
    }
    return json.data
  }

  private async request(path: string, init?: RequestInit, skipAuthCheck?: boolean): Promise<Response> {
    const now = Date.now()
    const wait = MIN_REQUEST_INTERVAL - (now - this.lastRequestAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastRequestAt = Date.now()

    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Cookie: this.cookieHeader,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      redirect: 'manual',
    })

    if (!skipAuthCheck && (res.status === 401 || res.status === 302)) {
      throw new SessionExpiredError()
    }

    return res
  }
}
```

**Note on API endpoints:** The paths like `/api/v1/author/book/list` are best guesses based on ByteDance platform conventions. These will be updated after the API recording step (Task 7). The response shape mappings (`book_list`, `item_id`, etc.) are also provisional and will be adjusted to match real responses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/publish/fanqie-api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/publish/fanqie-api-client.ts tests/publish/fanqie-api-client.test.ts
git commit -m "feat: add FanqieApiClient with rate limiting"
```

---

### Task 5: Session Health Check — API-Based

**Files:**
- Modify: `fanqie-workbench/src/publish/session-health.ts`
- Test: `fanqie-workbench/tests/publish/session-health.test.ts`

- [ ] **Step 1: Write failing tests for API-based health check**

```typescript
// tests/publish/session-health.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { checkSessionHealthViaApi } from '../../src/publish/session-health'

describe('checkSessionHealthViaApi', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns active when API responds successfully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { user_id: '1' } }), { status: 200 })
    ))

    const result = await checkSessionHealthViaApi('[{"name":"sid","value":"ok","domain":".fanqie.com","path":"/"}]')
    expect(result).toBe('active')
  })

  it('returns expired when API returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response('', { status: 401 })
    ))

    const result = await checkSessionHealthViaApi('[{"name":"sid","value":"bad","domain":".fanqie.com","path":"/"}]')
    expect(result).toBe('expired')
  })

  it('returns expired when cookies_json is null', async () => {
    const result = await checkSessionHealthViaApi(null)
    expect(result).toBe('expired')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/publish/session-health.test.ts`
Expected: FAIL — `checkSessionHealthViaApi` not exported

- [ ] **Step 3: Rewrite session-health.ts**

```typescript
// src/publish/session-health.ts
import { FanqieApiClient } from './fanqie-api-client.js'
import { parseCookieJson } from './cookie-store.js'

export async function checkSessionHealthViaApi(
  cookiesJson: string | null
): Promise<'active' | 'expired'> {
  if (!cookiesJson) return 'expired'

  try {
    const cookies = parseCookieJson(cookiesJson)
    const client = new FanqieApiClient(cookies)
    const ok = await client.checkSession()
    return ok ? 'active' : 'expired'
  } catch {
    return 'expired'
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/publish/session-health.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/publish/session-health.ts tests/publish/session-health.test.ts
git commit -m "feat: rewrite session health check to use API"
```

---

### Task 6: Account Session — Playwright Login with Cookie Extraction

**Files:**
- Modify: `fanqie-workbench/src/publish/account-session.ts`
- (No unit tests — this code directly drives a browser; tested via integration/manual)

- [ ] **Step 1: Install playwright as a runtime dependency**

Run: `cd fanqie-workbench && npm install playwright`

- [ ] **Step 2: Rewrite account-session.ts with login detection and cookie extraction**

```typescript
// src/publish/account-session.ts
import { FANQIE_AUTHOR_URL } from './fanqie-adapter.js'

export type LoginResult =
  | { ok: true; cookies: any[] }
  | { ok: false; reason: 'timeout' | 'error'; message: string }

export async function openLoginBrowser(profilePath: string): Promise<LoginResult> {
  const { chromium } = await import('playwright')

  let context
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      channel: 'chrome',
    })

    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(FANQIE_AUTHOR_URL)

    const loggedIn = await pollForLogin(page, 5 * 60 * 1000)

    if (!loggedIn) {
      await context.close()
      return { ok: false, reason: 'timeout', message: '登录超时（5分钟）' }
    }

    const cookies = await context.cookies()
    await context.close()

    return { ok: true, cookies }
  } catch (err) {
    try { await context?.close() } catch {}
    return { ok: false, reason: 'error', message: String(err) }
  }
}

async function pollForLogin(page: import('playwright').Page, timeoutMs: number): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const url = page.url()
    const isLoginPage = url.includes('login') || url.includes('passport')

    if (!isLoginPage && url.includes('author.fanqie.com')) {
      await page.waitForTimeout(1000)
      const urlAfterWait = page.url()
      if (!urlAfterWait.includes('login') && !urlAfterWait.includes('passport')) {
        return true
      }
    }

    await page.waitForTimeout(2000)
  }

  return false
}

export async function loadPublishContext(profilePath: string) {
  const { chromium } = await import('playwright')
  return chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: 'chrome',
  })
}
```

- [ ] **Step 3: Commit**

```bash
cd fanqie-workbench
git add src/publish/account-session.ts package.json package-lock.json
git commit -m "feat: rewrite login flow with cookie extraction and polling"
```

---

### Task 7: API Recorder — Playwright Request Interception

**Files:**
- Create: `fanqie-workbench/src/publish/api-recorder.ts`
- Test: `fanqie-workbench/tests/publish/api-recorder.test.ts`

- [ ] **Step 1: Write a failing test for the capture entry filtering logic**

The recorder itself needs a browser, but we can test the entry filtering/sanitization logic in isolation:

```typescript
// tests/publish/api-recorder.test.ts
import { describe, expect, it } from 'vitest'
import { shouldCaptureUrl, sanitizeEntry, type CapturedEntry } from '../../src/publish/api-recorder'

describe('api-recorder', () => {
  describe('shouldCaptureUrl', () => {
    it('captures /api/ URLs on author.fanqie.com', () => {
      expect(shouldCaptureUrl('https://author.fanqie.com/api/v1/book/list')).toBe(true)
    })

    it('ignores non-api URLs', () => {
      expect(shouldCaptureUrl('https://author.fanqie.com/static/main.js')).toBe(false)
    })

    it('ignores third-party URLs', () => {
      expect(shouldCaptureUrl('https://cdn.example.com/api/v1/track')).toBe(false)
    })
  })

  describe('sanitizeEntry', () => {
    it('strips cookie values from request headers', () => {
      const entry: CapturedEntry = {
        url: 'https://author.fanqie.com/api/v1/book/list',
        method: 'GET',
        requestHeaders: { Cookie: 'sessionid=secret123; token=abc', 'Content-Type': 'application/json' },
        requestBody: null,
        responseStatus: 200,
        responseBody: { code: 0 },
        timestamp: '2026-05-13T10:00:00Z',
      }
      const sanitized = sanitizeEntry(entry)
      expect(sanitized.requestHeaders.Cookie).toBe('sessionid=***; token=***')
      expect(sanitized.requestHeaders['Content-Type']).toBe('application/json')
    })

    it('truncates large response bodies', () => {
      const bigBody = 'x'.repeat(200_000)
      const entry: CapturedEntry = {
        url: 'https://author.fanqie.com/api/v1/data',
        method: 'GET',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseBody: bigBody,
        timestamp: '2026-05-13T10:00:00Z',
      }
      const sanitized = sanitizeEntry(entry)
      expect(JSON.stringify(sanitized.responseBody).length).toBeLessThan(110_000)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/publish/api-recorder.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement api-recorder.ts**

```typescript
// src/publish/api-recorder.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FANQIE_AUTHOR_URL } from './fanqie-adapter.js'

export type CapturedEntry = {
  url: string
  method: string
  requestHeaders: Record<string, string>
  requestBody: any
  responseStatus: number
  responseBody: any
  timestamp: string
}

export type CaptureSession = {
  entries: CapturedEntry[]
  stop: () => Promise<string>
}

const MAX_RESPONSE_SIZE = 100_000

export function shouldCaptureUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('fanqie.com') && parsed.pathname.includes('/api/')
  } catch {
    return false
  }
}

export function sanitizeEntry(entry: CapturedEntry): CapturedEntry {
  const headers = { ...entry.requestHeaders }
  if (headers.Cookie) {
    headers.Cookie = headers.Cookie.replace(/=([^;]+)/g, '=***')
  }

  let responseBody = entry.responseBody
  const bodyStr = JSON.stringify(responseBody)
  if (bodyStr && bodyStr.length > MAX_RESPONSE_SIZE) {
    responseBody = '[truncated — response too large]'
  }

  return { ...entry, requestHeaders: headers, responseBody }
}

export async function startRecording(profilePath: string): Promise<CaptureSession> {
  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: 'chrome',
  })

  const entries: CapturedEntry[] = []
  const page = context.pages()[0] ?? await context.newPage()

  page.on('response', async (response) => {
    const request = response.request()
    const url = request.url()

    if (!shouldCaptureUrl(url)) return

    try {
      let responseBody: any
      try {
        responseBody = await response.json()
      } catch {
        responseBody = await response.text().catch(() => null)
      }

      let requestBody: any = null
      if (request.postData()) {
        try { requestBody = JSON.parse(request.postData()!) } catch { requestBody = request.postData() }
      }

      const entry: CapturedEntry = {
        url,
        method: request.method(),
        requestHeaders: request.headers(),
        requestBody,
        responseStatus: response.status(),
        responseBody,
        timestamp: new Date().toISOString(),
      }
      entries.push(sanitizeEntry(entry))
    } catch {}
  })

  await page.goto(FANQIE_AUTHOR_URL)

  return {
    entries,
    stop: async () => {
      await context.close()
      const outDir = 'data/api-captures'
      mkdirSync(outDir, { recursive: true })
      const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const outPath = join(outDir, filename)
      writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), entries }, null, 2))
      return outPath
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/publish/api-recorder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/publish/api-recorder.ts tests/publish/api-recorder.test.ts
git commit -m "feat: add API recorder with request interception"
```

---

### Task 8: Publish Runner — Real Publish Flow

**Files:**
- Modify: `fanqie-workbench/src/publish/publish-runner.ts`
- Test: `fanqie-workbench/tests/publish/publish-runner.test.ts`

- [ ] **Step 1: Write failing tests for the publish flow**

```typescript
// tests/publish/publish-runner.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { runPublishJob, type PublishInput, type PublishResult } from '../../src/publish/publish-runner'

describe('runPublishJob', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('creates remote book if no remote_book_id exists', async () => {
    const mockClient = {
      checkSession: vi.fn().mockResolvedValue(true),
      createBook: vi.fn().mockResolvedValue('remote-book-1'),
      createChapter: vi.fn().mockResolvedValue('remote-ch-1'),
      updateChapter: vi.fn(),
    }

    const input: PublishInput = {
      client: mockClient as any,
      bookTitle: '测试小说',
      remoteBookId: null,
      chapters: [
        { id: 'ch1', chapterNumber: 1, title: '第一章', content: '内容...', remoteId: null },
      ],
    }

    const result = await runPublishJob(input)
    expect(result.remoteBookId).toBe('remote-book-1')
    expect(mockClient.createBook).toHaveBeenCalledWith({ bookName: '测试小说' })
  })

  it('skips book creation if remote_book_id exists', async () => {
    const mockClient = {
      checkSession: vi.fn().mockResolvedValue(true),
      createBook: vi.fn(),
      createChapter: vi.fn().mockResolvedValue('remote-ch-1'),
      updateChapter: vi.fn(),
    }

    const input: PublishInput = {
      client: mockClient as any,
      bookTitle: '测试小说',
      remoteBookId: 'existing-remote-book',
      chapters: [
        { id: 'ch1', chapterNumber: 1, title: '第一章', content: '内容...', remoteId: null },
      ],
    }

    const result = await runPublishJob(input)
    expect(result.remoteBookId).toBe('existing-remote-book')
    expect(mockClient.createBook).not.toHaveBeenCalled()
  })

  it('creates new chapters and updates existing ones', async () => {
    const mockClient = {
      checkSession: vi.fn().mockResolvedValue(true),
      createBook: vi.fn(),
      createChapter: vi.fn().mockResolvedValue('new-remote-ch'),
      updateChapter: vi.fn(),
    }

    const input: PublishInput = {
      client: mockClient as any,
      bookTitle: '测试小说',
      remoteBookId: 'book1',
      chapters: [
        { id: 'ch1', chapterNumber: 1, title: '第一章', content: '新内容', remoteId: null },
        { id: 'ch2', chapterNumber: 2, title: '第二章', content: '更新内容', remoteId: 'existing-remote-ch2' },
      ],
    }

    const result = await runPublishJob(input)
    expect(mockClient.createChapter).toHaveBeenCalledOnce()
    expect(mockClient.updateChapter).toHaveBeenCalledOnce()
    expect(result.chapters[0].remoteId).toBe('new-remote-ch')
    expect(result.chapters[1].remoteId).toBe('existing-remote-ch2')
  })

  it('handles partial failures gracefully', async () => {
    const mockClient = {
      checkSession: vi.fn().mockResolvedValue(true),
      createBook: vi.fn(),
      createChapter: vi.fn()
        .mockResolvedValueOnce('remote-ch-1')
        .mockRejectedValueOnce(new Error('API error')),
      updateChapter: vi.fn(),
    }

    const input: PublishInput = {
      client: mockClient as any,
      bookTitle: '测试',
      remoteBookId: 'book1',
      chapters: [
        { id: 'ch1', chapterNumber: 1, title: '第一章', content: 'a', remoteId: null },
        { id: 'ch2', chapterNumber: 2, title: '第二章', content: 'b', remoteId: null },
      ],
    }

    const result = await runPublishJob(input)
    expect(result.chapters[0].status).toBe('success')
    expect(result.chapters[1].status).toBe('failed')
    expect(result.chapters[1].error).toContain('API error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/publish/publish-runner.test.ts`
Expected: FAIL — `runPublishJob` not exported / different signature

- [ ] **Step 3: Rewrite publish-runner.ts**

```typescript
// src/publish/publish-runner.ts
import type { FanqieApiClient } from './fanqie-api-client.js'

export type ChapterInput = {
  id: string
  chapterNumber: number
  title: string
  content: string
  remoteId: string | null
}

export type PublishInput = {
  client: FanqieApiClient
  bookTitle: string
  remoteBookId: string | null
  chapters: ChapterInput[]
}

export type ChapterResult = {
  id: string
  remoteId: string | null
  status: 'success' | 'failed'
  error?: string
}

export type PublishResult = {
  remoteBookId: string
  chapters: ChapterResult[]
}

export async function runPublishJob(input: PublishInput): Promise<PublishResult> {
  let remoteBookId = input.remoteBookId

  if (!remoteBookId) {
    remoteBookId = await input.client.createBook({ bookName: input.bookTitle })
  }

  const chapters: ChapterResult[] = []

  for (const ch of input.chapters) {
    try {
      if (ch.remoteId) {
        await input.client.updateChapter(ch.remoteId, ch.title, ch.content)
        chapters.push({ id: ch.id, remoteId: ch.remoteId, status: 'success' })
      } else {
        const newRemoteId = await input.client.createChapter(remoteBookId, ch.title, ch.content)
        chapters.push({ id: ch.id, remoteId: newRemoteId, status: 'success' })
      }
    } catch (err) {
      chapters.push({
        id: ch.id,
        remoteId: ch.remoteId,
        status: 'failed',
        error: String(err),
      })
    }
  }

  return { remoteBookId, chapters }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/publish/publish-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/publish/publish-runner.ts tests/publish/publish-runner.test.ts
git commit -m "feat: rewrite publish runner with real API client"
```

---

### Task 9: Server Routes — Accounts (Login, Cookie Import, Health Check, Recording)

**Files:**
- Modify: `fanqie-workbench/src/server/routes/accounts.ts`
- Test: `fanqie-workbench/tests/server/accounts-route.test.ts`

- [ ] **Step 1: Write failing tests for new account endpoints**

```typescript
// tests/server/accounts-route.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildServer } from '../../src/server/app'

describe('accounts route', () => {
  it('lists accounts', async () => {
    const app = await buildServer()
    const response = await app.inject({ method: 'GET', url: '/api/accounts' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('creates an account', async () => {
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { label: '主号' }
    })
    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.cookiesJson).toBeNull()
    await app.close()
  })

  it('imports cookies via string format', async () => {
    const app = await buildServer()
    const createRes = await app.inject({ method: 'POST', url: '/api/accounts', payload: { label: 'cookie测试' } })
    const accountId = JSON.parse(createRes.body).id

    // Mock the health check to not hit real API
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))

    const importRes = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/import-cookies`,
      payload: { cookies: 'sessionid=abc; token=xyz', format: 'string' },
    })

    expect(importRes.statusCode).toBe(200)
    const body = JSON.parse(importRes.body)
    expect(body.cookiesImported).toBe(true)

    vi.restoreAllMocks()
    await app.close()
  })

  it('checks health and updates status', async () => {
    const app = await buildServer()
    const createRes = await app.inject({ method: 'POST', url: '/api/accounts', payload: { label: '检查测试' } })
    const accountId = JSON.parse(createRes.body).id

    const healthRes = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/check-health`,
    })

    expect(healthRes.statusCode).toBe(200)
    const body = JSON.parse(healthRes.body)
    // No cookies → expired
    expect(body.status).toBe('expired')
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/server/accounts-route.test.ts`
Expected: Some tests FAIL — new endpoints not implemented

- [ ] **Step 3: Rewrite accounts.ts with all new endpoints**

```typescript
// src/server/routes/accounts.ts
import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import {
  createAccount, getAccounts, getAccountById,
  updateAccountLabel, updateAccountStatus, deleteAccount,
  updateAccountCookies, getAccountCookies,
} from '../../db/repositories/accounts-repo.js'
import type { AccountStatus } from '../../domain/account.js'
import { parseCookieString, parseCookieJson } from '../../publish/cookie-store.js'
import { checkSessionHealthViaApi } from '../../publish/session-health.js'
import { openLoginBrowser } from '../../publish/account-session.js'

const DB_PATH = process.env.WORKBENCH_DB || 'data/workbench.sqlite'

let activeRecordingSession: any = null

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => {
    const db = openDatabase(DB_PATH)
    const accounts = getAccounts(db)
    db.close()
    return { accounts }
  })

  app.post<{ Body: { label: string } }>('/api/accounts', async (request, reply) => {
    const { label } = request.body || {} as any
    if (!label) return reply.code(400).send({ error: 'label is required' })
    const db = openDatabase(DB_PATH)
    const account = createAccount(db, label)
    db.close()
    return reply.code(201).send(account)
  })

  app.put<{ Params: { id: string }; Body: { label?: string; status?: AccountStatus } }>(
    '/api/accounts/:id',
    async (request, reply) => {
      const { id } = request.params
      const { label, status } = request.body || {} as any
      const db = openDatabase(DB_PATH)
      const existing = getAccountById(db, id)
      if (!existing) { db.close(); return reply.code(404).send({ error: 'account not found' }) }
      if (label) updateAccountLabel(db, id, label)
      if (status) updateAccountStatus(db, id, status)
      const updated = getAccountById(db, id)
      db.close()
      return updated
    }
  )

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    const { id } = request.params
    const db = openDatabase(DB_PATH)
    deleteAccount(db, id)
    db.close()
    return reply.code(204).send()
  })

  // Playwright popup login
  app.post<{ Params: { id: string } }>('/api/accounts/:id/login-session', async (request, reply) => {
    const { id } = request.params
    const db = openDatabase(DB_PATH)
    const account = getAccountById(db, id)
    if (!account) { db.close(); return reply.code(404).send({ error: 'account not found' }) }

    updateAccountStatus(db, id, 'needs-login')

    const result = await openLoginBrowser(account.profilePath)

    if (result.ok) {
      const cookiesJson = JSON.stringify(result.cookies)
      updateAccountCookies(db, id, cookiesJson)
      updateAccountStatus(db, id, 'active')
      db.close()
      return { loggedIn: true, accountId: id }
    }

    db.close()
    return reply.code(408).send({ loggedIn: false, reason: result.reason, message: result.message })
  })

  // Cookie import (paste)
  app.post<{ Params: { id: string }; Body: { cookies: string; format?: 'string' | 'json' } }>(
    '/api/accounts/:id/import-cookies',
    async (request, reply) => {
      const { id } = request.params
      const { cookies: raw, format = 'string' } = request.body || {} as any
      if (!raw) return reply.code(400).send({ error: 'cookies is required' })

      const db = openDatabase(DB_PATH)
      const account = getAccountById(db, id)
      if (!account) { db.close(); return reply.code(404).send({ error: 'account not found' }) }

      try {
        const parsed = format === 'json'
          ? parseCookieJson(raw)
          : parseCookieString(raw, 'author.fanqie.com')
        const cookiesJson = JSON.stringify(parsed)
        updateAccountCookies(db, id, cookiesJson)

        const health = await checkSessionHealthViaApi(cookiesJson)
        updateAccountStatus(db, id, health)
        db.close()
        return { cookiesImported: true, cookieCount: parsed.length, status: health }
      } catch (err) {
        db.close()
        return reply.code(400).send({ error: `Failed to parse cookies: ${err}` })
      }
    }
  )

  // Health check
  app.post<{ Params: { id: string } }>('/api/accounts/:id/check-health', async (request, reply) => {
    const { id } = request.params
    const db = openDatabase(DB_PATH)
    const account = getAccountById(db, id)
    if (!account) { db.close(); return reply.code(404).send({ error: 'account not found' }) }

    const cookiesJson = getAccountCookies(db, id)
    const health = await checkSessionHealthViaApi(cookiesJson)
    updateAccountStatus(db, id, health)
    db.close()
    return { status: health }
  })

  // Start API recording
  app.post<{ Params: { id: string } }>('/api/accounts/:id/start-recording', async (request, reply) => {
    const { id } = request.params
    if (activeRecordingSession) {
      return reply.code(409).send({ error: 'A recording session is already active' })
    }

    const db = openDatabase(DB_PATH)
    const account = getAccountById(db, id)
    db.close()
    if (!account) return reply.code(404).send({ error: 'account not found' })

    const { startRecording } = await import('../../publish/api-recorder.js')
    activeRecordingSession = await startRecording(account.profilePath)
    return { recording: true, accountId: id }
  })

  // Stop API recording
  app.post('/api/accounts/stop-recording', async (request, reply) => {
    if (!activeRecordingSession) {
      return reply.code(404).send({ error: 'No active recording session' })
    }

    const outPath = await activeRecordingSession.stop()
    const entryCount = activeRecordingSession.entries.length
    activeRecordingSession = null
    return { stopped: true, capturedEntries: entryCount, outputPath: outPath }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/server/accounts-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd fanqie-workbench
git add src/server/routes/accounts.ts tests/server/accounts-route.test.ts
git commit -m "feat: add real login, cookie import, health check, recording endpoints"
```

---

### Task 10: Server Routes — Books (Publish, Sync)

**Files:**
- Modify: `fanqie-workbench/src/server/routes/books.ts`
- Test: `fanqie-workbench/tests/server/books-publish.test.ts`

- [ ] **Step 1: Write failing tests for publish and sync endpoints**

```typescript
// tests/server/books-publish.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildServer } from '../../src/server/app'
import { openDatabase } from '../../src/db/client'

const DB_PATH = process.env.WORKBENCH_DB || 'data/workbench.sqlite'

describe('books publish route', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns 400 if book has no account_id', async () => {
    const app = await buildServer()
    const db = openDatabase(DB_PATH)
    db.prepare("INSERT OR REPLACE INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/test')").run()
    db.close()

    const res = await app.inject({ method: 'POST', url: '/api/books/b1/publish' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('account')
    await app.close()
  })

  it('returns 400 if account has no cookies', async () => {
    const app = await buildServer()
    const db = openDatabase(DB_PATH)
    db.prepare("INSERT OR REPLACE INTO accounts (id, label, profile_path, status, created_at) VALUES ('a1', 'test', 'data/p/a1', 'active', '2026-01-01')").run()
    db.prepare("INSERT OR REPLACE INTO books (id, title, root_path, account_id) VALUES ('b2', '测试书2', '/tmp/test2', 'a1')").run()
    db.close()

    const res = await app.inject({ method: 'POST', url: '/api/books/b2/publish' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('cookie')
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fanqie-workbench && npx vitest run tests/server/books-publish.test.ts`
Expected: FAIL — `/api/books/:id/publish` not implemented

- [ ] **Step 3: Add publish and sync-remote endpoints to books.ts**

Add these routes inside `registerBookRoutes` in `fanqie-workbench/src/server/routes/books.ts`:

```typescript
  // Publish chapters to Fanqie
  app.post<{ Params: { bookId: string } }>('/api/books/:bookId/publish', async (request, reply) => {
    const { bookId } = request.params
    const db = openDatabase(DB_PATH)

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any
    if (!book) { db.close(); return reply.code(404).send({ error: 'book not found' }) }
    if (!book.account_id) { db.close(); return reply.code(400).send({ error: 'Book has no bound account' }) }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(book.account_id) as any
    if (!account?.cookies_json) { db.close(); return reply.code(400).send({ error: 'Account has no cookies — please log in first' }) }

    const chapters = db.prepare(
      "SELECT id, chapter_number, title, source_path, stage, remote_id FROM chapters WHERE book_id = ? AND stage = '可发布' ORDER BY chapter_number"
    ).all(bookId) as Array<{ id: string; chapter_number: number; title: string; source_path: string; stage: string; remote_id: string | null }>

    if (chapters.length === 0) { db.close(); return reply.code(400).send({ error: 'No publishable chapters (stage 可发布)' }) }

    const { parseCookieJson } = await import('../../publish/cookie-store.js')
    const { FanqieApiClient } = await import('../../publish/fanqie-api-client.js')
    const { runPublishJob } = await import('../../publish/publish-runner.js')
    const { readFileSync } = await import('node:fs')

    const cookies = parseCookieJson(account.cookies_json)
    const client = new FanqieApiClient(cookies)

    const chapterInputs = chapters.map((ch) => {
      let content = ''
      try { content = readFileSync(ch.source_path, 'utf-8') } catch {}
      return {
        id: ch.id,
        chapterNumber: ch.chapter_number,
        title: ch.title,
        content,
        remoteId: ch.remote_id,
      }
    })

    const result = await runPublishJob({
      client,
      bookTitle: book.title,
      remoteBookId: book.remote_book_id ?? null,
      chapters: chapterInputs,
    })

    // Save remote IDs back to database
    if (result.remoteBookId && result.remoteBookId !== book.remote_book_id) {
      db.prepare('UPDATE books SET remote_book_id = ? WHERE id = ?').run(result.remoteBookId, bookId)
    }

    for (const ch of result.chapters) {
      if (ch.status === 'success' && ch.remoteId) {
        db.prepare('UPDATE chapters SET remote_id = ?, stage = ? WHERE id = ?').run(ch.remoteId, '已发布', ch.id)
      }
    }

    db.close()

    return {
      remoteBookId: result.remoteBookId,
      published: result.chapters.filter((c) => c.status === 'success').length,
      failed: result.chapters.filter((c) => c.status === 'failed').length,
      chapters: result.chapters,
    }
  })

  // Sync remote status
  app.post<{ Params: { bookId: string } }>('/api/books/:bookId/sync-remote', async (request, reply) => {
    const { bookId } = request.params
    const db = openDatabase(DB_PATH)

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any
    if (!book) { db.close(); return reply.code(404).send({ error: 'book not found' }) }
    if (!book.remote_book_id) { db.close(); return reply.code(400).send({ error: 'Book has no remote_book_id' }) }
    if (!book.account_id) { db.close(); return reply.code(400).send({ error: 'Book has no bound account' }) }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(book.account_id) as any
    if (!account?.cookies_json) { db.close(); return reply.code(400).send({ error: 'Account has no cookies' }) }

    const { parseCookieJson } = await import('../../publish/cookie-store.js')
    const { FanqieApiClient } = await import('../../publish/fanqie-api-client.js')

    const cookies = parseCookieJson(account.cookies_json)
    const client = new FanqieApiClient(cookies)

    const remoteChapters = await client.getChapterList(book.remote_book_id)

    db.close()
    return { remoteBookId: book.remote_book_id, remoteChapters }
  })
```

Also add the necessary imports at the top of books.ts:

```typescript
import { readFileSync } from 'node:fs'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fanqie-workbench && npx vitest run tests/server/books-publish.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd fanqie-workbench && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
cd fanqie-workbench
git add src/server/routes/books.ts tests/server/books-publish.test.ts
git commit -m "feat: add publish and sync-remote endpoints for books"
```

---

### Task 11: Frontend — Accounts Page Redesign

**Files:**
- Modify: `fanqie-workbench/src/web/pages/accounts-page.tsx`

- [ ] **Step 1: Rewrite accounts-page.tsx with login, cookie import, and health check**

```tsx
// src/web/pages/accounts-page.tsx
import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Input } from '../components/ui/input.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { Table } from '../components/ui/table.js'
import { Confirm, Modal } from '../components/ui/modal.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize } from '../styles/tokens.js'

type Account = {
  id: string
  label: string
  status: string
  cookiesJson: string | null
  lastCheckedAt: string | null
  createdAt: string
}

const statusBadge: Record<string, { variant: 'success' | 'error' | 'warning'; label: string }> = {
  active: { variant: 'success', label: '已登录' },
  expired: { variant: 'error', label: '已过期' },
  'needs-login': { variant: 'warning', label: '需登录' },
}

function relativeTime(iso: string | null): string {
  if (!iso) return '从未'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [cookieModalAccount, setCookieModalAccount] = useState<Account | null>(null)
  const [cookieText, setCookieText] = useState('')
  const [importingCookies, setImportingCookies] = useState(false)
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null)
  const toast = useToast()

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
    } catch {
      toast.error('加载账号失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleAdd = useCallback(async () => {
    if (!newLabel.trim()) return
    setAdding(true)
    try {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim() }),
      })
      setNewLabel('')
      toast.success('账号已添加')
      await loadAccounts()
    } catch { toast.error('添加失败') }
    finally { setAdding(false) }
  }, [newLabel, loadAccounts, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/accounts/${deleteTarget.id}`, { method: 'DELETE' })
      toast.success('账号已删除')
      setDeleteTarget(null)
      await loadAccounts()
    } catch { toast.error('删除失败') }
    finally { setDeleting(false) }
  }, [deleteTarget, loadAccounts, toast])

  const handleLogin = useCallback(async (id: string) => {
    setLoggingIn(id)
    toast.success('浏览器已打开，请在浏览器中登录番茄作者后台...')
    try {
      const res = await fetch(`/api/accounts/${id}/login-session`, { method: 'POST' })
      if (res.ok) {
        toast.success('登录成功！')
      } else {
        const data = await res.json()
        toast.error(data.message || '登录失败')
      }
      await loadAccounts()
    } catch { toast.error('登录请求失败') }
    finally { setLoggingIn(null) }
  }, [loadAccounts, toast])

  const handleImportCookies = useCallback(async () => {
    if (!cookieModalAccount || !cookieText.trim()) return
    setImportingCookies(true)
    try {
      const isJson = cookieText.trim().startsWith('[')
      const res = await fetch(`/api/accounts/${cookieModalAccount.id}/import-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieText.trim(), format: isJson ? 'json' : 'string' }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`已导入 ${data.cookieCount} 个 Cookie，状态: ${data.status === 'active' ? '有效' : '无效'}`)
        setCookieModalAccount(null)
        setCookieText('')
        await loadAccounts()
      } else {
        toast.error(data.error || '导入失败')
      }
    } catch { toast.error('导入失败') }
    finally { setImportingCookies(false) }
  }, [cookieModalAccount, cookieText, loadAccounts, toast])

  const handleCheckHealth = useCallback(async (id: string) => {
    setCheckingHealth(id)
    try {
      const res = await fetch(`/api/accounts/${id}/check-health`, { method: 'POST' })
      const data = await res.json()
      toast.success(`状态: ${data.status === 'active' ? '有效' : '已过期'}`)
      await loadAccounts()
    } catch { toast.error('检查失败') }
    finally { setCheckingHealth(null) }
  }, [loadAccounts, toast])

  const columns = [
    {
      key: 'label',
      label: '标签',
      render: (row: Account) => <span style={{ fontWeight: 500 }}>{row.label}</span>,
    },
    {
      key: 'status',
      label: '状态',
      width: 100,
      render: (row: Account) => {
        const s = statusBadge[row.status] || statusBadge['needs-login']
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    {
      key: 'lastCheckedAt',
      label: '最后检查',
      width: 120,
      render: (row: Account) => (
        <span style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>
          {relativeTime(row.lastCheckedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      width: 280,
      render: (row: Account) => (
        <div style={{ display: 'flex', gap: spacing.sm - 2, flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleLogin(row.id)}
            loading={loggingIn === row.id}
            disabled={!!loggingIn}
          >
            登录
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setCookieModalAccount(row); setCookieText('') }}>
            粘贴Cookie
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleCheckHealth(row.id)}
            loading={checkingHealth === row.id}
          >
            检查
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="账号管理" description="管理番茄小说发布账号与登录态" />

      <Card style={{ marginBottom: spacing.xl, display: 'flex', gap: spacing.md - 2, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="输入账号标签，如：主号、小号A..."
          />
        </div>
        <Button onClick={handleAdd} disabled={!newLabel.trim()} loading={adding}>
          + 添加账号
        </Button>
      </Card>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <Table
          columns={columns}
          data={accounts}
          rowKey={(row) => row.id}
          emptyTitle="暂无账号"
          emptyIcon="◎"
        />
      )}

      <Confirm
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="删除账号"
        description={`确定要删除账号「${deleteTarget?.label || ''}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        loading={deleting}
      />

      {/* Cookie Import Modal */}
      <Modal
        open={!!cookieModalAccount}
        onClose={() => setCookieModalAccount(null)}
        title={`粘贴 Cookie — ${cookieModalAccount?.label || ''}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <p style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', margin: 0 }}>
            从浏览器 DevTools → Application → Cookies 复制 cookie，支持两种格式：
          </p>
          <p style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', margin: 0 }}>
            格式1: <code>key=value; key2=value2</code><br/>
            格式2: JSON 数组 <code>[{'{'}name, value, domain, path{'}'}]</code>
          </p>
          <textarea
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder="粘贴 cookie 内容..."
            rows={6}
            style={{
              width: '100%',
              padding: spacing.md,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              fontSize: fontSize.sm,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
            <Button variant="secondary" onClick={() => setCookieModalAccount(null)}>取消</Button>
            <Button
              onClick={handleImportCookies}
              disabled={!cookieText.trim()}
              loading={importingCookies}
            >
              导入并验证
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
```

**Note:** This uses a `Modal` component. Check if it exists — the codebase has a `Confirm` modal in `src/web/components/ui/modal.tsx`. If `Modal` is not exported, you'll need to add a basic `Modal` wrapper or use `Confirm` with custom children. Read `modal.tsx` first and adapt.

- [ ] **Step 2: Verify Modal component exists or create it**

Read `fanqie-workbench/src/web/components/ui/modal.tsx` and check if a generic `Modal` is exported. If only `Confirm` exists, add a simple `Modal` export that wraps the dialog logic with `children` instead of `description`/`confirmLabel`.

- [ ] **Step 3: Start dev server and test in browser**

Run: `cd fanqie-workbench && npm run dev`

Test:
- Navigate to accounts page
- Add a new account — verify it appears with 「需登录」status
- Click 「检查」— should show 「已过期」(no cookies)
- Click 「粘贴Cookie」— modal should appear
- Click 「删除」— confirm dialog should work

- [ ] **Step 4: Commit**

```bash
cd fanqie-workbench
git add src/web/pages/accounts-page.tsx src/web/components/ui/modal.tsx
git commit -m "feat: redesign accounts page with login, cookie import, health check"
```

---

### Task 12: Frontend — Books Page Publish Integration

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`

- [ ] **Step 1: Add publish button, remote status badge, and sync button to books page**

Add these changes to the existing `BooksPage` component in `fanqie-workbench/src/web/pages/books-page.tsx`:

1. Update the `BookWithChapters` type to include `remote_book_id`:
```typescript
type BookWithChapters = {
  id: string
  title: string
  root_path: string
  account_id: string | null
  remote_book_id: string | null
  chapters: ChapterRow[]
}
```

2. Update `ChapterRow` to include `remote_id`:
```typescript
type ChapterRow = {
  id: string
  chapter_number: number
  title: string
  stage: ChapterStage
  remote_id: string | null
}
```

3. Add state for publishing:
```typescript
const [publishing, setPublishing] = useState<string | null>(null)
const [syncing, setSyncing] = useState<string | null>(null)
```

4. Add publish handler:
```typescript
const handlePublish = useCallback(async (bookId: string) => {
  setPublishing(bookId)
  try {
    const res = await fetch(`/api/books/${bookId}/publish`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      toast.success(`发布完成：成功 ${data.published} 章，失败 ${data.failed} 章`)
      await loadBooks()
    } else {
      toast.error(data.error || '发布失败')
    }
  } catch {
    toast.error('发布请求失败')
  } finally {
    setPublishing(null)
  }
}, [loadBooks, toast])

const handleSync = useCallback(async (bookId: string) => {
  setSyncing(bookId)
  try {
    const res = await fetch(`/api/books/${bookId}/sync-remote`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      toast.success(`同步完成：远程 ${data.remoteChapters.length} 章`)
    } else {
      toast.error(data.error || '同步失败')
    }
  } catch {
    toast.error('同步请求失败')
  } finally {
    setSyncing(null)
  }
}, [toast])
```

5. In the book header area, add remote status badge and action buttons:
```tsx
{/* After the existing badges in the book header */}
{book.remote_book_id ? (
  <Badge variant="success">已关联</Badge>
) : (
  <Badge variant="neutral">未关联</Badge>
)}

{/* Add publish/sync buttons in the expanded section, before the stage filter tabs */}
<div style={{
  padding: `${spacing.md}px ${spacing.xl}px`,
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  gap: spacing.sm,
}}>
  <Button
    variant="primary"
    size="sm"
    onClick={() => handlePublish(book.id)}
    loading={publishing === book.id}
    disabled={!book.account_id || book.chapters.filter((c) => c.stage === '可发布').length === 0}
  >
    发布到番茄 ({book.chapters.filter((c) => c.stage === '可发布').length} 章)
  </Button>
  {book.remote_book_id && (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => handleSync(book.id)}
      loading={syncing === book.id}
    >
      同步状态
    </Button>
  )}
</div>
```

6. In the chapter rows, add a remote indicator for published chapters:
```tsx
{/* After the stage badge in chapter row */}
{ch.remote_id && (
  <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>远程</span>
)}
```

- [ ] **Step 2: Start dev server and test in browser**

Run: `cd fanqie-workbench && npm run dev`

Test:
- Navigate to books page
- Verify 「未关联」badge appears on books without remote_book_id
- Expand a book — verify 「发布到番茄」button appears
- Button should be disabled if no 「可发布」chapters or no account bound

- [ ] **Step 3: Commit**

```bash
cd fanqie-workbench
git add src/web/pages/books-page.tsx
git commit -m "feat: add publish and sync buttons to books page"
```

---

### Task 13: Integration Verification & Cleanup

**Files:**
- Various — no new files

- [ ] **Step 1: Run the full test suite**

Run: `cd fanqie-workbench && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify .gitignore includes data/ directory**

Check that `data/` is in `.gitignore`. If not, add it:
```
data/
```

This prevents browser profiles, API captures, and the SQLite database from being committed.

- [ ] **Step 3: Start both server and frontend, smoke test the full flow**

Run: `cd fanqie-workbench && npm run dev:all`

Manual test flow:
1. Open http://localhost:5173
2. Go to accounts page → add an account
3. Click 「检查」→ should show expired (no cookies)
4. Go to books page → verify books load
5. Verify the publish button is disabled (no account bound / no cookies)

- [ ] **Step 4: Commit any fixes**

```bash
cd fanqie-workbench
git add -A
git commit -m "chore: integration verification and cleanup"
```
