import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { createReviewCheckpoint, getActiveVolumeReconcile, type VolumeReconcilePayload } from '../db/repositories/review-checkpoints-repo.js'

type ChapterForReview = {
  id: string
  bookId: string
  bookRoot: string
  chapterNumber: number
  chapterTitle: string
  chapterPath: string
}

const CHAPTER_COMPLETE_OPTIONS = ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only'] as const

export function createChapterCompleteReviewCheckpoint(db: Database.Database, input: {
  sessionId: string
  chapter: ChapterForReview
}) {
  const trackingCandidates = [
    resolve(input.chapter.bookRoot, '追踪', '伏笔.md'),
    resolve(input.chapter.bookRoot, '追踪', '时间线.md'),
    resolve(input.chapter.bookRoot, '追踪', '上下文.md'),
  ].filter((path) => existsSync(path))

  return createReviewCheckpoint(db, {
    sessionId: input.sessionId,
    bookId: input.chapter.bookId,
    chapterId: input.chapter.id,
    stage: 'chapter-complete',
    title: `第 ${input.chapter.chapterNumber} 章正文已完成`,
    summary: {
      completed: ['章节正文已生成或更新', '追踪文件已按写作流程更新'],
      checks: ['请在左侧编辑器中验收正文质量'],
    },
    changedFiles: [input.chapter.chapterPath, ...trackingCandidates],
    options: [...CHAPTER_COMPLETE_OPTIONS],
  })
}

export function createVolumeReconcileCheckpoint(db: Database.Database, input: {
  sessionId: string
  bookId: string
  payload: VolumeReconcilePayload
}) {
  const existing = getActiveVolumeReconcile(db, input.bookId, input.payload.volumeKey)
  if (existing) return existing // DB-side dedup: one active reconcile per (book, volume)
  return createReviewCheckpoint(db, {
    sessionId: input.sessionId,
    bookId: input.bookId,
    chapterId: null,
    stage: 'volume-reconcile',
    title: `${input.payload.volumeKey}对账:计划 vs 实际`,
    summary: { completed: ['已对照卷纲计划与各章实际,检出偏差'], checks: ['确认偏差描述,可编辑后追加进卷纲'] },
    changedFiles: [],
    options: ['apply', 'apply-edited', 'skip'],
    payload: input.payload,
  })
}
