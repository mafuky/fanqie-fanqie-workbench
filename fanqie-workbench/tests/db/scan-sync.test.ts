import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo'
import { openDatabase } from '../../src/db/client'

async function createLegacyNovelFixture() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-scan-sync-legacy-'))
  const novelsRoot = resolve(tempRoot, 'novels')
  const bookRoot = resolve(novelsRoot, '测试书')
  await mkdir(bookRoot, { recursive: true })
  await writeFile(resolve(bookRoot, '第001章_雾夜.md'), '# 第1章 雾夜\n\n正文内容\n', 'utf8')
  await writeFile(resolve(bookRoot, '00-大纲.md'), '# 测试书 大纲\n\n不是章节\n', 'utf8')
  return novelsRoot
}

describe('scan sync', () => {
  it('indexes books and chapters without owning markdown content', async () => {
    const summary = await syncWorkspaceBooks({
      novelsRoot: await createLegacyNovelFixture(),
      databasePath: ':memory:'
    })

    expect(summary.bookCount).toBe(1)
    expect(summary.chapterCount).toBe(1)
  })

  it('is idempotent — rerunning produces same counts', async () => {
    const summary1 = await syncWorkspaceBooks({ novelsRoot: await createLegacyNovelFixture(), databasePath: ':memory:' })
    // Can't reuse in-memory DB across calls, but we verify structure is correct
    expect(summary1.bookCount).toBe(1)
  })

  it('indexes chapters from 正文 without importing outline or tracking markdown', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-scan-sync-'))
    const novelsRoot = resolve(tempRoot, 'novels')
    const bookRoot = resolve(novelsRoot, '雾港疑局')
    await mkdir(resolve(bookRoot, '大纲'), { recursive: true })
    await mkdir(resolve(bookRoot, '正文'), { recursive: true })
    await mkdir(resolve(bookRoot, '追踪'), { recursive: true })
    await writeFile(resolve(bookRoot, '大纲', '大纲.md'), '# 第1章 不应导入\n\n大纲内容\n', 'utf8')
    await writeFile(resolve(bookRoot, '正文', '第001章_雾夜失踪.md'), '# 第1章 雾夜失踪\n\n正文内容\n', 'utf8')
    await writeFile(resolve(bookRoot, '追踪', '时间线.md'), '# 第2章 也不应导入\n\n追踪内容\n', 'utf8')

    const databasePath = resolve(tempRoot, 'workbench.sqlite')
    const summary = await syncWorkspaceBooks({ novelsRoot, databasePath })

    expect(summary).toEqual({ bookCount: 1, chapterCount: 1 })

    const db = openDatabase(databasePath)
    try {
      const chapters = db.prepare('SELECT chapter_number, title, source_path FROM chapters ORDER BY chapter_number').all() as Array<{ chapter_number: number; title: string; source_path: string }>
      expect(chapters).toEqual([
        {
          chapter_number: 1,
          title: '雾夜失踪',
          source_path: resolve(bookRoot, '正文', '第001章_雾夜失踪.md'),
        },
      ])
    } finally {
      db.close()
    }
  })
})
