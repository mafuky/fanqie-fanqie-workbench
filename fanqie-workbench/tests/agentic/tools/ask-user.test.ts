import { describe, expect, it, vi } from 'vitest'
import { createAskUserTool } from '../../../src/agentic/tools/ask-user.js'

describe('ask_user tool', () => {
  it('emits question event and resolves with user answer', async () => {
    let resolver: ((s: string) => void) | null = null
    const askUser = createAskUserTool({
      waitForAnswer: (_bookId: string) => new Promise<string>((res) => { resolver = res }),
    })
    const emit = vi.fn()
    const promise = askUser.execute({
      args: { question: '继续吗？', options: [{ label: '1. 继续' }, { label: '2. 终止' }] },
      ctx: { bookId: 'b1', bookRoot: '/tmp', emit },
    })
    expect(emit).toHaveBeenCalledWith({
      type: 'question',
      question: '继续吗？',
      options: [{ label: '1. 继续' }, { label: '2. 终止' }],
      multiSelect: false,
    })
    resolver!('1. 继续')
    const r = await promise
    expect(r).toEqual({ ok: true, result: '1. 继续' })
  })

  it('passes bookId to waitForAnswer so multi-book resolvers stay isolated', async () => {
    const seen: string[] = []
    const askUser = createAskUserTool({
      waitForAnswer: async (bookId: string) => { seen.push(bookId); return 'ok' },
    })
    await askUser.execute({
      args: { question: 'q', options: [{ label: 'a' }] },
      ctx: { bookId: 'book-A', bookRoot: '/tmp/a', emit: vi.fn() },
    })
    await askUser.execute({
      args: { question: 'q', options: [{ label: 'a' }] },
      ctx: { bookId: 'book-B', bookRoot: '/tmp/b', emit: vi.fn() },
    })
    expect(seen).toEqual(['book-A', 'book-B'])
  })

  it('supports multiSelect flag', async () => {
    const askUser = createAskUserTool({ waitForAnswer: () => Promise.resolve('a,b') })
    const emit = vi.fn()
    await askUser.execute({
      args: { question: 'q', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true },
      ctx: { bookId: 'b1', bookRoot: '/tmp', emit },
    })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ multiSelect: true }))
  })
})
