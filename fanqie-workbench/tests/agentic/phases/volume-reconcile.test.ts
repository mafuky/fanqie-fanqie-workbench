import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { volumeReconcilePhase } from '../../../src/agentic/phases/volume-reconcile.js'

function bookRoot(volEnd: number) {
  const root = mkdtempSync(join(tmpdir(), 'vr-'))
  mkdirSync(join(root, '大纲'), { recursive: true })
  writeFileSync(join(root, '大纲', '卷纲_第一卷.md'), `# 第一卷\n章节范围:第1-${volEnd}章\n## 本卷目标\n…`)
  return root
}
const ctx = (root: string, chapterNumber: number) => ({
  bookId: 'b1', bookRoot: root, chapterId: 'c1',
  bookMeta: { id: 'b1', title: 'T', rootPath: root } as any,
  chapter: { id: 'c1', chapterNumber, title: 't', sourcePath: '正文/x.md', stage: '已初稿' } as any,
  previousPhaseResults: {},
})

describe('volume-reconcile phase', () => {
  it('is non-fatal and uses read/list + propose tool, never ask_user', () => {
    expect(volumeReconcilePhase.nonFatal).toBe(true)
    expect(volumeReconcilePhase.tools).toEqual(expect.arrayContaining(['read_file', 'list_dir', 'propose_volume_reconcile']))
    expect(volumeReconcilePhase.tools).not.toContain('ask_user')
  })

  it('shouldRun=true only when the chapter is a volume-end', async () => {
    const root = bookRoot(8)
    expect(await volumeReconcilePhase.shouldRun!(ctx(root, 8) as any)).toBe(true)
    expect(await volumeReconcilePhase.shouldRun!(ctx(root, 5) as any)).toBe(false)
  })

  it('shouldRun=false (graceful) when 大纲 dir missing — never throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vr-empty-'))
    await expect(volumeReconcilePhase.shouldRun!(ctx(root, 8) as any)).resolves.toBe(false)
  })

  it('prompt names the target volume and the required section marker', () => {
    const root = bookRoot(8)
    const p = volumeReconcilePhase.systemPrompt(ctx(root, 8) as any)
    expect(p).toContain('第一卷')
    expect(p).toContain('实际完成 vs 计划偏差')
    expect(p).toMatch(/无.*偏差|按计划/) // instruct: no divergence → don't call the tool
  })
})
