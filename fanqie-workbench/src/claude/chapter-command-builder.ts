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

function chapterHeader(input: ChapterCommandInput) {
  return `书籍目录：${input.bookRoot}\n章节文件：${input.chapterPath}`
}

export function buildChapterCommand(input: ChapterCommandInput) {
  const { action, bookTitle, chapterNumber, chapterTitle } = input

  if (action === 'chapter-write') {
    return `/story-long-write 继续写《${bookTitle}》第 ${chapterNumber} 章\n${chapterHeader(input)}\n要求读取设定、大纲、追踪上下文，并将正文写入章节文件。`
  }

  if (action === 'chapter-polish') {
    return `/story-long-write 润色《${bookTitle}》第 ${chapterNumber} 章《${chapterTitle}》\n${chapterHeader(input)}\n要求在不改变剧情、人设、伏笔的前提下提升文字表现，并直接修改原文件。${input.userHint ? `\n用户要求：${input.userHint}` : ''}`
  }

  if (action === 'chapter-deslop') {
    return `/story-deslop 处理章节\n${chapterHeader(input)}\n要求直接修改原文件，保留剧情、人设、伏笔，只改变表达方式，并输出修改摘要。`
  }

  if (action === 'chapter-review') {
    return `/story-review lean 审查章节\n${chapterHeader(input)}\n目标平台：番茄\n要求输出审稿报告，指出是否可以推进到「可发布」。`
  }

  return `/story-long-write 重写第 ${chapterNumber} 章\n${chapterHeader(input)}\n用户要求：${input.userHint || '按原章节目标重写，强化节奏和钩子。'}`
}
