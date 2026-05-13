import type { ChapterStage } from '../domain/chapter.js'

export function resolveStage(input: { hasDraft: boolean; hasDeai: boolean; hasReview: boolean; isPublished: boolean }): ChapterStage {
  if (input.isPublished) return '已发布'
  if (input.hasReview) return '已审稿'
  if (input.hasDeai) return '已去AI'
  if (input.hasDraft) return '已初稿'
  return '待写作'
}
