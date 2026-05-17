export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  profile_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'needs-login',
  last_checked_at TEXT,
  cookies_json TEXT,
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
CREATE TABLE IF NOT EXISTS platform_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  profile_path TEXT,
  cookies_json TEXT,
  status TEXT NOT NULL DEFAULT 'needs-login',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(platform, profile_path)
);
CREATE TABLE IF NOT EXISTS book_publications (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_account_id TEXT NOT NULL,
  platform_book_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id),
  UNIQUE(book_id, platform)
);
CREATE TABLE IF NOT EXISTS chapter_publications (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  book_publication_id TEXT NOT NULL,
  platform_chapter_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_published_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  FOREIGN KEY (book_publication_id) REFERENCES book_publications(id),
  UNIQUE(chapter_id, book_publication_id)
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
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  book_id TEXT,
  chapter_id TEXT,
  status TEXT NOT NULL,
  current_skill TEXT,
  pending_question_json TEXT,
  claude_resume_id TEXT,
  compressed_at TEXT,
  context_snapshot_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);
CREATE TABLE IF NOT EXISTS session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  stream TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`
