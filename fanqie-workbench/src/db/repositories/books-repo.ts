import crypto from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase } from '../client.js'
import { scanBooks } from '../../fs/book-scanner.js'
import { parseChapterFile } from '../../fs/chapter-parser.js'

export async function syncWorkspaceBooks({
  novelsRoot,
  databasePath
}: {
  novelsRoot: string
  databasePath: string
}) {
  const db = openDatabase(databasePath)

  const upsertBook = db.prepare(
    `INSERT OR REPLACE INTO books (id, title, root_path) VALUES (?, ?, ?)`
  )
  const upsertChapter = db.prepare(
    `INSERT OR REPLACE INTO chapters (id, book_id, chapter_number, title, source_path) VALUES (?, ?, ?, ?, ?)`
  )
  const findBookByPath = db.prepare(
    `SELECT id FROM books WHERE root_path = ?`
  )
  const findChapterByPath = db.prepare(
    `SELECT id FROM chapters WHERE source_path = ?`
  )

  let bookCount = 0
  let chapterCount = 0

  const books = await scanBooks(novelsRoot)

  for (const book of books) {
    const existingBook = findBookByPath.get(book.rootPath) as
      | { id: string }
      | undefined
    const bookId = existingBook?.id ?? crypto.randomUUID()

    upsertBook.run(bookId, book.title, book.rootPath)
    bookCount++

    const files = await readdir(book.rootPath)
    const mdFiles = files.filter((f) => f.endsWith('.md')).sort()

    for (const mdFile of mdFiles) {
      const sourcePath = join(book.rootPath, mdFile)
      const fileUrl = new URL(`file://${sourcePath}`)
      const chapter = await parseChapterFile(fileUrl)

      const existingChapter = findChapterByPath.get(sourcePath) as
        | { id: string }
        | undefined
      const chapterId = existingChapter?.id ?? crypto.randomUUID()

      upsertChapter.run(
        chapterId,
        bookId,
        chapter.chapterNumber,
        chapter.title,
        sourcePath
      )
      chapterCount++
    }
  }

  db.close()
  return { bookCount, chapterCount }
}
