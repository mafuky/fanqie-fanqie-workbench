import type { ToolCall, ToolSpec } from '../providers/provider.js'
import type { AgentEvent } from '../events.js'

export interface ToolExecuteContext {
  bookId: string
  bookRoot: string
  emit: (event: AgentEvent) => void
}

export type ToolResult =
  | { ok: true; result: string }
  | { ok: false; error: string }

export interface Tool {
  spec: ToolSpec
  execute(input: { args: Record<string, unknown>; ctx: ToolExecuteContext }): Promise<ToolResult>
}

export interface ToolRegistry {
  register(tool: Tool): void
  list(): ToolSpec[]
  listFiltered(allowed: string[]): ToolSpec[]
  execute(call: ToolCall, ctx: ToolExecuteContext): Promise<ToolResult>
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>()
  return {
    register(tool) { tools.set(tool.spec.name, tool) },
    list() { return Array.from(tools.values()).map((t) => t.spec) },
    listFiltered(allowed) {
      return Array.from(tools.values()).filter((t) => allowed.includes(t.spec.name)).map((t) => t.spec)
    },
    async execute(call, ctx) {
      const tool = tools.get(call.name)
      if (!tool) return { ok: false, error: `unknown tool: ${call.name}` }
      try {
        return await tool.execute({ args: call.arguments, ctx })
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    },
  }
}
