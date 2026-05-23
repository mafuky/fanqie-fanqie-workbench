export type ChapterCommandAction =
  | 'chapter-write'
  | 'chapter-polish'
  | 'chapter-deslop'
  | 'chapter-review'
  | 'chapter-rewrite'

export type ChapterCommandInput = {
  action: ChapterCommandAction
  bookTitle: string
  bookRoot: string
  chapterNumber: number
  chapterTitle: string
  chapterPath: string
  userHint?: string | null
}

export function buildChapterCommand(input: ChapterCommandInput) {
  const { action, bookTitle, chapterNumber, chapterTitle } = input
  const loc = `书籍目录：${input.bookRoot}，章节文件：${input.chapterPath}`

  if (action === 'chapter-write') {
    return `/story-long-write 日更《${bookTitle}》第 ${chapterNumber} 章，${loc}`
  }

  if (action === 'chapter-polish') {
    return `/story-long-write 润色《${bookTitle}》第 ${chapterNumber} 章《${chapterTitle}》，${loc}${input.userHint ? `，用户要求：${input.userHint}` : ''}`
  }

  if (action === 'chapter-deslop') {
    return `/story-deslop 处理章节，${loc}${input.userHint ? `，用户要求：${input.userHint}` : ''}`
  }

  if (action === 'chapter-review') {
    return `/story-review lean 审查章节，${loc}，目标平台：番茄`
  }

  return `/story-long-write 重写第 ${chapterNumber} 章，${loc}，用户要求：${input.userHint || '按原章节目标重写，强化节奏和钩子。'}`
}
