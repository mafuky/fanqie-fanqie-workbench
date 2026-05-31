import { describe, it, expect } from 'vitest'
import { clarifyDirectionPhase } from '../../../src/agentic/phases/clarify-direction.js'
import type { PhaseContext } from '../../../src/agentic/phases/phase.js'
import type { ChatResult } from '../../../src/agentic/providers/provider.js'

function ctx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'book-1',
    bookRoot: 'pending:book-1',
    chapterId: null,
    bookMeta: { id: 'book-1', title: '占位', rootPath: 'pending:book-1', idea: '女频豪门追妻火葬场，带悬疑线' },
    chapter: null,
    previousPhaseResults: {},
    ...overrides,
  }
}

describe('clarifyDirectionPhase', () => {
  it('uses ask_user and does NOT use write_file', () => {
    expect(clarifyDirectionPhase.tools).toContain('ask_user')
    expect(clarifyDirectionPhase.tools).not.toContain('write_file')
  })

  it('system prompt references the idea and a 5th 书名 confirmation step', () => {
    const prompt = clarifyDirectionPhase.systemPrompt(ctx())
    expect(prompt).toContain('女频豪门追妻火葬场，带悬疑线')
    expect(prompt).toContain('书名')
    expect(prompt).toMatch(/3\s*个候选书名|3 个候选/)
    expect(prompt).not.toContain('write_file')
    expect(prompt).not.toContain('设定/方向.md')
  })

  it('onComplete returns directionLocked, directionSummary and bookTitle parsed from final content', async () => {
    const result = {
      content: '方向已锁定。\nBOOK_TITLE: 雾港疑局',
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1 },
    } as ChatResult
    const update = await clarifyDirectionPhase.onComplete!(ctx(), result)
    expect(update).toMatchObject({ directionLocked: true, bookTitle: '雾港疑局' })
    expect((update as Record<string, unknown>).directionSummary).toContain('方向已锁定')
  })

  it('onComplete falls back to a trimmed title when no BOOK_TITLE marker present', async () => {
    const result = {
      content: '随便一句没有标记的话',
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1 },
    } as ChatResult
    const update = await clarifyDirectionPhase.onComplete!(ctx(), result)
    expect(typeof (update as Record<string, unknown>).bookTitle).toBe('string')
    expect((update as Record<string, unknown>).bookTitle).toBeTruthy()
  })
})
