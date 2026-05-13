export function buildDraftPrompt(input: { bookTitle: string; chapterTitle: string; chapterPath: string }) {
  return `使用 chinese-novelist-skill 为《${input.bookTitle}》生成章节，产物路径为 ${input.chapterPath}。`
}
