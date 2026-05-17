import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { schemaSql } from './schema.js'

const additiveMigrations = [
  { table: 'accounts', column: 'cookies_json', sql: 'ALTER TABLE accounts ADD COLUMN cookies_json TEXT' },
  { table: 'books', column: 'remote_book_id', sql: 'ALTER TABLE books ADD COLUMN remote_book_id TEXT' },
  { table: 'chapters', column: 'remote_id', sql: 'ALTER TABLE chapters ADD COLUMN remote_id TEXT' },
  { table: 'sessions', column: 'claude_resume_id', sql: 'ALTER TABLE sessions ADD COLUMN claude_resume_id TEXT' },
  { table: 'sessions', column: 'compressed_at', sql: 'ALTER TABLE sessions ADD COLUMN compressed_at TEXT' },
  { table: 'sessions', column: 'context_snapshot_json', sql: 'ALTER TABLE sessions ADD COLUMN context_snapshot_json TEXT' },
] as const

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  return Boolean(row)
}

function hasColumn(db: Database.Database, table: string, column: string) {
  if (!hasTable(db, table)) return false
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((entry) => entry.name === column)
}

function runAdditiveMigrations(
  db: Database.Database,
  existingTablesBeforeSchema: Record<string, boolean>,
) {
  for (const migration of additiveMigrations) {
    if (!migration.sql) continue
    if (!existingTablesBeforeSchema[migration.table]) continue
    if (hasColumn(db, migration.table, migration.column)) continue

    try {
      db.exec(migration.sql)
    } catch (error) {
      if (hasColumn(db, migration.table, migration.column)) continue
      if (error instanceof Error && /duplicate column name/i.test(error.message)) continue
      throw error
    }
  }
}

function backfillLegacyFanqiePublications(db: Database.Database) {
  if (!hasTable(db, 'accounts') || !hasTable(db, 'platform_accounts') || !hasTable(db, 'book_publications') || !hasTable(db, 'chapter_publications')) {
    return
  }

  const runBackfill = db.transaction(() => {
    const accountCookiesExpr = hasColumn(db, 'accounts', 'cookies_json') ? 'cookies_json' : 'NULL'
    const accountLastCheckedExpr = hasColumn(db, 'accounts', 'last_checked_at') ? 'last_checked_at' : 'NULL'
    const bookRemoteExpr = hasColumn(db, 'books', 'remote_book_id') ? 'b.remote_book_id' : 'NULL'
    const chapterRemoteExpr = hasColumn(db, 'chapters', 'remote_id') ? 'remote_id' : 'NULL'

    db.prepare(`
      INSERT OR IGNORE INTO platform_accounts (id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at)
      SELECT id, 'fanqie', label, profile_path, ${accountCookiesExpr}, status, ${accountLastCheckedExpr}, created_at
      FROM accounts
    `).run()

    if (!hasTable(db, 'books') || !hasTable(db, 'chapters') || !hasColumn(db, 'books', 'account_id')) {
      return
    }

    const legacyBooks = db.prepare(`
      SELECT b.id AS book_id, b.account_id, ${bookRemoteExpr} AS remote_book_id, a.id AS account_id_exists
      FROM books b
      LEFT JOIN accounts a ON a.id = b.account_id
      WHERE b.account_id IS NOT NULL
    `).all() as Array<{
      book_id: string
      account_id: string
      remote_book_id: string | null
      account_id_exists: string | null
    }>

    const findPublication = db.prepare(`SELECT id FROM book_publications WHERE book_id = ? AND platform = 'fanqie'`)
    const insertPublication = db.prepare(`
      INSERT INTO book_publications (id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at)
      VALUES (?, ?, 'fanqie', ?, ?, 'bound', ?, ?)
    `)
    const insertChapterPublication = db.prepare(`
      INSERT OR IGNORE INTO chapter_publications (id, chapter_id, book_publication_id, platform_chapter_id, status, last_published_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const selectChaptersByBook = db.prepare(`SELECT id, ${chapterRemoteExpr} AS remote_id, stage FROM chapters WHERE book_id = ?`)

    for (const row of legacyBooks) {
      if (!row.account_id_exists) continue

      const existing = findPublication.get(row.book_id) as { id: string } | undefined
      const now = new Date().toISOString()
      const publicationId = existing?.id ?? randomUUID()

      if (!existing) {
        insertPublication.run(publicationId, row.book_id, row.account_id, row.remote_book_id, now, now)
      }

      const chapters = selectChaptersByBook.all(row.book_id) as Array<{
        id: string
        remote_id: string | null
        stage: string
      }>

      for (const chapter of chapters) {
        if (!chapter.remote_id) continue
        insertChapterPublication.run(
          randomUUID(),
          chapter.id,
          publicationId,
          chapter.remote_id,
          chapter.stage === '已发布' ? 'published' : 'synced',
          chapter.stage === '已发布' ? now : null,
          now,
        )
      }
    }
  })

  runBackfill()
}

export function openDatabase(path: string) {
  const db = new Database(path)
  const existingTablesBeforeSchema = {
    accounts: hasTable(db, 'accounts'),
    books: hasTable(db, 'books'),
    chapters: hasTable(db, 'chapters'),
    sessions: hasTable(db, 'sessions'),
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  runAdditiveMigrations(db, existingTablesBeforeSchema)
  backfillLegacyFanqiePublications(db)
  return db
}
