export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  profile_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'needs-login',
  last_checked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  account_id TEXT REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT '待写作',
  FOREIGN KEY (book_id) REFERENCES books(id)
);
`
