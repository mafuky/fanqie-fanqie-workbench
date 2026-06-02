import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { polishChapterPhase } from '../../../src/agentic/phases/polish-chapter.js'

const baseCtx = {
  bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
  bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
  chapter: { id: 'c1', chapterNumber: 9, title: '九章', sourcePath: '正文/第009章.md', stage: '已写作' } as any,
  previousPhaseResults: {},
} as const

describe('polish-chapter phase', () => {
  it('only uses read + write tools, never ask_user', () => {
    expect(polishChapterPhase.tools).toEqual(expect.arrayContaining(['read_file', 'write_file']))
    expect(polishChapterPhase.tools).not.toContain('ask_user')
  })

  it('prompt targets rhythm / subtext / flat-emotion and forbids plot changes', () => {
    const p = polishChapterPhase.systemPrompt(baseCtx)
    expect(p).toContain('正文/第009章.md')
    expect(p).toContain('节奏')
    expect(p).toContain('潜台词')
    expect(p).toMatch(/不改|不动|不能丢/)
  })

  describe('verify (length guard)', () => {
    let root: string
    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'polish-')) })
    afterEach(() => { rmSync(root, { recursive: true, force: true }) })

    function ctxWith() {
      return { ...baseCtx, bookRoot: root, chapter: { ...baseCtx.chapter, sourcePath: join(root, '正文', '第009章.md') } } as any
    }

    it('flags a chapter that got gutted below the floor', async () => {
      mkdirSync(join(root, '正文'), { recursive: true })
      writeFileSync(join(root, '正文', '第009章.md'), '太短了。')
      const issues = await polishChapterPhase.verify!(ctxWith())
      expect(issues.some((i) => /字数塌缩/.test(i))).toBe(true)
    })

    it('passes when the chapter keeps its length', async () => {
      mkdirSync(join(root, '正文'), { recursive: true })
      writeFileSync(join(root, '正文', '第009章.md'), '正'.repeat(2000))
      const issues = await polishChapterPhase.verify!(ctxWith())
      expect(issues).toEqual([])
    })
  })
})
