import Database from 'better-sqlite3'
import { schemaSql } from './schema.js'

export function openDatabase(path: string) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}
