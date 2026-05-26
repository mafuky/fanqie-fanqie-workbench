import { describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../../src/agentic/tools/tool.js'
import type { Tool, ToolExecuteContext } from '../../../src/agentic/tools/tool.js'

const fakeTool: Tool = {
  spec: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { msg: { type: 'string' } } } },
  async execute({ args }) {
    return { ok: true, result: String(args.msg ?? '') }
  },
}

const ctx: ToolExecuteContext = {
  bookId: 'b1',
  bookRoot: '/tmp/book',
  emit: vi.fn(),
}

describe('ToolRegistry', () => {
  it('registers and lists tool specs', () => {
    const reg = createToolRegistry()
    reg.register(fakeTool)
    expect(reg.list().map((s) => s.name)).toEqual(['echo'])
  })

  it('executes a registered tool with parsed args', async () => {
    const reg = createToolRegistry()
    reg.register(fakeTool)
    const result = await reg.execute({ id: 'c1', name: 'echo', arguments: { msg: 'hi' } }, ctx)
    expect(result).toEqual({ ok: true, result: 'hi' })
  })

  it('returns error for unknown tool', async () => {
    const reg = createToolRegistry()
    const result = await reg.execute({ id: 'c2', name: 'nope', arguments: {} }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unknown tool/i)
  })
})
