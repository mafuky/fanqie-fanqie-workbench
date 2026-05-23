import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { createAccount, getAccountById, getAccountCookies, getAccounts, updateAccountCookies } from '../../src/db/repositories/accounts-repo'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo'
import { createSession, getSessionById, updateSessionStatus, updateSessionPendingQuestion, appendSessionMessage, getSessionMessages } from '../../src/db/repositories/sessions-repo'
import { canTransition } from '../../src/domain/chapter'

const fixturesNovels = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/novels')

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-'))
  return resolve(dir, name)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('database persistence migrations', () => {
  it('adds missing cookie and remote id columns to an existing database', async () => {
    const databasePath = await createTempDatabasePath('legacy.sqlite')
    const legacyDb = new Database(databasePath)

    legacyDb.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'needs-login',
        last_checked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        account_id TEXT REFERENCES accounts(id)
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL DEFAULT '待写作',
        FOREIGN KEY (book_id) REFERENCES books(id)
      );
    `)
    legacyDb.close()

    const db = openDatabase(databasePath)

    const accountColumns = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
    const bookColumns = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>
    const chapterColumns = db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>

    expect(accountColumns.map((column) => column.name)).toContain('cookies_json')
    expect(bookColumns.map((column) => column.name)).toContain('remote_book_id')
    expect(chapterColumns.map((column) => column.name)).toContain('remote_id')

    db.close()
  })

  it('ignores duplicate-column errors when additive migration races with another opener', async () => {
    const actualOpenDatabase = openDatabase
    const clientModule = await import('../../src/db/client')

    const duplicateColumnError = Object.assign(new Error('duplicate column name: cookies_json'), {
      code: 'SQLITE_ERROR',
    })

    const openSpy = vi.spyOn(clientModule, 'openDatabase')
    const dbProto = Database.prototype as Database & {
      exec(sql: string): Database
    }
    const originalExec = dbProto.exec

    let injected = false
    const execSpy = vi.spyOn(dbProto, 'exec').mockImplementation(function (this: Database, sql: string) {
      if (!injected && sql === 'ALTER TABLE accounts ADD COLUMN cookies_json TEXT') {
        injected = true
        throw duplicateColumnError
      }
      return originalExec.call(this, sql)
    })

    expect(execSpy).toBeDefined()
    expect(openSpy).toBeDefined()

    const databasePath = await createTempDatabasePath('legacy-race.sqlite')
    const legacyDb = new Database(databasePath)

    legacyDb.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'needs-login',
        last_checked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        account_id TEXT REFERENCES accounts(id)
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL DEFAULT '待写作',
        FOREIGN KEY (book_id) REFERENCES books(id)
      );
    `)
    legacyDb.close()

    expect(() => actualOpenDatabase(databasePath)).not.toThrow()
  })
})

describe('accounts repo cookies persistence', () => {
  it('creates, updates, and reads cookies json for an account', () => {
    const db = openDatabase(':memory:')
    const account = createAccount(db, '番茄账号')

    expect(account.cookiesJson).toBeNull()
    expect(getAccountCookies(db, account.id)).toBeNull()

    const cookiesJson = JSON.stringify([{ name: 'sessionid', value: 'abc123' }])
    updateAccountCookies(db, account.id, cookiesJson)

    expect(getAccountCookies(db, account.id)).toBe(cookiesJson)
    expect(getAccountById(db, account.id)).toMatchObject({
      id: account.id,
      cookiesJson,
    })
    expect(getAccounts(db)).toEqual([
      expect.objectContaining({
        id: account.id,
        cookiesJson,
      }),
    ])

    db.close()
  })
})

describe('book sync persistence', () => {
  it('preserves account and remote book ids when re-syncing an existing book', async () => {
    const databasePath = await createTempDatabasePath('sync.sqlite')

    await syncWorkspaceBooks({ novelsRoot: fixturesNovels, databasePath })

    const db = new Database(databasePath)
    db.exec('ALTER TABLE books ADD COLUMN remote_book_id TEXT')
    db.close()

    const reopenedDb = openDatabase(databasePath)
    const existingBook = reopenedDb.prepare('SELECT id FROM books WHERE root_path = ?').get(resolve(fixturesNovels, '测试书')) as { id: string }
    const account = createAccount(reopenedDb, '已绑定账号')
    reopenedDb.prepare('UPDATE books SET account_id = ?, remote_book_id = ? WHERE id = ?').run(account.id, 'remote-book-1', existingBook.id)
    reopenedDb.close()

    await syncWorkspaceBooks({ novelsRoot: fixturesNovels, databasePath })

    const verifiedDb = openDatabase(databasePath)
    const syncedBook = verifiedDb.prepare('SELECT account_id, remote_book_id FROM books WHERE id = ?').get(existingBook.id) as {
      account_id: string | null
      remote_book_id: string | null
    }

    expect(syncedBook).toEqual({
      account_id: account.id,
      remote_book_id: 'remote-book-1',
    })

    verifiedDb.close()
  })

  it('preserves chapter stage and remote id when re-syncing an existing chapter', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-sync-'))
    const novelsRoot = resolve(dir, 'novels')
    const bookRoot = resolve(novelsRoot, '测试书')
    const chapterPath = resolve(bookRoot, '第001章_雾夜.md')
    await mkdir(bookRoot, { recursive: true })
    await writeFile(chapterPath, '# 第001章 雾夜\n\n正文\n', 'utf8')
    const databasePath = resolve(dir, 'chapter-sync.sqlite')

    await syncWorkspaceBooks({ novelsRoot, databasePath })

    const db = new Database(databasePath)
    db.exec('ALTER TABLE chapters ADD COLUMN remote_id TEXT')
    db.close()

    const reopenedDb = openDatabase(databasePath)
    const existingChapter = reopenedDb.prepare('SELECT id FROM chapters ORDER BY chapter_number LIMIT 1').get() as { id: string }
    reopenedDb.prepare('UPDATE chapters SET stage = ?, remote_id = ? WHERE id = ?').run('已发布', 'remote-chapter-1', existingChapter.id)
    reopenedDb.close()

    await syncWorkspaceBooks({ novelsRoot, databasePath })

    const verifiedDb = openDatabase(databasePath)
    const syncedChapter = verifiedDb.prepare('SELECT stage, remote_id FROM chapters WHERE id = ?').get(existingChapter.id) as {
      stage: string
      remote_id: string | null
    }

    expect(syncedChapter).toEqual({
      stage: '已发布',
      remote_id: 'remote-chapter-1',
    })

    verifiedDb.close()
  })
})

describe('sessions repo persistence', () => {
  it('persists session status, pending question, and messages', () => {
    const db = openDatabase(':memory:')
    const session = createSession(db, { kind: 'prompt' })

    updateSessionStatus(db, session.id, 'waiting-answer', 'chinese-novelist')
    updateSessionPendingQuestion(db, session.id, {
      question: '你想要创作什么题材的小说？',
      options: [{ label: '悬疑推理' }],
    })
    appendSessionMessage(db, session.id, {
      role: 'assistant',
      stream: 'question',
      content: '你想要创作什么题材的小说？',
    })

    const updated = getSessionById(db, session.id)
    const messages = getSessionMessages(db, session.id)

    expect(updated).toMatchObject({
      id: session.id,
      status: 'waiting-answer',
      currentSkill: 'chinese-novelist',
    })
    expect(updated?.pendingQuestionJson).toContain('悬疑推理')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      stream: 'question',
      content: '你想要创作什么题材的小说？',
    })

    db.close()
  })
})

describe('chapter transitions', () => {
  it('keeps canTransition forward-only for rollback-sensitive callers', () => {
    expect(canTransition('待写作', '已初稿')).toBe(true)
    expect(canTransition('已初稿', '待写作')).toBe(false)
    expect(canTransition('已发布', '可发布')).toBe(false)
  })
})
