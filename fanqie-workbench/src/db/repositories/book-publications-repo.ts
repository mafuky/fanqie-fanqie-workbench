import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { SupportedPlatform } from '../../domain/platform.js'
import type { BookPublicationRecord, BookPublicationStatus } from '../../domain/publication.js'
import { getPlatformAccountById } from './platform-accounts-repo.js'

type BookPublicationRow = {
  id: string
  book_id: string
  platform: SupportedPlatform
  platform_account_id: string
  platform_book_id: string | null
  status: BookPublicationStatus
  created_at: string
  updated_at: string
}

function mapBookPublicationRow(row: BookPublicationRow): BookPublicationRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    platform: row.platform,
    platformAccountId: row.platform_account_id,
    platformBookId: row.platform_book_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createBookPublication(
  db: Database.Database,
  input: { bookId: string; platform: SupportedPlatform; platformAccountId: string },
): BookPublicationRecord {
  const account = getPlatformAccountById(db, input.platformAccountId)
  if (!account) {
    throw new Error('Platform account not found')
  }
  if (account.platform !== input.platform) {
    throw new Error('Platform account must match book publication platform')
  }

  const existing = db.prepare(
    `SELECT id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at
     FROM book_publications
     WHERE book_id = ? AND platform = ?`,
  ).get(input.bookId, input.platform) as BookPublicationRow | undefined

  if (existing) {
    throw new Error('Book publication already exists for this platform')
  }

  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO book_publications (id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.bookId, input.platform, input.platformAccountId, null, 'draft', now, now)

  return {
    id,
    bookId: input.bookId,
    platform: input.platform,
    platformAccountId: input.platformAccountId,
    platformBookId: null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

export function getBookPublicationById(db: Database.Database, id: string): BookPublicationRecord | null {
  const row = db.prepare(
    `SELECT id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at
     FROM book_publications
     WHERE id = ?`,
  ).get(id) as BookPublicationRow | undefined

  return row ? mapBookPublicationRow(row) : null
}

export function getBookPublicationByBookIdAndPlatform(
  db: Database.Database,
  bookId: string,
  platform: SupportedPlatform,
): BookPublicationRecord | null {
  const row = db.prepare(
    `SELECT id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at
     FROM book_publications
     WHERE book_id = ? AND platform = ?`,
  ).get(bookId, platform) as BookPublicationRow | undefined

  return row ? mapBookPublicationRow(row) : null
}

export function getBookPublicationsByBookId(db: Database.Database, bookId: string): BookPublicationRecord[] {
  const rows = db.prepare(
    `SELECT id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at
     FROM book_publications
     WHERE book_id = ?
     ORDER BY created_at ASC`,
  ).all(bookId) as BookPublicationRow[]

  return rows.map(mapBookPublicationRow)
}

export function updateBookPublicationBinding(
  db: Database.Database,
  id: string,
  input: { platformBookId: string | null; status: Extract<BookPublicationStatus, 'draft' | 'bound'> },
) {
  db.prepare(
    `UPDATE book_publications
     SET platform_book_id = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.platformBookId, input.status, new Date().toISOString(), id)
}

export function updateBookPublicationStatus(db: Database.Database, id: string, status: BookPublicationStatus) {
  db.prepare(
    `UPDATE book_publications
     SET status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, new Date().toISOString(), id)
}

export function updateBookPublication(
  db: Database.Database,
  id: string,
  input: {
    platformAccountId?: string
    platformBookId?: string | null
    status?: BookPublicationStatus
  },
) {
  const assignments: string[] = []
  const values: Array<string | null> = []

  if (input.platformAccountId !== undefined) {
    assignments.push('platform_account_id = ?')
    values.push(input.platformAccountId)
  }

  if (input.platformBookId !== undefined) {
    assignments.push('platform_book_id = ?')
    values.push(input.platformBookId)
  }

  if (input.status !== undefined) {
    assignments.push('status = ?')
    values.push(input.status)
  }

  if (assignments.length === 0) {
    return
  }

  assignments.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  db.prepare(
    `UPDATE book_publications
     SET ${assignments.join(', ')}
     WHERE id = ?`,
  ).run(...values)
}
