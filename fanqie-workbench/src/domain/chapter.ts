export type ChapterStage =
  | '待写作'
  | '已初稿'
  | '已去AI'
  | '已审稿'
  | '可发布'
  | '已发布'

// Linear ordering used to advance stages forward-only (never regress).
export const STAGE_ORDER: ChapterStage[] = ['待写作', '已初稿', '已去AI', '已审稿', '可发布', '已发布']

export function stageRank(stage: ChapterStage): number {
  return STAGE_ORDER.indexOf(stage)
}

// A synced/scanned chapter file whose body holds real prose is already a draft (已初稿);
// an empty file, or one holding only the agent placeholder comment, is still 待写作.
const MIN_DRAFT_BODY_CHARS = 20
export function deriveInitialStage(body: string): ChapterStage {
  const real = body.replace(/<!--[\s\S]*?-->/g, '').trim()
  return real.length >= MIN_DRAFT_BODY_CHARS ? '已初稿' : '待写作'
}

// The stage a successful writing action produces. null = the action does not change stage.
export function producedStage(actionKey: string): ChapterStage | null {
  switch (actionKey) {
    case 'chapter.next':
    case 'chapter.continue':
      return '已初稿'
    case 'chapter.deslop':
      return '已去AI'
    case 'chapter.review':
      return '已审稿'
    default:
      return null
  }
}

export type ChapterRecord = {
  id: string
  bookId: string
  chapterNumber: number
  title: string
  sourcePath: string
  stage: ChapterStage
  remoteId: string | null
}

const transitions: Record<ChapterStage, ChapterStage[]> = {
  待写作: ['已初稿'],
  已初稿: ['已去AI'],
  已去AI: ['已审稿'],
  已审稿: ['可发布'],
  可发布: ['已发布'],
  已发布: [],
}

export function canTransition(from: ChapterStage, to: ChapterStage) {
  return transitions[from].includes(to)
}
