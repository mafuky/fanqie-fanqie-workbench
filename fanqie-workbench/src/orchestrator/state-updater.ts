import { canTransition, type ChapterStage } from '../domain/chapter.js'

export function advanceStage(from: ChapterStage, to: ChapterStage) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal transition: ${from} -> ${to}`)
  }
  return to
}
