import { describe, it, expect } from 'vitest'
import { writeOutlinePhase } from '../../src/agentic/phases/write-outline.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1', bookRoot: '/tmp/book', chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 7, title: '第七章', sourcePath: '/tmp/book/正文/第007章.md', stage: '待写作' },
    previousPhaseResults: { contextSummary: '前情摘要' },
    ...overrides,
  }
}

describe('writeOutlinePhase', () => {
  it('has correct name and write-capable tools', () => {
    expect(writeOutlinePhase.name).toBe('write-outline')
    expect(writeOutlinePhase.tools).toEqual(['read_file', 'list_dir', 'write_file'])
    expect(writeOutlinePhase.maxIterations).toBe(6)
  })
  it('systemPrompt targets the zero-padded outline path and references settings/tracking', () => {
    const prompt = writeOutlinePhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/大纲/细纲_第007章.md')
    expect(prompt).toContain('设定')
    expect(prompt).toContain('追踪')
    expect(prompt).toContain('第7章')
  })
  it('initialUserMessage passes the context summary through', () => {
    expect(writeOutlinePhase.initialUserMessage(makeCtx())).toContain('前情摘要')
  })
  it('onComplete returns outlineWritten flag', async () => {
    const result = await writeOutlinePhase.onComplete!(makeCtx(), { content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } } as any)
    expect(result).toEqual({ outlineWritten: true })
  })
})
