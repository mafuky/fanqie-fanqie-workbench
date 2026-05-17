import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AccountRecord, AccountStatus } from '../../domain/account.js'

type AccountRow = {
  id: string
  label: string
  profile_path: string
  status: string
  last_checked_at: string | null
  cookies_json: string | null
  created_at: string
}

function mapAccountRow(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    label: row.label,
    profilePath: row.profile_path,
    status: row.status as AccountStatus,
    lastCheckedAt: row.last_checked_at,
    cookiesJson: row.cookies_json,
    createdAt: row.created_at,
  }
}

export function createAccount(db: Database.Database, label: string): AccountRecord {
  const id = randomUUID()
  const now = new Date().toISOString()
  const profilePath = `data/browser-profiles/${id}`

  db.prepare(
    'INSERT INTO accounts (id, label, profile_path, status, cookies_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, label, profilePath, 'needs-login', null, now)

  return {
    id,
    label,
    profilePath,
    status: 'needs-login',
    lastCheckedAt: null,
    cookiesJson: null,
    createdAt: now,
  }
}

export function getAccounts(db: Database.Database): AccountRecord[] {
  const rows = db.prepare('SELECT id, label, profile_path, status, last_checked_at, cookies_json, created_at FROM accounts ORDER BY created_at DESC').all() as AccountRow[]
  return rows.map(mapAccountRow)
}

export function getAccountById(db: Database.Database, id: string): AccountRecord | null {
  const row = db.prepare('SELECT id, label, profile_path, status, last_checked_at, cookies_json, created_at FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
  return row ? mapAccountRow(row) : null
}

export function updateAccountLabel(db: Database.Database, id: string, label: string) {
  db.prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id)
}

export function updateAccountStatus(db: Database.Database, id: string, status: AccountStatus) {
  db.prepare('UPDATE accounts SET status = ?, last_checked_at = ? WHERE id = ?').run(status, new Date().toISOString(), id)
}

export function updateAccountCookies(db: Database.Database, id: string, cookiesJson: string | null) {
  db.prepare('UPDATE accounts SET cookies_json = ? WHERE id = ?').run(cookiesJson, id)
}

export function getAccountCookies(db: Database.Database, id: string): string | null {
  const row = db.prepare('SELECT cookies_json FROM accounts WHERE id = ?').get(id) as { cookies_json: string | null } | undefined
  return row?.cookies_json ?? null
}

export function deleteAccount(db: Database.Database, id: string) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
