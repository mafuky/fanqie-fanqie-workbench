import crypto from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../client.js'
import { scanBooks } from '../../fs/book-scanner.js'
import { parseChapterFile } from '../../fs/chapter-parser.js'

function hasColumn(db: Database.Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((entry) => entry.name === column)
}

async function readMarkdownFiles(directory: string) {
  try {
    const files = await readdir(directory)
    return files.filter((file) => file.endsWith('.md')).sort().map((file) => join(directory, file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function findChapterMarkdownFiles(bookRoot: string) {
  const storyFiles = await readMarkdownFiles(join(bookRoot, '正文'))
  const rootFiles = await readMarkdownFiles(bookRoot)
  return [...storyFiles, ...rootFiles]
}

export async function syncWorkspaceBooks({
  novelsRoot,
  databasePath
}: {
  novelsRoot: string
  databasePath: string
}) {
  const db = openDatabase(databasePath)

  const hasBookRemoteId = hasColumn(db, 'books', 'remote_book_id')
  const hasChapterRemoteId = hasColumn(db, 'chapters', 'remote_id')

  const insertBook = hasBookRemoteId
    ? db.prepare(`INSERT INTO books (id, title, root_path, account_id, remote_book_id) VALUES (?, ?, ?, ?, ?)`)
    : db.prepare(`INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, ?)`)
  const updateBook = db.prepare(
    `UPDATE books SET title = ?, root_path = ? WHERE id = ?`
  )
  const insertChapter = hasChapterRemoteId
    ? db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage, remote_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    : db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`)
  const updateChapter = db.prepare(
    `UPDATE chapters SET book_id = ?, chapter_number = ?, title = ?, source_path = ? WHERE id = ?`
  )
  const findBookByPath = db.prepare(
    `SELECT id, account_id, ${hasBookRemoteId ? 'remote_book_id' : 'NULL AS remote_book_id'} FROM books WHERE root_path = ?`
  )
  const findChapterByPath = db.prepare(
    `SELECT id FROM chapters WHERE source_path = ?`
  )

  let bookCount = 0
  let chapterCount = 0

  const books = await scanBooks(novelsRoot)

  for (const book of books) {
    const existingBook = findBookByPath.get(book.rootPath) as
      | { id: string; account_id: string | null; remote_book_id: string | null }
      | undefined
    const bookId = existingBook?.id ?? crypto.randomUUID()

    if (existingBook) {
      updateBook.run(book.title, book.rootPath, bookId)
    } else {
      if (hasBookRemoteId) {
        insertBook.run(bookId, book.title, book.rootPath, null, null)
      } else {
        insertBook.run(bookId, book.title, book.rootPath, null)
      }
    }
    bookCount++

    const chapterFiles = await findChapterMarkdownFiles(book.rootPath)

    for (const sourcePath of chapterFiles) {
      const fileUrl = new URL(`file://${sourcePath}`)
      const chapter = await parseChapterFile(fileUrl)

      if (!chapter) continue

      const existingChapter = findChapterByPath.get(sourcePath) as
        | { id: string }
        | undefined
      const chapterId = existingChapter?.id ?? crypto.randomUUID()

      if (existingChapter) {
        updateChapter.run(
          bookId,
          chapter.chapterNumber,
          chapter.title,
          sourcePath,
          chapterId
        )
      } else {
        if (hasChapterRemoteId) {
          insertChapter.run(
            chapterId,
            bookId,
            chapter.chapterNumber,
            chapter.title,
            sourcePath,
            '待写作',
            null
          )
        } else {
          insertChapter.run(
            chapterId,
            bookId,
            chapter.chapterNumber,
            chapter.title,
            sourcePath,
            '待写作'
          )
        }
      }
      chapterCount++
    }
  }

  db.close()
  return { bookCount, chapterCount }
}
