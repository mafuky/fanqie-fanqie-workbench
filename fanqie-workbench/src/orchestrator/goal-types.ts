export type OrchestrationGoal =
  | { type: 'draft-chapter'; bookId: string; chapterId: string }
  | { type: 'deai-chapter'; bookId: string; chapterId: string }
  | { type: 'review-chapter'; bookId: string; chapterId: string }
  | { type: 'refresh-analytics'; bookId?: string }
  | { type: 'publish-book'; bookId: string; mode: 'dry-run' | 'assisted' | 'auto' }
