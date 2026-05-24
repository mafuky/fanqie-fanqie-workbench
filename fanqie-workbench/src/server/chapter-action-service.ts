import type Database from 'better-sqlite3'
import { buildActionCommand } from '../actions/action-command-builder.js'
import { getActionBinding, normalizeActionKey, type ActionKey } from '../actions/action-registry.js'
import { runTerminalSessionCommand } from '../claude/terminal-session-runner.js'
import { createSession, type SessionRecord } from '../db/repositories/sessions-repo.js'
import { createChapterCompleteReviewCheckpoint } from './review-checkpoint-service.js'

export type ChapterActionContext = {
  id: string
  title: string
  source_path: string
  chapter_number: number
  book_id: string
  book_title: string
  book_root: string
}

export function loadChapterActionContext(db: Database.Database, input: { bookId: string; chapterId: string }): ChapterActionContext | null {
  const chapter = db.prepare(
    `SELECT c.id, c.title, c.source_path, c.chapter_number, c.book_id,
            b.title AS book_title, b.root_path AS book_root
     FROM chapters c
     JOIN books b ON b.id = c.book_id
     WHERE c.id = ? AND c.book_id = ?`,
  ).get(input.chapterId, input.bookId) as ChapterActionContext | undefined
  return chapter ?? null
}

export function getNextChapterId(db: Database.Database, input: { bookId: string; chapterNumber: number }): string | null {
  const row = db.prepare(
    `SELECT id FROM chapters
     WHERE book_id = ? AND chapter_number > ?
     ORDER BY chapter_number ASC
     LIMIT 1`,
  ).get(input.bookId, input.chapterNumber) as { id: string } | undefined
  return row?.id ?? null
}

export function startChapterActionSession(input: {
  db: Database.Database
  databasePath: string
  actionKey: string
  bookId: string
  chapterId: string
  userHint?: string | null
}): { session: SessionRecord; chapter: ChapterActionContext; actionKey: ActionKey } {
  const actionKey = normalizeActionKey(input.actionKey)
  const binding = getActionBinding(actionKey)
  if (binding.scope !== 'chapter') throw new Error('only chapter actions are supported in phase 1')

  const chapter = loadChapterActionContext(input.db, { bookId: input.bookId, chapterId: input.chapterId })
  if (!chapter) throw new Error('chapter not found')

  const session = createSession(input.db, {
    kind: 'chapter',
    bookId: input.bookId,
    chapterId: input.chapterId,
    currentSkill: actionKey,
  })

  const command = buildActionCommand({
    actionKey,
    bookTitle: chapter.book_title,
    bookRoot: chapter.book_root,
    chapterNumber: chapter.chapter_number,
    chapterTitle: chapter.title,
    chapterPath: chapter.source_path,
    userHint: input.userHint,
  })

  const shouldCreateReview = actionKey === 'chapter.continue'
  void runTerminalSessionCommand({
    databasePath: input.databasePath,
    sessionId: session.id,
    bookId: input.bookId,
    command,
    completeStatus: shouldCreateReview ? 'waiting-review' : 'succeeded',
    currentSkill: actionKey,
    beforeComplete: shouldCreateReview
      ? async ({ db }) => {
          createChapterCompleteReviewCheckpoint(db, {
            sessionId: session.id,
            chapter: {
              id: chapter.id,
              bookId: chapter.book_id,
              bookRoot: chapter.book_root,
              chapterNumber: chapter.chapter_number,
              chapterTitle: chapter.title,
              chapterPath: chapter.source_path,
            },
          })
        }
      : undefined,
  })

  return { session, chapter, actionKey }
}
