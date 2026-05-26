import type { ChatResult } from '../providers/provider.js'

export interface BookMeta {
  id: string
  title: string
  rootPath: string
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
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  previousPhaseResults: Record<string, unknown>
}

export interface Phase {
  name: string
  tools: string[]
  maxIterations: number
  systemPrompt(ctx: PhaseContext): string
  initialUserMessage(ctx: PhaseContext): string
  onComplete?(ctx: PhaseContext, result: ChatResult): Promise<Record<string, unknown> | void>
}
