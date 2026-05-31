import type { ChatResult } from '../providers/provider.js'

export interface BookMeta {
  id: string
  title: string
  rootPath: string
  /** Raw 开书想法 (creative brief). Only set for book.create; used by clarify-direction to propose candidate titles. */
  idea?: string
}

export interface ChapterMeta {
  id: string
  chapterNumber: number
  title: string
  sourcePath: string
  stage: string
}

export interface PhaseContext {
  bookId: string
  bookRoot: string
  chapterId: string | null
  bookMeta: BookMeta
  chapter: ChapterMeta | null
  previousPhaseResults: Record<string, unknown>
}

export interface Phase {
  name: string
  tools: string[]
  maxIterations: number
  systemPrompt(ctx: PhaseContext): string
  initialUserMessage(ctx: PhaseContext): string
  onComplete?(ctx: PhaseContext, result: ChatResult): Promise<Record<string, unknown> | void>
  /**
   * Post-phase quality gate. Reads back what the model produced and returns a list
   * of human-readable problems (empty = passed). The runner feeds these back to the
   * model for a bounded number of repair rounds, then fails the phase if still unmet.
   */
  verify?(ctx: PhaseContext): Promise<string[]>
}
