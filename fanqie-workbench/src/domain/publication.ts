export type BookPublicationStatus = 'draft' | 'bound' | 'paused'
export type ChapterPublicationStatus = 'pending' | 'synced' | 'published' | 'failed'

export type BookPublicationRecord = {
  id: string
  bookId: string
  platform: string
  platformAccountId: string
  platformBookId: string | null
  status: BookPublicationStatus
  createdAt: string
  updatedAt: string
}

export type ChapterPublicationRecord = {
  id: string
  chapterId: string
  bookPublicationId: string
  platformChapterId: string | null
  status: ChapterPublicationStatus
  lastPublishedAt: string | null
  updatedAt: string
}
