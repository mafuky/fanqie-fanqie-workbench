import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AccountStatus } from '../../domain/account.js'
import type { PlatformAccountRecord } from '../../domain/platform-account.js'
import type { SupportedPlatform } from '../../domain/platform.js'

type PlatformAccountRow = {
  id: string
  platform: SupportedPlatform
  label: string
  profile_path: string | null
  cookies_json: string | null
  status: PlatformAccountRecord['status']
  last_checked_at: string | null
  created_at: string
}

function mapPlatformAccountRow(row: PlatformAccountRow): PlatformAccountRecord {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    profilePath: row.profile_path,
    cookiesJson: row.cookies_json,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  }
}

export function createPlatformAccount(
  db: Database.Database,
  input: { platform: SupportedPlatform; label: string },
): PlatformAccountRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const profilePath = `data/browser-profiles/${input.platform}-${id}`

  db.prepare(
    `INSERT INTO platform_accounts (id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.platform, input.label, profilePath, null, 'needs-login', null, createdAt)

  return {
    id,
    platform: input.platform,
    label: input.label,
    profilePath,
    cookiesJson: null,
    status: 'needs-login',
    lastCheckedAt: null,
    createdAt,
  }
}

export function listPlatformAccounts(db: Database.Database, platform?: SupportedPlatform): PlatformAccountRecord[] {
  const rows = platform
    ? db.prepare(
        `SELECT id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at
         FROM platform_accounts
         WHERE platform = ?
         ORDER BY created_at DESC`,
      ).all(platform)
    : db.prepare(
        `SELECT id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at
         FROM platform_accounts
         ORDER BY created_at DESC`,
      ).all()

  return (rows as PlatformAccountRow[]).map(mapPlatformAccountRow)
}

export function getPlatformAccountById(db: Database.Database, id: string): PlatformAccountRecord | null {
  const row = db.prepare(
    `SELECT id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at
     FROM platform_accounts
     WHERE id = ?`,
  ).get(id) as PlatformAccountRow | undefined

  return row ? mapPlatformAccountRow(row) : null
}

export function updatePlatformAccountLabel(db: Database.Database, id: string, label: string) {
  db.prepare('UPDATE platform_accounts SET label = ? WHERE id = ?').run(label, id)
}

export function updatePlatformAccountStatus(db: Database.Database, id: string, status: AccountStatus) {
  db.prepare('UPDATE platform_accounts SET status = ?, last_checked_at = ? WHERE id = ?').run(status, new Date().toISOString(), id)
}

export function updatePlatformAccountCookies(db: Database.Database, id: string, cookiesJson: string | null) {
  db.prepare('UPDATE platform_accounts SET cookies_json = ? WHERE id = ?').run(cookiesJson, id)
}

export function deletePlatformAccount(db: Database.Database, id: string) {
  db.prepare('DELETE FROM platform_accounts WHERE id = ?').run(id)
}
