import { buildChapterCommand, type ChapterCommandAction } from '../claude/chapter-command-builder.js'
import { normalizeActionKey, type ActionKey } from './action-registry.js'

export type BuildActionCommandInput = {
  actionKey: ActionKey | string
  bookTitle: string
  bookRoot: string
  chapterNumber: number
  chapterTitle: string
  chapterPath: string
  userHint?: string | null
}

const chapterActionByActionKey: Record<ActionKey, ChapterCommandAction | null> = {
  'chapter.continue': 'chapter-write',
  'chapter.polish': 'chapter-polish',
  'chapter.deslop': 'chapter-deslop',
  'chapter.review': 'chapter-review',
  'chapter.rewrite': 'chapter-rewrite',
  'editor.selection.polish': null,
  'editor.selection.rewrite': null,
  'market.scan': null,
  'market.bindToBook': null,
  'publish.chapters': null,
}

export function buildActionCommand(input: BuildActionCommandInput): string {
  const actionKey = normalizeActionKey(input.actionKey)
  const chapterAction = chapterActionByActionKey[actionKey]
  if (!chapterAction) throw new Error(`Action ${actionKey} does not build a chapter command`)

  return buildChapterCommand({
    action: chapterAction,
    bookTitle: input.bookTitle,
    bookRoot: input.bookRoot,
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    chapterPath: input.chapterPath,
    userHint: input.userHint,
  })
}
