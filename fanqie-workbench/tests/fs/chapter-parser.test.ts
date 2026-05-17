import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseChapterFile } from '../../src/fs/chapter-parser'

async function createChapterFile(name: string, content: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-parser-'))
  const path = resolve(dir, name)
  await writeFile(path, content, 'utf8')
  return path
}

describe('chapter parser', () => {
  it('extracts chapter number, title, and body', async () => {
    const chapterPath = await createChapterFile('第001章_雾夜.md', '# 第1章 雾夜\n\n这是一段超过十个字的正文内容。\n')
    const result = await parseChapterFile(pathToFileURL(chapterPath))
    expect(result).not.toBeNull()
    expect(result!.chapterNumber).toBe(1)
    expect(result!.title).toBe('雾夜')
    expect(result!.body.length).toBeGreaterThan(10)
  })

  it('returns null for non-chapter files', async () => {
    const outlinePath = await createChapterFile('00-大纲.md', '# 测试书 大纲\n\n这是一本测试用小说的大纲文件，不是章节正文。\n')
    const result = await parseChapterFile(pathToFileURL(outlinePath))
    expect(result).toBeNull()
  })
})
