import Database from 'better-sqlite3'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'

async function tempDb(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-multi-'))
  return resolve(dir, name)
}

describe('multi-platform schema', () => {
  it('creates the canonical multi-platform tables without legacy remote columns on fresh databases', async () => {
    const path = await tempDb('fresh.sqlite')
    const db = openDatabase(path)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const names = tables.map((row) => row.name)
    const bookColumns = (db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>).map((column) => column.name)
    const chapterColumns = (db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>).map((column) => column.name)
    const platformAccountColumns = db.prepare('PRAGMA table_info(platform_accounts)').all() as Array<{
      name: string
      notnull: number
    }>
    const bookPublicationStatusColumn = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'book_publications'`).get() as {
      sql: string
    }

    expect(names).toContain('platform_accounts')
    expect(names).toContain('book_publications')
    expect(names).toContain('chapter_publications')
    expect(bookColumns).not.toContain('remote_book_id')
    expect(chapterColumns).not.toContain('remote_id')
    expect(platformAccountColumns.find((column) => column.name === 'profile_path')?.notnull).toBe(0)
    expect(bookPublicationStatusColumn.sql).toContain("status TEXT NOT NULL DEFAULT 'draft'")
    expect(bookPublicationStatusColumn.sql).not.toContain('syncing')
    expect(bookPublicationStatusColumn.sql).not.toContain('ready')
    expect(bookPublicationStatusColumn.sql).not.toContain('published')
    expect(bookPublicationStatusColumn.sql).not.toContain('failed')
    db.close()
  })

  it('backfills standalone legacy accounts into platform_accounts', async () => {
    const path = await tempDb('legacy-accounts.sqlite')
    const db = new Database(path)

    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        cookies_json TEXT,
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
        stage TEXT NOT NULL
      );
    `)

    db.prepare(`INSERT INTO accounts (id, label, profile_path, status, last_checked_at, cookies_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'a-standalone',
      '番茄备用号',
      'data/browser-profiles/a-standalone',
      'active',
      '2026-05-13T01:02:03.000Z',
      '[{"name":"sid","value":"2"}]',
      '2026-05-13T00:00:00.000Z',
    )
    db.close()

    const migrated = openDatabase(path)
    const platformAccount = migrated.prepare(`SELECT id, platform, label, profile_path, cookies_json, status, last_checked_at FROM platform_accounts WHERE id = ?`).get('a-standalone') as {
      id: string
      platform: string
      label: string
      profile_path: string
      cookies_json: string | null
      status: string
      last_checked_at: string | null
    }

    expect(platformAccount).toMatchObject({
      id: 'a-standalone',
      platform: 'fanqie',
      label: '番茄备用号',
      profile_path: 'data/browser-profiles/a-standalone',
      cookies_json: '[{"name":"sid","value":"2"}]',
      status: 'active',
      last_checked_at: '2026-05-13T01:02:03.000Z',
    })
    migrated.close()
  })

  it('backfills old Fanqie linkage into book_publications and chapter_publications when legacy remote columns exist', async () => {
    const path = await tempDb('legacy.sqlite')
    const db = new Database(path)

    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        cookies_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        account_id TEXT REFERENCES accounts(id),
        remote_book_id TEXT
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL,
        remote_id TEXT
      );
    `)

    db.prepare(`INSERT INTO accounts (id, label, profile_path, status, cookies_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('a1', '番茄主号', 'data/browser-profiles/a1', 'active', '[{"name":"sid","value":"1"}]', '2026-05-13T00:00:00.000Z')
    db.prepare(`INSERT INTO books (id, title, root_path, account_id, remote_book_id) VALUES (?, ?, ?, ?, ?)`)
      .run('b1', '测试书', '/tmp/book', 'a1', 'fanqie-book-1')
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage, remote_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '已发布', 'fanqie-ch-1')
    db.close()

    const migrated = openDatabase(path)
    const publication = migrated.prepare(`SELECT platform, platform_account_id, platform_book_id FROM book_publications WHERE book_id = ?`).get('b1') as {
      platform: string
      platform_account_id: string
      platform_book_id: string | null
    }
    const chapterPublication = migrated.prepare(`SELECT platform_chapter_id FROM chapter_publications WHERE chapter_id = ?`).get('c1') as {
      platform_chapter_id: string | null
    }

    expect(publication).toMatchObject({
      platform: 'fanqie',
      platform_account_id: 'a1',
      platform_book_id: 'fanqie-book-1',
    })
    expect(chapterPublication.platform_chapter_id).toBe('fanqie-ch-1')
    migrated.close()
  })

  it('does not duplicate backfill rows across repeated openDatabase calls', async () => {
    const path = await tempDb('repeat-open.sqlite')
    const db = new Database(path)

    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        cookies_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        account_id TEXT REFERENCES accounts(id),
        remote_book_id TEXT
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL,
        remote_id TEXT
      );
    `)

    db.prepare(`INSERT INTO accounts (id, label, profile_path, status, cookies_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('a1', '番茄主号', 'data/browser-profiles/a1', 'active', null, '2026-05-13T00:00:00.000Z')
    db.prepare(`INSERT INTO books (id, title, root_path, account_id, remote_book_id) VALUES (?, ?, ?, ?, ?)`)
      .run('b1', '测试书', '/tmp/book', 'a1', 'fanqie-book-1')
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage, remote_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '已发布', 'fanqie-ch-1')
    db.close()

    const first = openDatabase(path)
    first.close()

    const second = openDatabase(path)
    const counts = {
      platformAccounts: (second.prepare('SELECT COUNT(*) as count FROM platform_accounts').get() as { count: number }).count,
      bookPublications: (second.prepare('SELECT COUNT(*) as count FROM book_publications').get() as { count: number }).count,
      chapterPublications: (second.prepare('SELECT COUNT(*) as count FROM chapter_publications').get() as { count: number }).count,
    }

    expect(counts).toEqual({
      platformAccounts: 1,
      bookPublications: 1,
      chapterPublications: 1,
    })
    second.close()
  })
})
