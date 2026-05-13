export type ChapterStage =
  | '待写作'
  | '已初稿'
  | '已去AI'
  | '已审稿'
  | '可发布'
  | '发布中'
  | '已发布'

const transitions: Record<ChapterStage, ChapterStage[]> = {
  待写作: ['已初稿'],
  已初稿: ['已去AI'],
  已去AI: ['已审稿'],
  已审稿: ['可发布'],
  可发布: ['发布中'],
  发布中: ['已发布', '可发布'],
  已发布: []
}

export function canTransition(from: ChapterStage, to: ChapterStage) {
  return transitions[from].includes(to)
}
