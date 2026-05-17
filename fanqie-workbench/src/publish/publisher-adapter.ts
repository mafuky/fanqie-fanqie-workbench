import type { ChapterPublicationStatus } from '../domain/publication.js'
export type { ChapterPublicationStatus } from '../domain/publication.js'

export interface PublishPageLike {
  goto(url: string, options?: unknown): Promise<unknown> | unknown
  url(): string
}

export interface LocalBookBindingInput {
  id: string
  title: string
  rootPath: string
}

export interface PublishChapterInput {
  bookPublicationId: string
  chapterId: string
  platformBookId: string
  platformChapterId: string
  title: string
  content: string
}

export interface VerifyChapterInput {
  platformBookId: string
  platformChapterId: string
  title: string
}

export interface PublishPlatformAdapter {
  platform: string
  openBackend(page: PublishPageLike): Promise<void>
  ensureLoggedIn(page: PublishPageLike): Promise<void>
  listBooks(page: PublishPageLike): Promise<Array<{ id: string; title: string }>>
  bindBook(page: PublishPageLike, localBook: LocalBookBindingInput): Promise<{ platformBookId: string }>
  publishChapter(page: PublishPageLike, input: PublishChapterInput): Promise<{ platformChapterId?: string; status: ChapterPublicationStatus }>
  verifyChapter(page: PublishPageLike, input: VerifyChapterInput): Promise<boolean>
}

export class AdapterNotConfiguredError extends Error {
  constructor(platform: string, capability: string) {
    super(`${platform} adapter is not configured for ${capability}`)
    this.name = 'AdapterNotConfiguredError'
  }
}

export function throwAdapterNotConfigured(platform: string, capability: string): never {
  throw new AdapterNotConfiguredError(platform, capability)
}
