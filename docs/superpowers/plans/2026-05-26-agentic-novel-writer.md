# Agentic Novel Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fanqie-workbench's Claude Code CLI channel with a self-built phase-driven agent runner that supports `chapter.continue` end-to-end, multi-book parallel execution, and pluggable LLM providers (OpenAI first).

**Architecture:** New `src/agentic/` tree containing provider abstraction → tool sandbox → phase definitions → agent loop runner → multi-book pool. Web `AgentPanel` replaces `TerminalPanel`, SQLite `agent_traces` table replaces PTY scrollback. Old `src/claude/` tree deleted after switch-over.

**Tech Stack:** TypeScript 5.8, Node 20, Fastify 5, `openai` npm SDK, better-sqlite3 (WAL mode), `@fastify/websocket`, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-agentic-novel-writer-design.md`

**TDD discipline:** Every plumbing module is test-first (red → green → refactor → full suite → manual smoke). Phase prompts and LLM output quality are human-eval, not TDD. Run `npm test` after every task to verify zero regression on the existing 230-test baseline.

---

## Task 1: Add `openai` dependency

**Files:**
- Modify: `fanqie-workbench/package.json`
- Modify: `fanqie-workbench/package-lock.json`

- [ ] **Step 1: Install openai SDK**

```bash
cd fanqie-workbench && npm install openai@^4.77.0
```

- [ ] **Step 2: Verify install**

```bash
cd fanqie-workbench && node -e "import('openai').then(m => console.log('openai', m.default ? 'ok' : 'missing'))"
```

Expected: `openai ok`

- [ ] **Step 3: Run full test suite to confirm zero regression**

```bash
cd fanqie-workbench && npm test
```

Expected: all existing tests pass (~230 tests).

- [ ] **Step 4: Commit**

```bash
git add fanqie-workbench/package.json fanqie-workbench/package-lock.json
git commit -m "chore(agentic): add openai SDK dependency"
```

---

## Task 2: Provider abstraction interface

**Files:**
- Create: `fanqie-workbench/src/agentic/providers/provider.ts`
- Create: `fanqie-workbench/tests/agentic/providers/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// fanqie-workbench/tests/agentic/providers/provider.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatResult, LlmProvider, ToolCall, ToolSpec } from '../../../src/agentic/providers/provider.js'

describe('provider types', () => {
  it('ChatMessage supports assistant + tool roles', () => {
    const assistantMsg: ChatMessage = { role: 'assistant', content: 'hi', toolCalls: [] }
    const toolMsg: ChatMessage = { role: 'tool', toolCallId: 't1', name: 'read_file', content: '{}' }
    expect(assistantMsg.role).toBe('assistant')
    expect(toolMsg.toolCallId).toBe('t1')
  })

  it('ToolSpec uses JSON Schema for parameters', () => {
    const spec: ToolSpec = {
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    }
    expect(spec.parameters).toBeTypeOf('object')
  })

  it('LlmProvider interface compiles', () => {
    const fake: LlmProvider = {
      name: 'fake',
      async chat(_input): Promise<ChatResult> {
        return { content: '', toolCalls: [] as ToolCall[], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    expect(fake.name).toBe('fake')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/provider.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the interface**

```typescript
// fanqie-workbench/src/agentic/providers/provider.ts
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  usage: { promptTokens: number; completionTokens: number }
  finishReason: 'stop' | 'tool_calls' | 'length'
}

export interface ChatInput {
  messages: ChatMessage[]
  tools?: ToolSpec[]
  model: string
  maxTokens?: number
  temperature?: number
  onDelta?: (delta: string) => void
}

export interface LlmProvider {
  name: string
  chat(input: ChatInput): Promise<ChatResult>
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/providers/provider.ts fanqie-workbench/tests/agentic/providers/provider.test.ts
git commit -m "feat(agentic): add LlmProvider interface and message types"
```

---

## Task 3: OpenAI provider — non-streaming chat

**Files:**
- Create: `fanqie-workbench/src/agentic/providers/openai-provider.ts`
- Create: `fanqie-workbench/tests/agentic/providers/openai-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// fanqie-workbench/tests/agentic/providers/openai-provider.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}))

import { createOpenAiProvider } from '../../../src/agentic/providers/openai-provider.js'

describe('OpenAiProvider', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('sends messages and returns content + usage', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'hello', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.content).toBe('hello')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(result.finishReason).toBe('stop')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/openai-provider.test.ts
```

Expected: FAIL (createOpenAiProvider not exported).

- [ ] **Step 3: Write minimal implementation**

```typescript
// fanqie-workbench/src/agentic/providers/openai-provider.ts
import OpenAI from 'openai'
import type { ChatInput, ChatResult, LlmProvider } from './provider.js'

export interface OpenAiProviderOptions {
  apiKey: string
  baseUrl?: string
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
  return {
    name: 'openai',
    async chat(input: ChatInput): Promise<ChatResult> {
      const response = await client.chat.completions.create({
        model: input.model,
        messages: input.messages.map(toOpenAiMessage),
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      })
      const choice = response.choices[0]
      return {
        content: choice.message.content ?? '',
        toolCalls: [],
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason as ChatResult['finishReason'],
      }
    },
  }
}

function toOpenAiMessage(msg: import('./provider.js').ChatMessage): any {
  if (msg.role === 'tool') {
    return { role: 'tool', tool_call_id: msg.toolCallId, name: msg.name, content: msg.content }
  }
  return { role: msg.role, content: msg.content }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/openai-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/providers/openai-provider.ts fanqie-workbench/tests/agentic/providers/openai-provider.test.ts
git commit -m "feat(agentic): OpenAI provider non-streaming chat"
```

---

## Task 4: OpenAI provider — tool calls

**Files:**
- Modify: `fanqie-workbench/src/agentic/providers/openai-provider.ts`
- Modify: `fanqie-workbench/tests/agentic/providers/openai-provider.test.ts`

- [ ] **Step 1: Add failing test for tool calls**

Append to `tests/agentic/providers/openai-provider.test.ts` inside the existing `describe`:

```typescript
  it('serializes tools and parses tool_calls from response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.md"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'read a.md' }],
      tools: [{
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    })
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: { path: 'a.md' } }])
    expect(result.finishReason).toBe('tool_calls')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [{
        type: 'function',
        function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      }],
    }))
  })

  it('round-trips an assistant message with tool_calls and a tool result', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'done', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 2 },
    })
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    await provider.chat({
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.md' } }] },
        { role: 'tool', toolCallId: 'call_1', name: 'read_file', content: 'file body' },
      ],
    })
    const sent = mockCreate.mock.calls[0][0].messages
    expect(sent[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.md"}' } }],
    })
    expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'file body' })
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/openai-provider.test.ts
```

Expected: FAIL on the two new tests; first test still passes.

- [ ] **Step 3: Update implementation for tools**

Replace contents of `src/agentic/providers/openai-provider.ts`:

```typescript
import OpenAI from 'openai'
import type { ChatInput, ChatMessage, ChatResult, LlmProvider, ToolCall } from './provider.js'

export interface OpenAiProviderOptions {
  apiKey: string
  baseUrl?: string
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
  return {
    name: 'openai',
    async chat(input: ChatInput): Promise<ChatResult> {
      const response = await client.chat.completions.create({
        model: input.model,
        messages: input.messages.map(toOpenAiMessage),
        tools: input.tools?.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      })
      const choice = response.choices[0]
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
      }))
      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason as ChatResult['finishReason'],
      }
    },
  }
}

function toOpenAiMessage(msg: ChatMessage): any {
  if (msg.role === 'tool') {
    return { role: 'tool', tool_call_id: msg.toolCallId, name: msg.name, content: msg.content }
  }
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    }
  }
  return { role: msg.role, content: msg.content }
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/openai-provider.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/providers/openai-provider.ts fanqie-workbench/tests/agentic/providers/openai-provider.test.ts
git commit -m "feat(agentic): OpenAI provider supports tool calls"
```

---

## Task 5: OpenAI provider — streaming deltas

**Files:**
- Modify: `fanqie-workbench/src/agentic/providers/openai-provider.ts`
- Modify: `fanqie-workbench/tests/agentic/providers/openai-provider.test.ts`

- [ ] **Step 1: Add failing streaming test**

Append:

```typescript
  it('streams content via onDelta when stream=true', async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'he' }, finish_reason: null }] }
      yield { choices: [{ delta: { content: 'llo' }, finish_reason: null }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }
    }
    mockCreate.mockResolvedValueOnce(fakeStream())
    const deltas: string[] = []
    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const result = await provider.chat({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => deltas.push(d),
    })
    expect(deltas).toEqual(['he', 'llo'])
    expect(result.content).toBe('hello')
    expect(result.usage.promptTokens).toBe(4)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true, stream_options: { include_usage: true } }))
  })
```

- [ ] **Step 2: Run tests to confirm new test fails**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/openai-provider.test.ts
```

Expected: streaming test fails, others pass.

- [ ] **Step 3: Branch implementation on onDelta**

Add at the end of the `chat` method body inside `createOpenAiProvider`, replacing the existing body:

```typescript
    async chat(input: ChatInput): Promise<ChatResult> {
      const tools = input.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      const baseParams = {
        model: input.model,
        messages: input.messages.map(toOpenAiMessage),
        tools,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }
      if (input.onDelta) {
        const stream = await client.chat.completions.create({
          ...baseParams,
          stream: true,
          stream_options: { include_usage: true },
        } as any)
        let content = ''
        let finishReason: ChatResult['finishReason'] = 'stop'
        const toolCalls: ToolCall[] = []
        let usage = { promptTokens: 0, completionTokens: 0 }
        for await (const chunk of stream as AsyncIterable<any>) {
          const choice = chunk.choices?.[0]
          if (choice?.delta?.content) {
            content += choice.delta.content
            input.onDelta(choice.delta.content)
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason
          if (chunk.usage) {
            usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
          }
        }
        return { content, toolCalls, usage, finishReason }
      }
      const response = await client.chat.completions.create(baseParams)
      const choice = response.choices[0]
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
      }))
      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason as ChatResult['finishReason'],
      }
    },
```

- [ ] **Step 4: Run all provider tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/providers/
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/providers/openai-provider.ts fanqie-workbench/tests/agentic/providers/openai-provider.test.ts
git commit -m "feat(agentic): OpenAI provider supports streaming via onDelta"
```

---

## Task 6: Tool interface + registry

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/tool.ts`
- Create: `fanqie-workbench/tests/agentic/tools/tool.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/tool.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/tool.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement registry**

```typescript
// fanqie-workbench/src/agentic/tools/tool.ts
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
```

- [ ] **Step 4: Stub events module so import resolves**

```typescript
// fanqie-workbench/src/agentic/events.ts
export type AgentEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'message'; phase: string; role: 'user' | 'assistant'; content: string }
  | { type: 'tool-call'; phase: string; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; phase: string; toolCallId: string; name: string; result: string; ok: boolean }
  | { type: 'question'; question: string; options: Array<{ label: string }>; multiSelect: boolean }
  | { type: 'file-updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'cancelled' }
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/tool.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/tool.ts fanqie-workbench/src/agentic/events.ts fanqie-workbench/tests/agentic/tools/tool.test.ts
git commit -m "feat(agentic): tool registry + AgentEvent type"
```

---

## Task 7: Path sandbox helper + read_file tool

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/sandbox.ts`
- Create: `fanqie-workbench/src/agentic/tools/read-file.ts`
- Create: `fanqie-workbench/tests/agentic/tools/read-file.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/read-file.test.ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readFileTool } from '../../../src/agentic/tools/read-file.js'

function setupBook() {
  const root = mkdtempSync(join(tmpdir(), 'book-'))
  mkdirSync(join(root, '正文'))
  writeFileSync(join(root, '正文', '第001章.md'), 'hello world')
  return root
}

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('read_file tool', () => {
  it('reads a file inside bookRoot', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '正文/第001章.md' }, ctx: ctx(root) })
    expect(r).toEqual({ ok: true, result: 'hello world' })
  })

  it('rejects path that escapes bookRoot', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '../outside.md' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/outside book root/i)
  })

  it('returns error for missing file', async () => {
    const root = setupBook()
    const r = await readFileTool.execute({ args: { path: '正文/missing.md' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not found|ENOENT/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/read-file.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement sandbox helper**

```typescript
// fanqie-workbench/src/agentic/tools/sandbox.ts
import { resolve, sep } from 'node:path'

export function resolveInsideRoot(bookRoot: string, relative: string): string {
  const root = resolve(bookRoot)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path is outside book root: ${relative}`)
  }
  return target
}
```

- [ ] **Step 4: Implement read_file tool**

```typescript
// fanqie-workbench/src/agentic/tools/read-file.ts
import { readFile } from 'node:fs/promises'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const readFileTool: Tool = {
  spec: {
    name: 'read_file',
    description: '读取书籍根目录内的某个文本文件，返回 UTF-8 内容。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 bookRoot 的路径' } },
      required: ['path'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '')
    if (!rel) return { ok: false, error: 'path is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const content = await readFile(abs, 'utf8')
      return { ok: true, result: content }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
```

- [ ] **Step 5: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/read-file.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/sandbox.ts fanqie-workbench/src/agentic/tools/read-file.ts fanqie-workbench/tests/agentic/tools/read-file.test.ts
git commit -m "feat(agentic): read_file tool + sandbox helper"
```

---

## Task 8: list_dir tool

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/list-dir.ts`
- Create: `fanqie-workbench/tests/agentic/tools/list-dir.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/list-dir.test.ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listDirTool } from '../../../src/agentic/tools/list-dir.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('list_dir tool', () => {
  it('lists entries with type marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    mkdirSync(join(root, '设定'))
    writeFileSync(join(root, '总纲.md'), '')
    const r = await listDirTool.execute({ args: { path: '.' }, ctx: ctx(root) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const lines = r.result.split('\n').sort()
      expect(lines).toContain('设定/')
      expect(lines).toContain('总纲.md')
    }
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await listDirTool.execute({ args: { path: '../' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })

  it('returns error for missing dir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await listDirTool.execute({ args: { path: 'nope' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/list-dir.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool**

```typescript
// fanqie-workbench/src/agentic/tools/list-dir.ts
import { readdir } from 'node:fs/promises'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const listDirTool: Tool = {
  spec: {
    name: 'list_dir',
    description: '列出书籍目录下某个子目录的条目，文件夹后带 /。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 bookRoot 的路径，根目录用 "."' } },
      required: ['path'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '.')
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const entries = await readdir(abs, { withFileTypes: true })
      const lines = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n')
      return { ok: true, result: lines }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/list-dir.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/list-dir.ts fanqie-workbench/tests/agentic/tools/list-dir.test.ts
git commit -m "feat(agentic): list_dir tool"
```

---

## Task 9: grep tool

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/grep.ts`
- Create: `fanqie-workbench/tests/agentic/tools/grep.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/grep.test.ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { grepTool } from '../../../src/agentic/tools/grep.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('grep tool', () => {
  it('finds matches across files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    mkdirSync(join(root, '正文'))
    writeFileSync(join(root, '正文', 'a.md'), 'foo line\nbar line')
    writeFileSync(join(root, '正文', 'b.md'), 'no match')
    const r = await grepTool.execute({ args: { pattern: 'foo', path: '正文' }, ctx: ctx(root) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result).toMatch(/正文\/a\.md:1:foo line/)
      expect(r.result).not.toMatch(/b\.md/)
    }
  })

  it('returns empty result when nothing matches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    writeFileSync(join(root, 'x.md'), 'hello')
    const r = await grepTool.execute({ args: { pattern: 'nothere', path: '.' }, ctx: ctx(root) })
    expect(r).toEqual({ ok: true, result: '' })
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await grepTool.execute({ args: { pattern: 'x', path: '..' }, ctx: ctx(root) })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/grep.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool**

```typescript
// fanqie-workbench/src/agentic/tools/grep.ts
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.isFile()) out.push(full)
  }
  return out
}

export const grepTool: Tool = {
  spec: {
    name: 'grep',
    description: '在书籍目录内按行 grep（字符串包含匹配，区分大小写）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: '相对 bookRoot 的目录，默认 "."' },
      },
      required: ['pattern'],
    },
  },
  async execute({ args, ctx }) {
    const pattern = String(args.pattern ?? '')
    const rel = String(args.path ?? '.')
    if (!pattern) return { ok: false, error: 'pattern is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const st = await stat(abs)
      const files = st.isDirectory() ? await walk(abs) : [abs]
      const hits: string[] = []
      for (const file of files) {
        const content = await readFile(file, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(pattern)) {
            hits.push(`${relative(ctx.bookRoot, file)}:${i + 1}:${lines[i]}`)
          }
        }
      }
      return { ok: true, result: hits.join('\n') }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/grep.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/grep.ts fanqie-workbench/tests/agentic/tools/grep.test.ts
git commit -m "feat(agentic): grep tool"
```

---

## Task 10: write_file tool

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/write-file.ts`
- Create: `fanqie-workbench/tests/agentic/tools/write-file.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/write-file.test.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { writeFileTool } from '../../../src/agentic/tools/write-file.js'

const ctx = (root: string, emit = vi.fn()) => ({ bookId: 'b1', bookRoot: root, emit })

describe('write_file tool', () => {
  it('writes file inside bookRoot and emits file-updated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const emit = vi.fn()
    const r = await writeFileTool.execute({
      args: { path: '正文/第001章.md', content: 'body' },
      ctx: ctx(root, emit),
    })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(root, '正文/第001章.md'), 'utf8')).toBe('body')
    expect(emit).toHaveBeenCalledWith({ type: 'file-updated', path: '正文/第001章.md' })
  })

  it('creates intermediate directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await writeFileTool.execute({
      args: { path: '追踪/上下文.md', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(true)
  })

  it('rejects escaping path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await writeFileTool.execute({
      args: { path: '../evil.md', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/write-file.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool**

```typescript
// fanqie-workbench/src/agentic/tools/write-file.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const writeFileTool: Tool = {
  spec: {
    name: 'write_file',
    description: '写入文件到书籍目录内（自动建子目录），完成后触发 file-updated 事件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对 bookRoot 的路径' },
        content: { type: 'string', description: '完整文件内容 UTF-8' },
      },
      required: ['path', 'content'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '')
    const content = String(args.content ?? '')
    if (!rel) return { ok: false, error: 'path is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
      ctx.emit({ type: 'file-updated', path: rel })
      return { ok: true, result: `wrote ${content.length} chars to ${rel}` }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/write-file.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/write-file.ts fanqie-workbench/tests/agentic/tools/write-file.test.ts
git commit -m "feat(agentic): write_file tool with file-updated event"
```

---

## Task 11: ask_user tool (HITL pause)

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/ask-user.ts`
- Create: `fanqie-workbench/tests/agentic/tools/ask-user.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/ask-user.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/ask-user.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool factory**

The `waitForAnswer` callback takes a `bookId` so a single registered tool can serve multiple parallel books — each `execute()` looks up the right resolver via the calling book's ctx.

```typescript
// fanqie-workbench/src/agentic/tools/ask-user.ts
import type { Tool } from './tool.js'

export interface AskUserOptions {
  waitForAnswer: (bookId: string) => Promise<string>
}

export function createAskUserTool(options: AskUserOptions): Tool {
  return {
    spec: {
      name: 'ask_user',
      description: '向用户提问并等待回答。仅在缺少关键信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
          },
          multiSelect: { type: 'boolean' },
        },
        required: ['question', 'options'],
      },
    },
    async execute({ args, ctx }) {
      const question = String(args.question ?? '')
      const opts = Array.isArray(args.options) ? (args.options as Array<{ label: string }>) : []
      const multiSelect = Boolean(args.multiSelect)
      if (!question || opts.length === 0) {
        return { ok: false, error: 'question and options are required' }
      }
      ctx.emit({ type: 'question', question, options: opts, multiSelect })
      const answer = await options.waitForAnswer(ctx.bookId)
      return { ok: true, result: answer }
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/ask-user.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/ask-user.ts fanqie-workbench/tests/agentic/tools/ask-user.test.ts
git commit -m "feat(agentic): ask_user tool with HITL pause"
```

---

## Task 12: update_tracking tool

**Files:**
- Create: `fanqie-workbench/src/agentic/tools/update-tracking.ts`
- Create: `fanqie-workbench/tests/agentic/tools/update-tracking.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/tools/update-tracking.test.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { updateTrackingTool } from '../../../src/agentic/tools/update-tracking.js'

const ctx = (root: string) => ({ bookId: 'b1', bookRoot: root, emit: vi.fn() })

describe('update_tracking tool', () => {
  it('writes 上下文 file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '上下文', content: 'snapshot' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(root, '追踪/上下文.md'), 'utf8')).toBe('snapshot')
  })

  it('rejects unknown tracking file name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '随便', content: 'x' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must be one of/i)
  })

  it('rejects missing content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const r = await updateTrackingTool.execute({
      args: { file: '伏笔' },
      ctx: ctx(root),
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/update-tracking.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool**

```typescript
// fanqie-workbench/src/agentic/tools/update-tracking.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

const ALLOWED = new Set(['上下文', '伏笔', '时间线'])

export const updateTrackingTool: Tool = {
  spec: {
    name: 'update_tracking',
    description: '更新追踪文件之一：上下文 / 伏笔 / 时间线。整文件覆盖写。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', enum: ['上下文', '伏笔', '时间线'] },
        content: { type: 'string' },
      },
      required: ['file', 'content'],
    },
  },
  async execute({ args, ctx }) {
    const file = String(args.file ?? '')
    const content = typeof args.content === 'string' ? args.content : ''
    if (!ALLOWED.has(file)) {
      return { ok: false, error: `file must be one of: ${Array.from(ALLOWED).join(', ')}` }
    }
    if (!content) {
      return { ok: false, error: 'content is required' }
    }
    try {
      const rel = join('追踪', `${file}.md`)
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
      ctx.emit({ type: 'file-updated', path: rel })
      return { ok: true, result: `updated ${rel}` }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/tools/update-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/tools/update-tracking.ts fanqie-workbench/tests/agentic/tools/update-tracking.test.ts
git commit -m "feat(agentic): update_tracking tool (上下文/伏笔/时间线)"
```

---

## Task 13: agent_traces schema + TraceStore

**Files:**
- Modify: `fanqie-workbench/src/db/schema.ts` (append CREATE TABLE statements at end of `schemaSql`)
- Create: `fanqie-workbench/src/agentic/trace-store.ts`
- Create: `fanqie-workbench/tests/agentic/trace-store.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/trace-store.test.ts
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

describe('TraceStore', () => {
  it('creates trace and appends events', () => {
    const db = memDb()
    const store = createTraceStore(db)
    const traceId = store.createTrace({ bookId: 'b1', chapterId: 'c1', actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.appendEvent(traceId, { phase: 'load-context', eventType: 'phase-start', payload: {} })
    store.appendEvent(traceId, { phase: 'load-context', eventType: 'tool-call', payload: { name: 'read_file' } })
    const events = store.listEvents(traceId)
    expect(events).toHaveLength(2)
    expect(events[0].eventType).toBe('phase-start')
  })

  it('updates usage and ends trace', () => {
    const db = memDb()
    const store = createTraceStore(db)
    const traceId = store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.addUsage(traceId, { promptTokens: 100, completionTokens: 50 })
    store.addUsage(traceId, { promptTokens: 20, completionTokens: 10 })
    store.endTrace(traceId, 'succeeded')
    const trace = store.getTrace(traceId)
    expect(trace?.totalPromptTokens).toBe(120)
    expect(trace?.totalCompletionTokens).toBe(60)
    expect(trace?.status).toBe('succeeded')
    expect(trace?.endedAt).toBeTruthy()
  })

  it('lists traces for a book ordered by recency', () => {
    const db = memDb()
    const store = createTraceStore(db)
    store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's2', model: 'gpt-5' })
    const list = store.listTracesByBook('b1')
    expect(list).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/trace-store.test.ts
```

Expected: FAIL (module not found + schema missing).

- [ ] **Step 3: Append schema**

Open `fanqie-workbench/src/db/schema.ts`, find the closing `` ` `` of `schemaSql`, and insert before it:

```sql
CREATE TABLE IF NOT EXISTS agent_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  chapter_id TEXT,
  action_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_traces_book ON agent_traces(book_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id INTEGER NOT NULL REFERENCES agent_traces(id),
  phase_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_trace ON agent_trace_events(trace_id, id);
```

- [ ] **Step 4: Implement TraceStore**

```typescript
// fanqie-workbench/src/agentic/trace-store.ts
import type Database from 'better-sqlite3'

export interface CreateTraceInput {
  bookId: string
  chapterId: string | null
  actionKey: string
  sessionId: string
  model: string
}

export interface TraceRecord {
  id: number
  bookId: string
  chapterId: string | null
  actionKey: string
  sessionId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: number
  endedAt: number | null
  totalPromptTokens: number
  totalCompletionTokens: number
  model: string | null
}

export interface TraceEvent {
  id: number
  phase: string
  eventType: string
  payload: unknown
  createdAt: number
}

export interface TraceStore {
  createTrace(input: CreateTraceInput): number
  appendEvent(traceId: number, ev: { phase: string; eventType: string; payload: unknown }): void
  addUsage(traceId: number, usage: { promptTokens: number; completionTokens: number }): void
  endTrace(traceId: number, status: 'succeeded' | 'failed' | 'cancelled'): void
  getTrace(traceId: number): TraceRecord | null
  listEvents(traceId: number): TraceEvent[]
  listTracesByBook(bookId: string): TraceRecord[]
}

export function createTraceStore(db: Database.Database): TraceStore {
  return {
    createTrace(input) {
      const stmt = db.prepare(`INSERT INTO agent_traces (book_id, chapter_id, action_key, session_id, status, started_at, model) VALUES (?, ?, ?, ?, 'running', ?, ?)`)
      const info = stmt.run(input.bookId, input.chapterId, input.actionKey, input.sessionId, Date.now(), input.model)
      return Number(info.lastInsertRowid)
    },
    appendEvent(traceId, ev) {
      db.prepare(`INSERT INTO agent_trace_events (trace_id, phase_name, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(traceId, ev.phase, ev.eventType, JSON.stringify(ev.payload), Date.now())
    },
    addUsage(traceId, usage) {
      db.prepare(`UPDATE agent_traces SET total_prompt_tokens = total_prompt_tokens + ?, total_completion_tokens = total_completion_tokens + ? WHERE id = ?`)
        .run(usage.promptTokens, usage.completionTokens, traceId)
    },
    endTrace(traceId, status) {
      db.prepare(`UPDATE agent_traces SET status = ?, ended_at = ? WHERE id = ?`)
        .run(status, Date.now(), traceId)
    },
    getTrace(traceId) {
      const row: any = db.prepare(`SELECT * FROM agent_traces WHERE id = ?`).get(traceId)
      return row ? rowToRecord(row) : null
    },
    listEvents(traceId) {
      const rows: any[] = db.prepare(`SELECT * FROM agent_trace_events WHERE trace_id = ? ORDER BY id ASC`).all(traceId)
      return rows.map((r) => ({
        id: r.id,
        phase: r.phase_name,
        eventType: r.event_type,
        payload: JSON.parse(r.payload_json),
        createdAt: r.created_at,
      }))
    },
    listTracesByBook(bookId) {
      const rows: any[] = db.prepare(`SELECT * FROM agent_traces WHERE book_id = ? ORDER BY started_at DESC`).all(bookId)
      return rows.map(rowToRecord)
    },
  }
}

function rowToRecord(row: any): TraceRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    actionKey: row.action_key,
    sessionId: row.session_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    totalPromptTokens: row.total_prompt_tokens,
    totalCompletionTokens: row.total_completion_tokens,
    model: row.model,
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/trace-store.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 6: Run full suite to ensure schema change broke nothing**

```bash
cd fanqie-workbench && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add fanqie-workbench/src/db/schema.ts fanqie-workbench/src/agentic/trace-store.ts fanqie-workbench/tests/agentic/trace-store.test.ts
git commit -m "feat(agentic): agent_traces schema + TraceStore"
```

---

## Task 14: Phase interface + load-context phase

**Files:**
- Create: `fanqie-workbench/src/agentic/phases/phase.ts`
- Create: `fanqie-workbench/src/agentic/phases/load-context.ts`
- Create: `fanqie-workbench/tests/agentic/phases/load-context.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/phases/load-context.test.ts
import { describe, expect, it } from 'vitest'
import { loadContextPhase } from '../../../src/agentic/phases/load-context.js'

describe('load-context phase', () => {
  it('declares expected tools', () => {
    expect(loadContextPhase.name).toBe('load-context')
    expect(loadContextPhase.tools).toEqual(expect.arrayContaining(['read_file', 'list_dir', 'grep']))
  })

  it('builds a system prompt referencing the book root', () => {
    const prompt = loadContextPhase.systemPrompt({
      bookId: 'b1',
      bookRoot: '/x/书',
      chapterId: 'c1',
      bookMeta: { id: 'b1', title: '测试书', rootPath: '/x/书' } as any,
      chapter: { id: 'c1', chapterNumber: 5, title: '第五章', sourcePath: '正文/第005章.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(prompt).toContain('测试书')
    expect(prompt).toContain('第5章')
  })

  it('initialUserMessage asks to summarize context for the chapter', () => {
    const msg = loadContextPhase.initialUserMessage({
      bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 't', rootPath: '/x' } as any,
      chapter: { id: 'c1', chapterNumber: 5, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(msg).toMatch(/上下文|context/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/load-context.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Phase interface**

```typescript
// fanqie-workbench/src/agentic/phases/phase.ts
import type { ChatResult } from '../providers/provider.js'

export interface BookMeta {
  id: string
  title: string
  rootPath: string
}

export interface ChapterMeta {
  id: string
  chapterNumber: number
  title: string
  sourcePath: string
  stage: string
}

export interface PhaseContext {
  bookId: string
  bookRoot: string
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  previousPhaseResults: Record<string, unknown>
}

export interface Phase {
  name: string
  tools: string[]
  maxIterations: number
  systemPrompt(ctx: PhaseContext): string
  initialUserMessage(ctx: PhaseContext): string
  onComplete?(ctx: PhaseContext, result: ChatResult): Promise<Record<string, unknown> | void>
}
```

- [ ] **Step 4: Implement load-context phase**

```typescript
// fanqie-workbench/src/agentic/phases/load-context.ts
import type { Phase } from './phase.js'

export const loadContextPhase: Phase = {
  name: 'load-context',
  tools: ['read_file', 'list_dir', 'grep'],
  maxIterations: 8,
  systemPrompt(ctx) {
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》准备第${ctx.chapter.chapterNumber}章「${ctx.chapter.title}」的上下文。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `职责：`,
      `1. 用 list_dir 查看 设定/、大纲/、追踪/ 目录。`,
      `2. 用 read_file 读取本章细纲（如 大纲/细纲_第${String(ctx.chapter.chapterNumber).padStart(3, '0')}章.md）。`,
      `3. 读取上一章正文，掌握衔接点。`,
      `4. 读取 追踪/上下文.md、追踪/伏笔.md、追踪/时间线.md（如果存在）。`,
      `5. 不写文件，只 read。`,
      ``,
      `输出：一段不超过 800 字的上下文摘要，覆盖：本章应承接的剧情、关键角色当前状态、需要回收/铺设的伏笔、本章主要节奏目标。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `请加载第${ctx.chapter.chapterNumber}章「${ctx.chapter.title}」需要的上下文，最后输出摘要。`
  },
  async onComplete(_ctx, result) {
    return { contextSummary: result.content }
  },
}
```

- [ ] **Step 5: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/load-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/agentic/phases/phase.ts fanqie-workbench/src/agentic/phases/load-context.ts fanqie-workbench/tests/agentic/phases/load-context.test.ts
git commit -m "feat(agentic): Phase interface + load-context phase"
```

---

## Task 15: check-materials phase

**Files:**
- Create: `fanqie-workbench/src/agentic/phases/check-materials.ts`
- Create: `fanqie-workbench/tests/agentic/phases/check-materials.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/phases/check-materials.test.ts
import { describe, expect, it } from 'vitest'
import { checkMaterialsPhase } from '../../../src/agentic/phases/check-materials.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
  bookMeta: { id: 'b1', title: 't', rootPath: '/x' } as any,
  chapter: { id: 'c1', chapterNumber: 7, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
  previousPhaseResults: { contextSummary: 'prev summary' },
} as const

describe('check-materials phase', () => {
  it('allows ask_user tool', () => {
    expect(checkMaterialsPhase.tools).toContain('ask_user')
  })

  it('system prompt distinguishes hard vs soft missing materials', () => {
    const p = checkMaterialsPhase.systemPrompt(ctx)
    expect(p).toMatch(/硬阻塞/)
    expect(p).toMatch(/软提醒/)
  })

  it('initial user message passes previous context summary', () => {
    const m = checkMaterialsPhase.initialUserMessage(ctx)
    expect(m).toContain('prev summary')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/check-materials.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// fanqie-workbench/src/agentic/phases/check-materials.ts
import type { Phase } from './phase.js'

export const checkMaterialsPhase: Phase = {
  name: 'check-materials',
  tools: ['read_file', 'list_dir', 'ask_user'],
  maxIterations: 6,
  systemPrompt(ctx) {
    return [
      `你正在为《${ctx.bookMeta.title}》第${ctx.chapter.chapterNumber}章做写前材料检查。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `硬阻塞（缺失则必须 ask_user 让用户决定）：`,
      `- 本章细纲文件`,
      `- 章节文件 sourcePath 对应目录`,
      ``,
      `软提醒（缺失只记录，不阻塞）：`,
      `- 对标资料`,
      `- 参考资料`,
      `- 关键角色设定`,
      ``,
      `输出：一段材料齐备/缺失情况的简短报告。若硬阻塞缺失且 ask_user 拿到答复，应在报告里写明用户决定。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const summary = String(ctx.previousPhaseResults.contextSummary ?? '')
    return [
      `上一阶段加载的上下文摘要：`,
      summary,
      ``,
      `请检查写本章所需材料是否齐备。`,
    ].join('\n')
  },
  async onComplete(_ctx, result) {
    return { materialsReport: result.content }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/check-materials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/phases/check-materials.ts fanqie-workbench/tests/agentic/phases/check-materials.test.ts
git commit -m "feat(agentic): check-materials phase with HITL ask_user"
```

---

## Task 16: write-chapter phase

**Files:**
- Create: `fanqie-workbench/src/agentic/phases/write-chapter.ts`
- Create: `fanqie-workbench/tests/agentic/phases/write-chapter.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/phases/write-chapter.test.ts
import { describe, expect, it } from 'vitest'
import { writeChapterPhase } from '../../../src/agentic/phases/write-chapter.js'

const ctx = {
  bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
  bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
  chapter: { id: 'c1', chapterNumber: 9, title: '九章', sourcePath: '正文/第009章.md', stage: '待写作' } as any,
  previousPhaseResults: { contextSummary: 'cs', materialsReport: 'mr' },
} as const

describe('write-chapter phase', () => {
  it('only allows read + write tools', () => {
    expect(writeChapterPhase.tools).toEqual(expect.arrayContaining(['read_file', 'write_file']))
    expect(writeChapterPhase.tools).not.toContain('ask_user')
  })

  it('prompt instructs writing to sourcePath', () => {
    const p = writeChapterPhase.systemPrompt(ctx)
    expect(p).toContain('正文/第009章.md')
  })

  it('initial message passes context + materials', () => {
    const m = writeChapterPhase.initialUserMessage(ctx)
    expect(m).toContain('cs')
    expect(m).toContain('mr')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/write-chapter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// fanqie-workbench/src/agentic/phases/write-chapter.ts
import type { Phase } from './phase.js'

export const writeChapterPhase: Phase = {
  name: 'write-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》写第${ctx.chapter.chapterNumber}章「${ctx.chapter.title}」。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${ctx.chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 单章字数 2500-3500 字。`,
      `2. 严格承接上一章结尾，与本章细纲保持一致。`,
      `3. 风格自然，避免明显 AI 套路（"不仅...而且"、"在那一刻"、"心中暗想"等模板化句式不要堆叠）。`,
      `4. 章末留下钩子（悬念/反转/承上启下的引子）。`,
      `5. 最后用 write_file 工具把完整正文写到 ${ctx.chapter.sourcePath}。`,
      `6. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `材料检查报告：`,
      String(ctx.previousPhaseResults.materialsReport ?? ''),
      ``,
      `请开始写本章正文，写完后用 write_file 写入 ${ctx.chapter.sourcePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { written: true }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/write-chapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/phases/write-chapter.ts fanqie-workbench/tests/agentic/phases/write-chapter.test.ts
git commit -m "feat(agentic): write-chapter phase"
```

---

## Task 17: update-tracking phase

**Files:**
- Create: `fanqie-workbench/src/agentic/phases/update-tracking.ts`
- Create: `fanqie-workbench/tests/agentic/phases/update-tracking.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/phases/update-tracking.test.ts
import { describe, expect, it } from 'vitest'
import { updateTrackingPhase } from '../../../src/agentic/phases/update-tracking.js'

describe('update-tracking phase', () => {
  it('uses read_file + update_tracking tools only', () => {
    expect(updateTrackingPhase.tools).toEqual(['read_file', 'update_tracking'])
  })

  it('prompt mentions all three tracking files', () => {
    const p = updateTrackingPhase.systemPrompt({
      bookId: 'b1', bookRoot: '/x', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/x' } as any,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' } as any,
      previousPhaseResults: {},
    })
    expect(p).toContain('上下文')
    expect(p).toContain('伏笔')
    expect(p).toContain('时间线')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/update-tracking.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// fanqie-workbench/src/agentic/phases/update-tracking.ts
import type { Phase } from './phase.js'

export const updateTrackingPhase: Phase = {
  name: 'update-tracking',
  tools: ['read_file', 'update_tracking'],
  maxIterations: 6,
  systemPrompt(ctx) {
    return [
      `你刚写完《${ctx.bookMeta.title}》第${ctx.chapter.chapterNumber}章，现在维护追踪文件。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `操作：`,
      `1. 用 read_file 读 ${ctx.chapter.sourcePath} 拿到本章正文。`,
      `2. 用 read_file 读 追踪/上下文.md、追踪/伏笔.md、追踪/时间线.md 的当前内容（若文件不存在也继续）。`,
      `3. 用 update_tracking 更新这三个文件：`,
      `   - 上下文：追加/修改本章新发生的剧情、角色状态变化、关键关系。`,
      `   - 伏笔：标记本章新设的伏笔（status=open）和已回收的伏笔（status=closed）。`,
      `   - 时间线：补本章新增的时间节点。`,
      `4. 每个 update_tracking 都是整文件覆盖写，必须把已有内容合并进去再写回。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `请基于第${ctx.chapter.chapterNumber}章的新正文，更新三份追踪文件。`
  },
  async onComplete(_ctx, _result) {
    return { trackingUpdated: true }
  },
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/phases/update-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/phases/update-tracking.ts fanqie-workbench/tests/agentic/phases/update-tracking.test.ts
git commit -m "feat(agentic): update-tracking phase"
```

---

## Task 18: AgentRunner — basic phase loop

**Files:**
- Create: `fanqie-workbench/src/agentic/agent-runner.ts`
- Create: `fanqie-workbench/tests/agentic/agent-runner.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/agent-runner.test.ts
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

const phase: Phase = {
  name: 'p1',
  tools: ['echo'],
  maxIterations: 3,
  systemPrompt: () => 'sys',
  initialUserMessage: () => 'go',
}

const fakeProvider = (responses: any[]): LlmProvider => {
  let i = 0
  return {
    name: 'fake',
    async chat() {
      const r = responses[i++]
      return r
    },
  }
}

describe('AgentRunner basic loop', () => {
  it('runs a single phase to completion when model returns no tool calls', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase],
      provider: fakeProvider([
        { content: 'done', toolCalls: [], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools,
      traceStore,
      sessionId: 's1',
      model: 'gpt-5',
      emitter,
    })

    await runner.start()
    expect(runner.status).toBe('succeeded')
    const types = events.map((e) => e.type)
    expect(types).toContain('phase-start')
    expect(types).toContain('phase-done')
    expect(types).toContain('done')
  })

  it('invokes tool and feeds result back into messages', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    tools.register({
      spec: { name: 'echo', description: '', parameters: { type: 'object', properties: {} } },
      async execute({ args }) { return { ok: true, result: `echoed:${args.msg ?? ''}` } },
    })
    const emitter = new EventEmitter()

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase],
      provider: fakeProvider([
        { content: '', toolCalls: [{ id: 't1', name: 'echo', arguments: { msg: 'hi' } }], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'tool_calls' },
        { content: 'all done', toolCalls: [], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools,
      traceStore,
      sessionId: 's2',
      model: 'gpt-5',
      emitter,
    })

    await runner.start()
    expect(runner.status).toBe('succeeded')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement basic runner**

```typescript
// fanqie-workbench/src/agentic/agent-runner.ts
import type { EventEmitter } from 'node:events'
import type { ChatMessage, LlmProvider } from './providers/provider.js'
import type { Phase, BookMeta, ChapterMeta, PhaseContext } from './phases/phase.js'
import type { ToolRegistry } from './tools/tool.js'
import type { TraceStore } from './trace-store.js'
import type { AgentEvent } from './events.js'

export interface AgentRunnerOptions {
  bookId: string
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  phases: Phase[]
  provider: LlmProvider
  toolRegistry: ToolRegistry
  traceStore: TraceStore
  sessionId: string
  model: string
  emitter: EventEmitter
}

export type AgentRunnerStatus = 'pending' | 'running' | 'waiting-answer' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentRunner {
  readonly status: AgentRunnerStatus
  readonly currentPhase: string | null
  readonly traceId: number
  start(): Promise<void>
}

export function createAgentRunner(opts: AgentRunnerOptions): AgentRunner {
  const traceId = opts.traceStore.createTrace({
    bookId: opts.bookId,
    chapterId: opts.chapterId,
    actionKey: 'chapter.continue',
    sessionId: opts.sessionId,
    model: opts.model,
  })
  let status: AgentRunnerStatus = 'pending'
  let currentPhase: string | null = null
  const previousPhaseResults: Record<string, unknown> = {}

  function emit(ev: AgentEvent) {
    opts.emitter.emit('event', ev)
    opts.traceStore.appendEvent(traceId, { phase: currentPhase ?? 'system', eventType: ev.type, payload: ev })
  }

  return {
    get status() { return status },
    get currentPhase() { return currentPhase },
    traceId,
    async start() {
      status = 'running'
      try {
        for (const phase of opts.phases) {
          currentPhase = phase.name
          emit({ type: 'phase-start', phase: phase.name })
          const ctx: PhaseContext = {
            bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, chapterId: opts.chapterId,
            bookMeta: opts.bookMeta, chapter: opts.chapter, previousPhaseResults,
          }
          const messages: ChatMessage[] = [
            { role: 'system', content: phase.systemPrompt(ctx) },
            { role: 'user', content: phase.initialUserMessage(ctx) },
          ]
          let lastResult: any = null
          for (let iter = 0; iter < phase.maxIterations; iter++) {
            const tools = opts.toolRegistry.listFiltered(phase.tools)
            const result = await opts.provider.chat({
              model: opts.model,
              messages,
              tools,
            })
            opts.traceStore.addUsage(traceId, result.usage)
            emit({ type: 'message', phase: phase.name, role: 'assistant', content: result.content })
            lastResult = result
            if (result.toolCalls.length === 0) break
            messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
            for (const call of result.toolCalls) {
              emit({ type: 'tool-call', phase: phase.name, toolCallId: call.id, name: call.name, args: call.arguments })
              const toolResult = await opts.toolRegistry.execute(call, {
                bookId: opts.bookId,
                bookRoot: opts.bookMeta.rootPath,
                emit,
              })
              const content = toolResult.ok ? toolResult.result : `ERROR: ${toolResult.error}`
              emit({ type: 'tool-result', phase: phase.name, toolCallId: call.id, name: call.name, result: content, ok: toolResult.ok })
              messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
            }
          }
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) Object.assign(previousPhaseResults, update)
          }
          emit({ type: 'phase-done', phase: phase.name })
        }
        status = 'succeeded'
        opts.traceStore.endTrace(traceId, 'succeeded')
        emit({ type: 'done', status: 'succeeded' })
      } catch (err: any) {
        status = 'failed'
        opts.traceStore.endTrace(traceId, 'failed')
        emit({ type: 'error', message: err?.message ?? String(err) })
        emit({ type: 'done', status: 'failed' })
      }
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/agent-runner.ts fanqie-workbench/tests/agentic/agent-runner.test.ts
git commit -m "feat(agentic): AgentRunner basic phase loop with tool round-trip"
```

---

## Task 19: AgentRunner — ask_user pause/resume + cancel

**Files:**
- Modify: `fanqie-workbench/src/agentic/agent-runner.ts`
- Modify: `fanqie-workbench/tests/agentic/agent-runner.test.ts`

- [ ] **Step 1: Add failing tests for pause + cancel**

Append to `tests/agentic/agent-runner.test.ts`:

```typescript
import { createAskUserTool } from '../../src/agentic/tools/ask-user.js'

describe('AgentRunner pause + cancel', () => {
  it('pauses on ask_user and resumes when submitAnswer called', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))

    const resolvers = new Map<string, (s: string) => void>()
    tools.register(createAskUserTool({
      waitForAnswer: (bookId) => new Promise<string>((resolve) => { resolvers.set(bookId, resolve) }),
    }))

    const phase: Phase = {
      name: 'p1', tools: ['ask_user'], maxIterations: 3,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase],
      provider: fakeProvider([
        { content: '', toolCalls: [{ id: 'q1', name: 'ask_user', arguments: { question: 'q?', options: [{ label: 'yes' }] } }], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'tool_calls' },
        { content: 'done', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools, traceStore, sessionId: 's1', model: 'gpt-5', emitter,
      onAskUserPending: () => { /* hook so external code can mirror the pending state */ },
    })

    const promise = runner.start()
    // Wait until runner emits a question event
    await new Promise<void>((resolve) => {
      const h = (e: any) => { if (e.type === 'question') { emitter.off('event', h); resolve() } }
      emitter.on('event', h)
    })
    expect(runner.status).toBe('waiting-answer')
    // Caller forwards the answer to the resolver registered by the ask_user tool
    resolvers.get('b1')!('yes')
    await promise
    expect(runner.status).toBe('succeeded')
  })

  it('cancel sets status to cancelled and stops loop', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()

    const phase: Phase = {
      name: 'p1', tools: [], maxIterations: 5,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
    }

    let calls = 0
    const provider: LlmProvider = {
      name: 'fake',
      async chat() {
        calls++
        await new Promise((r) => setTimeout(r, 5))
        return { content: '', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      },
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase, { ...phase, name: 'p2' }],
      provider, toolRegistry: tools, traceStore, sessionId: 's2', model: 'gpt-5', emitter,
    })

    const promise = runner.start()
    runner.cancel()
    await promise
    expect(runner.status).toBe('cancelled')
    expect(calls).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```

Expected: new tests FAIL (no submitAnswer / cancel methods).

- [ ] **Step 3: Extend AgentRunner**

The runner does **not** own ask_user's resolver. The `ask_user` tool's `waitForAnswer` lives in the AgentService (Task 22) so it can serve multiple parallel books from a single registered tool. The runner only tracks status (so callers know to forward the answer) — it observes ask_user via the `tool-call` event flow and flips status back when the tool returns.

Add an optional `onAskUserPending` callback for external observers (used in pool/service to mirror state) but do not require it.

Replace `AgentRunner` interface and `createAgentRunner` body in `src/agentic/agent-runner.ts`:

```typescript
export interface AgentRunnerOptions {
  bookId: string
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  phases: Phase[]
  provider: LlmProvider
  toolRegistry: ToolRegistry
  traceStore: TraceStore
  sessionId: string
  model: string
  emitter: EventEmitter
  onAskUserPending?: (pending: boolean) => void
}

export interface AgentRunner {
  readonly status: AgentRunnerStatus
  readonly currentPhase: string | null
  readonly traceId: number
  start(): Promise<void>
  cancel(): void
  /** No-op pass-through retained for API symmetry; the actual answer goes to the ask_user tool resolver owned by AgentService. */
  submitAnswer(answer: string): void
}

export function createAgentRunner(opts: AgentRunnerOptions): AgentRunner {
  const traceId = opts.traceStore.createTrace({
    bookId: opts.bookId,
    chapterId: opts.chapterId,
    actionKey: 'chapter.continue',
    sessionId: opts.sessionId,
    model: opts.model,
  })
  let status: AgentRunnerStatus = 'pending'
  let currentPhase: string | null = null
  let cancelled = false
  const previousPhaseResults: Record<string, unknown> = {}

  function emit(ev: AgentEvent) {
    opts.emitter.emit('event', ev)
    opts.traceStore.appendEvent(traceId, { phase: currentPhase ?? 'system', eventType: ev.type, payload: ev })
  }

  function checkCancelled() {
    if (cancelled) throw new Error('cancelled')
  }

  return {
    get status() { return status },
    get currentPhase() { return currentPhase },
    traceId,
    cancel() { cancelled = true },
    submitAnswer(_answer: string) { /* delegated to ask_user tool resolver in AgentService */ },
    async start() {
      status = 'running'
      try {
        for (const phase of opts.phases) {
          checkCancelled()
          currentPhase = phase.name
          emit({ type: 'phase-start', phase: phase.name })
          const ctx: PhaseContext = {
            bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, chapterId: opts.chapterId,
            bookMeta: opts.bookMeta, chapter: opts.chapter, previousPhaseResults,
          }
          const messages: ChatMessage[] = [
            { role: 'system', content: phase.systemPrompt(ctx) },
            { role: 'user', content: phase.initialUserMessage(ctx) },
          ]
          let lastResult: any = null
          for (let iter = 0; iter < phase.maxIterations; iter++) {
            checkCancelled()
            const tools = opts.toolRegistry.listFiltered(phase.tools)
            const result = await opts.provider.chat({ model: opts.model, messages, tools })
            opts.traceStore.addUsage(traceId, result.usage)
            emit({ type: 'message', phase: phase.name, role: 'assistant', content: result.content })
            lastResult = result
            if (result.toolCalls.length === 0) break
            messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
            for (const call of result.toolCalls) {
              checkCancelled()
              emit({ type: 'tool-call', phase: phase.name, toolCallId: call.id, name: call.name, args: call.arguments })
              if (call.name === 'ask_user') {
                status = 'waiting-answer'
                opts.onAskUserPending?.(true)
              }
              const toolResult = await opts.toolRegistry.execute(call, {
                bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, emit,
              })
              if (call.name === 'ask_user') {
                status = 'running'
                opts.onAskUserPending?.(false)
              }
              const content = toolResult.ok ? toolResult.result : `ERROR: ${toolResult.error}`
              emit({ type: 'tool-result', phase: phase.name, toolCallId: call.id, name: call.name, result: content, ok: toolResult.ok })
              messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
            }
          }
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) Object.assign(previousPhaseResults, update)
          }
          emit({ type: 'phase-done', phase: phase.name })
        }
        status = 'succeeded'
        opts.traceStore.endTrace(traceId, 'succeeded')
        emit({ type: 'done', status: 'succeeded' })
      } catch (err: any) {
        if (cancelled) {
          status = 'cancelled'
          opts.traceStore.endTrace(traceId, 'cancelled')
          emit({ type: 'done', status: 'cancelled' })
        } else {
          status = 'failed'
          opts.traceStore.endTrace(traceId, 'failed')
          emit({ type: 'error', message: err?.message ?? String(err) })
          emit({ type: 'done', status: 'failed' })
        }
      }
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/agent-runner.ts fanqie-workbench/tests/agentic/agent-runner.test.ts
git commit -m "feat(agentic): AgentRunner cancel + ask_user pause"
```

---

## Task 20: AgentRunnerPool

**Files:**
- Create: `fanqie-workbench/src/agentic/agent-runner-pool.ts`
- Create: `fanqie-workbench/tests/agentic/agent-runner-pool.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/agent-runner-pool.test.ts
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createAgentRunnerPool } from '../../src/agentic/agent-runner-pool.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

const phase: Phase = {
  name: 'p1', tools: [], maxIterations: 1,
  systemPrompt: () => 's', initialUserMessage: () => 'go',
}

const slowProvider: LlmProvider = {
  name: 'fake',
  async chat() {
    await new Promise((r) => setTimeout(r, 50))
    return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
  },
}

describe('AgentRunnerPool', () => {
  it('rejects second start for same bookId while first runs', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 5, model: 'gpt-5',
    })
    const runner1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], sessionId: 's1', emitter: new EventEmitter(),
    })
    await expect(pool.start({
      bookId: 'b1', chapterId: 'c2',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c2', chapterNumber: 2, title: 't', sourcePath: 'b.md', stage: '待写作' },
      phases: [phase], sessionId: 's2', emitter: new EventEmitter(),
    })).rejects.toThrow(/already running/i)
    await waitForFinish(runner1)
  })

  it('rejects when maxConcurrent reached', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    const r1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], sessionId: 's1', emitter: new EventEmitter(),
    })
    await expect(pool.start({
      bookId: 'b2', chapterId: 'c1',
      bookMeta: { id: 'b2', title: 'T2', rootPath: '/tmp/2' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], sessionId: 's2', emitter: new EventEmitter(),
    })).rejects.toThrow(/concurrent limit/i)
    await waitForFinish(r1)
  })

  it('releases slot when runner finishes', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    const r1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], sessionId: 's1', emitter: new EventEmitter(),
    })
    await waitForFinish(r1)
    const r2 = await pool.start({
      bookId: 'b2', chapterId: 'c1',
      bookMeta: { id: 'b2', title: 'T2', rootPath: '/tmp/2' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], sessionId: 's2', emitter: new EventEmitter(),
    })
    await waitForFinish(r2)
    expect(r2.status).toBe('succeeded')
  })
})

async function waitForFinish(runner: { status: string }) {
  while (runner.status === 'running' || runner.status === 'pending') {
    await new Promise((r) => setTimeout(r, 10))
  }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner-pool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement pool**

```typescript
// fanqie-workbench/src/agentic/agent-runner-pool.ts
import type { EventEmitter } from 'node:events'
import { createAgentRunner } from './agent-runner.js'
import type { AgentRunner } from './agent-runner.js'
import type { BookMeta, ChapterMeta, Phase } from './phases/phase.js'
import type { LlmProvider } from './providers/provider.js'
import type { ToolRegistry } from './tools/tool.js'
import type { TraceStore } from './trace-store.js'

export interface AgentRunnerPoolOptions {
  provider: LlmProvider
  traceStore: TraceStore
  toolRegistry: ToolRegistry
  maxConcurrent: number
  model: string
}

export interface PoolStartInput {
  bookId: string
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  phases: Phase[]
  sessionId: string
  emitter: EventEmitter
}

export interface AgentRunnerPool {
  start(input: PoolStartInput): Promise<AgentRunner>
  get(bookId: string): AgentRunner | null
  cancel(bookId: string): void
  activeCount(): number
}

export function createAgentRunnerPool(opts: AgentRunnerPoolOptions): AgentRunnerPool {
  const active = new Map<string, AgentRunner>()

  return {
    activeCount() { return active.size },
    get(bookId) { return active.get(bookId) ?? null },
    cancel(bookId) { active.get(bookId)?.cancel() },
    async start(input) {
      if (active.has(input.bookId)) {
        throw new Error(`book ${input.bookId} already running`)
      }
      if (active.size >= opts.maxConcurrent) {
        throw new Error(`concurrent limit reached (${opts.maxConcurrent})`)
      }
      const runner = createAgentRunner({
        bookId: input.bookId, chapterId: input.chapterId,
        bookMeta: input.bookMeta, chapter: input.chapter,
        phases: input.phases,
        provider: opts.provider,
        toolRegistry: opts.toolRegistry,
        traceStore: opts.traceStore,
        sessionId: input.sessionId,
        model: opts.model,
        emitter: input.emitter,
      })
      active.set(input.bookId, runner)
      input.emitter.on('event', (ev: any) => {
        if (ev.type === 'done') active.delete(input.bookId)
      })
      void runner.start()
      return runner
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-runner-pool.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/agent-runner-pool.ts fanqie-workbench/tests/agentic/agent-runner-pool.test.ts
git commit -m "feat(agentic): AgentRunnerPool with per-book mutex + concurrency cap"
```

---

## Task 21: Action Router

**Files:**
- Create: `fanqie-workbench/src/agentic/action-router.ts`
- Create: `fanqie-workbench/tests/agentic/action-router.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/action-router.test.ts
import { describe, expect, it } from 'vitest'
import { routeAction } from '../../src/agentic/action-router.js'

describe('routeAction', () => {
  it('returns phase sequence for chapter.continue', () => {
    const phases = routeAction('chapter.continue')
    expect(phases.map((p) => p.name)).toEqual([
      'load-context', 'check-materials', 'write-chapter', 'update-tracking',
    ])
  })

  it('throws for unknown action', () => {
    expect(() => routeAction('chapter.unknown')).toThrow(/unknown action/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/action-router.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// fanqie-workbench/src/agentic/action-router.ts
import { loadContextPhase } from './phases/load-context.js'
import { checkMaterialsPhase } from './phases/check-materials.js'
import { writeChapterPhase } from './phases/write-chapter.js'
import { updateTrackingPhase } from './phases/update-tracking.js'
import type { Phase } from './phases/phase.js'

const ACTION_PHASES: Record<string, Phase[]> = {
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase],
}

export function routeAction(actionKey: string): Phase[] {
  const phases = ACTION_PHASES[actionKey]
  if (!phases) throw new Error(`unknown action: ${actionKey}`)
  return phases
}

export function listActions(): string[] {
  return Object.keys(ACTION_PHASES)
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/action-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/action-router.ts fanqie-workbench/tests/agentic/action-router.test.ts
git commit -m "feat(agentic): action router for chapter.continue"
```

---

## Task 22: Agent session bootstrap (factory binding pool + tools + provider)

**Files:**
- Create: `fanqie-workbench/src/agentic/agent-service.ts`
- Create: `fanqie-workbench/tests/agentic/agent-service.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/agent-service.test.ts
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'

const fakeProvider: LlmProvider = {
  name: 'fake',
  async chat() {
    return { content: 'done', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
  },
}

describe('AgentService', () => {
  it('starts a chapter.continue session and routes events through provided emitter', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const service = createAgentService({ db, provider: fakeProvider, model: 'gpt-5', maxConcurrent: 5 })
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))
    const runner = await service.start({
      actionKey: 'chapter.continue',
      bookMeta: { id: 'b1', title: 'T', rootPath: root },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's1', emitter,
    })
    while (runner.status === 'running' || runner.status === 'pending') {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(runner.status).toBe('succeeded')
    expect(events.some((e) => e.type === 'phase-start' && e.phase === 'load-context')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement service**

```typescript
// fanqie-workbench/src/agentic/agent-service.ts
import type Database from 'better-sqlite3'
import type { EventEmitter } from 'node:events'
import { routeAction } from './action-router.js'
import { createAgentRunnerPool } from './agent-runner-pool.js'
import type { AgentRunner } from './agent-runner.js'
import { createTraceStore } from './trace-store.js'
import { createToolRegistry } from './tools/tool.js'
import { readFileTool } from './tools/read-file.js'
import { listDirTool } from './tools/list-dir.js'
import { grepTool } from './tools/grep.js'
import { writeFileTool } from './tools/write-file.js'
import { updateTrackingTool } from './tools/update-tracking.js'
import { createAskUserTool } from './tools/ask-user.js'
import type { LlmProvider } from './providers/provider.js'
import type { BookMeta, ChapterMeta } from './phases/phase.js'

export interface AgentServiceOptions {
  db: Database.Database
  provider: LlmProvider
  model: string
  maxConcurrent: number
}

export interface AgentStartInput {
  actionKey: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  sessionId: string
  emitter: EventEmitter
}

export interface AgentService {
  start(input: AgentStartInput): Promise<AgentRunner>
  cancel(bookId: string): void
  get(bookId: string): AgentRunner | null
  submitAnswer(bookId: string, answer: string): void
}

export function createAgentService(opts: AgentServiceOptions): AgentService {
  const traceStore = createTraceStore(opts.db)
  // bookId → resolver waiting on the user's answer for that book
  const pendingAnswers = new Map<string, (s: string) => void>()
  const tools = createToolRegistry()
  tools.register(readFileTool)
  tools.register(listDirTool)
  tools.register(grepTool)
  tools.register(writeFileTool)
  tools.register(updateTrackingTool)
  tools.register(createAskUserTool({
    waitForAnswer: (bookId) => new Promise<string>((resolve) => {
      pendingAnswers.set(bookId, resolve)
    }),
  }))

  const pool = createAgentRunnerPool({
    provider: opts.provider,
    traceStore,
    toolRegistry: tools,
    maxConcurrent: opts.maxConcurrent,
    model: opts.model,
  })

  return {
    get(bookId) { return pool.get(bookId) },
    cancel(bookId) { pool.cancel(bookId) },
    submitAnswer(bookId, answer) {
      const resolver = pendingAnswers.get(bookId)
      if (resolver) {
        resolver(answer)
        pendingAnswers.delete(bookId)
      }
    },
    async start(input) {
      const phases = routeAction(input.actionKey)
      return pool.start({
        bookId: input.bookMeta.id,
        chapterId: input.chapter.id,
        bookMeta: input.bookMeta,
        chapter: input.chapter,
        phases,
        sessionId: input.sessionId,
        emitter: input.emitter,
      })
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/agent-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/agentic/agent-service.ts fanqie-workbench/tests/agentic/agent-service.test.ts
git commit -m "feat(agentic): AgentService factory wiring tools + pool + router"
```

---

## Task 23: REST routes for agent sessions

**Files:**
- Create: `fanqie-workbench/src/server/routes/agent-sessions.ts`
- Modify: `fanqie-workbench/src/server/app.ts` (register route)
- Create: `fanqie-workbench/tests/server/agent-sessions-route.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/server/agent-sessions-route.test.ts
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

function buildApp() {
  const db = new Database(':memory:'); db.exec(schemaSql)
  const root = mkdtempSync(join(tmpdir(), 'book-'))
  db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run('b1', 'T', root)
  db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`).run('c1', 'b1', 1, 't', '正文/第001章.md', '待写作')
  const service = createAgentService({
    db,
    provider: { name: 'fake', async chat() { return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' } } },
    model: 'gpt-5',
    maxConcurrent: 5,
  })
  const app = Fastify()
  registerAgentSessionsRoutes(app, { db, service })
  return { app, service, db }
}

describe('agent-sessions routes', () => {
  it('POST /api/agent-sessions starts a chapter.continue run', async () => {
    const { app } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' },
    })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.sessionId).toBeTruthy()
    expect(body.status).toBeTruthy()
  })

  it('POST returns 409 when book already running', async () => {
    const { app } = buildApp()
    await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    const r = await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    expect(r.statusCode).toBe(409)
  })

  it('POST /api/agent-sessions/:id/cancel returns 200', async () => {
    const { app } = buildApp()
    const start = await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    const sessionId = JSON.parse(start.body).sessionId
    const r = await app.inject({ method: 'POST', url: `/api/agent-sessions/${sessionId}/cancel` })
    expect(r.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/server/agent-sessions-route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement routes**

```typescript
// fanqie-workbench/src/server/routes/agent-sessions.ts
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { AgentService } from '../../agentic/agent-service.js'

export interface AgentSessionsDeps {
  db: Database.Database
  service: AgentService
}

const sessionEmitters = new Map<string, EventEmitter>()
const sessionToBook = new Map<string, string>()

export function getSessionEmitter(sessionId: string): EventEmitter | undefined {
  return sessionEmitters.get(sessionId)
}

export function getSessionBook(sessionId: string): string | undefined {
  return sessionToBook.get(sessionId)
}

export function registerAgentSessionsRoutes(app: FastifyInstance, deps: AgentSessionsDeps) {
  app.post<{ Body: { actionKey: string; bookId: string; chapterId: string } }>(
    '/api/agent-sessions',
    async (req, reply) => {
      const { actionKey, bookId, chapterId } = req.body
      const book: any = deps.db.prepare(`SELECT id, title, root_path FROM books WHERE id = ?`).get(bookId)
      if (!book) return reply.code(404).send({ error: 'book not found' })
      const chapter: any = deps.db.prepare(`SELECT id, book_id, chapter_number, title, source_path, stage FROM chapters WHERE id = ?`).get(chapterId)
      if (!chapter) return reply.code(404).send({ error: 'chapter not found' })
      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      try {
        const runner = await deps.service.start({
          actionKey,
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title,
            sourcePath: chapter.source_path, stage: chapter.stage,
          },
          sessionId, emitter,
        })
        return { sessionId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        if (/already running|concurrent limit/i.test(err.message)) {
          return reply.code(409).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    },
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId/cancel',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      deps.service.cancel(bookId)
      return { ok: true }
    },
  )

  app.post<{ Params: { sessionId: string }; Body: { answer: string } }>(
    '/api/agent-sessions/:sessionId/answer',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      deps.service.submitAnswer(bookId, req.body.answer)
      return { ok: true }
    },
  )

  app.get<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      const runner = deps.service.get(bookId)
      return { status: runner?.status ?? 'unknown', currentPhase: runner?.currentPhase ?? null }
    },
  )
}
```

- [ ] **Step 4: Register in app.ts**

In `fanqie-workbench/src/server/app.ts`, after the existing route registrations and after creating the DB + agent service, add:

```typescript
import { createAgentService } from '../agentic/agent-service.js'
import { createOpenAiProvider } from '../agentic/providers/openai-provider.js'
import { registerAgentSessionsRoutes } from './routes/agent-sessions.js'

// inside startup, after openDatabase(...)
const provider = createOpenAiProvider({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  baseUrl: process.env.OPENAI_BASE_URL,
})
const agentService = createAgentService({
  db,
  provider,
  model: process.env.AGENT_DEFAULT_MODEL ?? 'gpt-5',
  maxConcurrent: Number(process.env.AGENT_MAX_CONCURRENT_BOOKS ?? 5),
})
registerAgentSessionsRoutes(app, { db, service: agentService })
```

(Read `src/server/app.ts` first; insert these lines at the proper place where `app` and `db` are already in scope.)

- [ ] **Step 5: Run route tests**

```bash
cd fanqie-workbench && npx vitest run tests/server/agent-sessions-route.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 6: Run full suite**

```bash
cd fanqie-workbench && npm test
```

Expected: zero regression.

- [ ] **Step 7: Commit**

```bash
git add fanqie-workbench/src/server/routes/agent-sessions.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/server/agent-sessions-route.test.ts
git commit -m "feat(agentic): REST routes /api/agent-sessions"
```

---

## Task 24: WebSocket route + history replay

**Files:**
- Create: `fanqie-workbench/src/server/routes/agent-ws.ts`
- Modify: `fanqie-workbench/src/server/app.ts` (register WS route)
- Create: `fanqie-workbench/tests/server/agent-ws.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/server/agent-ws.test.ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { registerAgentWsRoute } from '../../src/server/routes/agent-ws.js'

describe('agent WebSocket route', () => {
  it('upgrades, replays history events, then forwards new events', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const traceStore = createTraceStore(db)
    const traceId = traceStore.createTrace({ bookId: 'b1', chapterId: 'c1', actionKey: 'chapter.continue', sessionId: 'sess-1', model: 'gpt-5' })
    traceStore.appendEvent(traceId, { phase: 'load-context', eventType: 'phase-start', payload: { type: 'phase-start', phase: 'load-context' } })

    const emitter = new EventEmitter()
    const app = Fastify()
    await app.register(websocket)
    registerAgentWsRoute(app, {
      getSessionEmitter: () => emitter,
      getSessionTraceId: () => traceId,
      traceStore,
    })
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port

    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent-sessions/sess-1/stream`)
    const got: any[] = []
    ws.on('message', (msg) => got.push(JSON.parse(msg.toString())))
    await new Promise((r) => ws.on('open', r))
    await new Promise((r) => setTimeout(r, 30))
    expect(got.some((m) => m.type === 'history')).toBe(true)

    emitter.emit('event', { type: 'message', phase: 'load-context', role: 'assistant', content: 'hi' })
    await new Promise((r) => setTimeout(r, 30))
    expect(got.some((m) => m.type === 'message' && m.content === 'hi')).toBe(true)

    ws.close()
    await app.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/server/agent-ws.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement WS route**

```typescript
// fanqie-workbench/src/server/routes/agent-ws.ts
import type { FastifyInstance } from 'fastify'
import type { EventEmitter } from 'node:events'
import type { TraceStore } from '../../agentic/trace-store.js'

export interface AgentWsDeps {
  getSessionEmitter(sessionId: string): EventEmitter | undefined
  getSessionTraceId(sessionId: string): number | undefined
  traceStore: TraceStore
}

export function registerAgentWsRoute(app: FastifyInstance, deps: AgentWsDeps) {
  app.get<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId/stream',
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params as { sessionId: string }
      const emitter = deps.getSessionEmitter(sessionId)
      const traceId = deps.getSessionTraceId(sessionId)
      if (!emitter || traceId === undefined) {
        socket.send(JSON.stringify({ type: 'error', message: 'session not found' }))
        socket.close()
        return
      }
      const history = deps.traceStore.listEvents(traceId).map((e) => e.payload)
      socket.send(JSON.stringify({ type: 'history', events: history }))
      const handler = (ev: any) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(ev))
      }
      emitter.on('event', handler)
      socket.on('close', () => emitter.off('event', handler))
    },
  )
}
```

- [ ] **Step 4: Wire into app.ts**

In `fanqie-workbench/src/server/app.ts`, where you already have agentService and registerAgentSessionsRoutes, add:

```typescript
import { registerAgentWsRoute } from './routes/agent-ws.js'
import { getSessionEmitter, getSessionBook } from './routes/agent-sessions.js'

registerAgentWsRoute(app, {
  getSessionEmitter,
  getSessionTraceId: (sessionId) => {
    const bookId = getSessionBook(sessionId)
    if (!bookId) return undefined
    return agentService.get(bookId)?.traceId
  },
  traceStore: createTraceStore(db),
})
```

> Make sure `@fastify/websocket` is registered before this route — it already is for the legacy pty-ws route. If not, register it once at startup.

- [ ] **Step 5: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/server/agent-ws.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
cd fanqie-workbench && npm test
```

Expected: no regression.

- [ ] **Step 7: Commit**

```bash
git add fanqie-workbench/src/server/routes/agent-ws.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/server/agent-ws.test.ts
git commit -m "feat(agentic): WebSocket stream + history replay"
```

---

## Task 25: AgentPanel React component (basic event rendering)

**Files:**
- Create: `fanqie-workbench/src/web/components/agent-panel.tsx`
- Create: `fanqie-workbench/tests/web/agent-panel.test.tsx`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/web/agent-panel.test.tsx
import { render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPanel } from '../../src/web/components/agent-panel.js'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  listeners: Record<string, ((e: any) => void)[]> = {}
  sent: any[] = []
  constructor(public url: string) { FakeSocket.last = this }
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ??= []).push(cb) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() {}
  fire(type: string, evt: any) { (this.listeners[type] ?? []).forEach((cb) => cb(evt)) }
}

beforeAll(() => { (global as any).WebSocket = FakeSocket })
afterEach(() => { FakeSocket.last = null })

describe('AgentPanel', () => {
  it('renders phase progression', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('open', {})
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'history', events: [] }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'load-context' }) })
    })
    expect(screen.getByText(/load-context/)).toBeTruthy()
  })

  it('renders tool calls under their phase', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'write-chapter' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'tool-call', phase: 'write-chapter', toolCallId: 't1', name: 'write_file', args: { path: 'a.md' } }) })
    })
    expect(screen.getByText(/write_file/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/web/agent-panel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement component (basic)**

```typescript
// fanqie-workbench/src/web/components/agent-panel.tsx
import { useEffect, useRef, useState } from 'react'

type Event =
  | { type: 'history'; events: Event[] }
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'message'; phase: string; role: string; content: string }
  | { type: 'tool-call'; phase: string; toolCallId: string; name: string; args: any }
  | { type: 'tool-result'; phase: string; toolCallId: string; name: string; result: string; ok: boolean }
  | { type: 'question'; question: string; options: { label: string }[]; multiSelect: boolean }
  | { type: 'file-updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: string }

export function AgentPanel({ sessionId, onDone }: { sessionId: string; onDone?: (status: string) => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/api/agent-sessions/${sessionId}/stream`)
    wsRef.current = ws
    ws.addEventListener('message', (e: any) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'history') {
        setEvents(msg.events)
      } else {
        setEvents((prev) => [...prev, msg])
        if (msg.type === 'done') onDone?.(msg.status)
      }
    })
    return () => ws.close()
  }, [sessionId, onDone])

  const grouped: Record<string, Event[]> = {}
  let currentPhase = 'init'
  for (const ev of events) {
    if (ev.type === 'phase-start') currentPhase = ev.phase
    ;(grouped[currentPhase] ??= []).push(ev)
  }

  return (
    <div data-testid="agent-panel" style={{ fontFamily: 'monospace', fontSize: 13 }}>
      {Object.entries(grouped).map(([phase, evs]) => (
        <div key={phase} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>▶ {phase}</div>
          {evs.map((ev, i) => (
            <div key={i} style={{ paddingLeft: 16 }}>
              {ev.type === 'tool-call' && <span>📞 {ev.name}({JSON.stringify(ev.args)})</span>}
              {ev.type === 'tool-result' && <span>{ev.ok ? '✓' : '✗'} {ev.name}: {ev.result.slice(0, 80)}</span>}
              {ev.type === 'message' && <span>💬 {ev.content.slice(0, 200)}</span>}
              {ev.type === 'file-updated' && <span>📝 {ev.path}</span>}
              {ev.type === 'error' && <span style={{ color: 'red' }}>{ev.message}</span>}
              {ev.type === 'phase-done' && <span>✓ done</span>}
              {ev.type === 'done' && <span>● {ev.status}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/web/agent-panel.test.tsx
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/components/agent-panel.tsx fanqie-workbench/tests/web/agent-panel.test.tsx
git commit -m "feat(agentic): AgentPanel renders phases + tool calls + events"
```

---

## Task 26: AgentPanel HITL question card

**Files:**
- Modify: `fanqie-workbench/src/web/components/agent-panel.tsx`
- Modify: `fanqie-workbench/tests/web/agent-panel.test.tsx`

- [ ] **Step 1: Add failing test for question card + answer submission**

Append to `tests/web/agent-panel.test.tsx`:

```typescript
import { fireEvent } from '@testing-library/react'

it('shows question card and POSTs answer on click', async () => {
  const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any)
  render(<AgentPanel sessionId="s9" />)
  await act(async () => {
    FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'question', question: '继续吗？', options: [{ label: '继续' }, { label: '终止' }], multiSelect: false }) })
  })
  fireEvent.click(screen.getByText('继续'))
  expect(fetchSpy).toHaveBeenCalledWith('/api/agent-sessions/s9/answer', expect.objectContaining({ method: 'POST' }))
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/web/agent-panel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Update component to render question card**

Add to `agent-panel.tsx` inside `AgentPanel`, before the `grouped` block:

```typescript
  const pendingQuestion = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'question') return e
      if (e.type === 'message' || e.type === 'tool-result') return null
    }
    return null
  })()

  async function answer(label: string) {
    await fetch(`/api/agent-sessions/${sessionId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: label }),
    })
    setEvents((prev) => [...prev, { type: 'message' as const, phase: 'system', role: 'user', content: `[answered] ${label}` }])
  }
```

Then in the returned JSX, before the `Object.entries(grouped).map(...)`:

```tsx
      {pendingQuestion && pendingQuestion.type === 'question' && (
        <div role="dialog" style={{ border: '2px solid #007', padding: 12, marginBottom: 12, background: '#1a1a2e' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{pendingQuestion.question}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingQuestion.options.map((opt) => (
              <button key={opt.label} onClick={() => answer(opt.label)}>{opt.label}</button>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/web/agent-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanqie-workbench/src/web/components/agent-panel.tsx fanqie-workbench/tests/web/agent-panel.test.tsx
git commit -m "feat(agentic): AgentPanel HITL question card POSTs answer"
```

---

## Task 27: Wire AgentPanel into BookWorkspacePage

**Files:**
- Modify: `fanqie-workbench/src/web/pages/book-workspace-page.tsx` (replace TerminalPanel usage)
- Modify: `fanqie-workbench/tests/web/book-workspace-page.test.tsx`

- [ ] **Step 1: Read existing page to understand current TerminalPanel wiring**

```bash
cd fanqie-workbench && grep -n "TerminalPanel\|terminal-panel\|live-log-panel" src/web/pages/book-workspace-page.tsx tests/web/book-workspace-page.test.tsx
```

- [ ] **Step 2: Update test to expect AgentPanel mount**

Modify the existing book-workspace-page test: find the section that asserts TerminalPanel renders after starting `chapter.continue`, replace the assertion with:

```typescript
expect(screen.getByTestId('agent-panel')).toBeTruthy()
```

And replace any mock of `/api/sessions/:id/terminal` with a stub for `POST /api/agent-sessions` returning `{ sessionId: 's1', status: 'running', traceId: 1 }`.

- [ ] **Step 3: Run to verify failure**

```bash
cd fanqie-workbench && npx vitest run tests/web/book-workspace-page.test.tsx
```

Expected: FAIL on the new assertion.

- [ ] **Step 4: Replace TerminalPanel import + usage with AgentPanel**

In `src/web/pages/book-workspace-page.tsx`:

- Replace `import { TerminalPanel } from '../components/terminal-panel.js'` with `import { AgentPanel } from '../components/agent-panel.js'`
- Replace `<TerminalPanel sessionId={...} onDone={...} />` with `<AgentPanel sessionId={...} onDone={...} />`
- Replace the action-trigger handler that previously called `/api/actions` or `/api/sessions` with `POST /api/agent-sessions` that sends `{ actionKey: 'chapter.continue', bookId, chapterId }` and stores the returned sessionId.

- [ ] **Step 5: Run tests**

```bash
cd fanqie-workbench && npx vitest run tests/web/book-workspace-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add fanqie-workbench/src/web/pages/book-workspace-page.tsx fanqie-workbench/tests/web/book-workspace-page.test.tsx
git commit -m "feat(agentic): BookWorkspacePage uses AgentPanel + /api/agent-sessions"
```

---

## Task 28: End-to-end happy path (single book)

**Files:**
- Create: `fanqie-workbench/tests/agentic.e2e.spec.ts`

- [ ] **Step 1: Write E2E spec**

```typescript
// fanqie-workbench/tests/agentic.e2e.spec.ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('chapter.continue end-to-end writes file and updates tracking', async ({ page }) => {
  // Use FAKE_PROVIDER env so server uses a deterministic fake instead of OpenAI
  // (Server must read AGENT_PROVIDER=fake at startup.)
  const root = mkdtempSync(join(tmpdir(), 'e2e-book-'))
  mkdirSync(join(root, '正文'), { recursive: true })
  mkdirSync(join(root, '大纲'), { recursive: true })
  writeFileSync(join(root, '大纲', '细纲_第001章.md'), '主角醒来在医院')

  // Test harness: assume the test server uses a temp DB seeded with this book
  await page.goto(`http://127.0.0.1:5173/?bookRoot=${encodeURIComponent(root)}`)
  await page.getByText('继续写本章').click()
  await expect(page.getByTestId('agent-panel')).toBeVisible()
  await expect(page.getByText('● succeeded')).toBeVisible({ timeout: 30_000 })
  expect(existsSync(join(root, '正文/第001章.md'))).toBe(true)
  expect(readFileSync(join(root, '追踪/上下文.md'), 'utf8').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Add fake provider wiring**

Add to `src/agentic/providers/fake-provider.ts`:

```typescript
import type { LlmProvider } from './provider.js'

export function createFakeProvider(): LlmProvider {
  return {
    name: 'fake',
    async chat({ messages }) {
      const last = messages[messages.length - 1]?.content ?? ''
      if (last.includes('加载第') && last.includes('上下文')) {
        return { content: '上下文摘要：略', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      }
      if (last.includes('材料')) {
        return { content: '材料齐备', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      }
      if (last.includes('正文') && last.includes('write_file')) {
        return {
          content: '',
          toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: '正文/第001章.md', content: '## 第001章\n\n主角醒来。' } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool_calls',
        }
      }
      if (last.includes('追踪')) {
        return {
          content: '',
          toolCalls: [{ id: 'u1', name: 'update_tracking', arguments: { file: '上下文', content: '第001章：主角醒来' } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool_calls',
        }
      }
      return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
    },
  }
}
```

Modify `src/server/app.ts` provider creation:

```typescript
import { createFakeProvider } from '../agentic/providers/fake-provider.js'
const provider = process.env.AGENT_PROVIDER === 'fake'
  ? createFakeProvider()
  : createOpenAiProvider({ apiKey: process.env.OPENAI_API_KEY ?? '', baseUrl: process.env.OPENAI_BASE_URL })
```

- [ ] **Step 3: Run E2E**

```bash
cd fanqie-workbench && AGENT_PROVIDER=fake npm run test:e2e -- tests/agentic.e2e.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add fanqie-workbench/src/agentic/providers/fake-provider.ts fanqie-workbench/src/server/app.ts fanqie-workbench/tests/agentic.e2e.spec.ts
git commit -m "test(agentic): E2E chapter.continue happy path with fake provider"
```

---

## Task 29: Multi-book parallel integration test

**Files:**
- Create: `fanqie-workbench/tests/agentic/multi-book-parallel.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// fanqie-workbench/tests/agentic/multi-book-parallel.test.ts
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import { createFakeProvider } from '../../src/agentic/providers/fake-provider.js'

function bookCtx(label: string) {
  const root = mkdtempSync(join(tmpdir(), `book-${label}-`))
  mkdirSync(join(root, '大纲'), { recursive: true })
  return { id: `b-${label}`, title: label, rootPath: root }
}

describe('multi-book parallel', () => {
  it('runs two books simultaneously without bleed', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const service = createAgentService({ db, provider: createFakeProvider(), model: 'gpt-5', maxConcurrent: 5 })
    const meta1 = bookCtx('A')
    const meta2 = bookCtx('B')

    const events1: any[] = []
    const events2: any[] = []
    const em1 = new EventEmitter(); em1.on('event', (e) => events1.push(e))
    const em2 = new EventEmitter(); em2.on('event', (e) => events2.push(e))

    const r1 = await service.start({
      actionKey: 'chapter.continue', bookMeta: meta1,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's1', emitter: em1,
    })
    const r2 = await service.start({
      actionKey: 'chapter.continue', bookMeta: meta2,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's2', emitter: em2,
    })

    while ([r1.status, r2.status].some((s) => s === 'pending' || s === 'running')) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(r1.status).toBe('succeeded')
    expect(r2.status).toBe('succeeded')
    expect(events1.find((e) => e.type === 'file-updated' && e.path.startsWith('正文'))).toBeTruthy()
    expect(events2.find((e) => e.type === 'file-updated' && e.path.startsWith('正文'))).toBeTruthy()
  })

  it('rejects 6th concurrent start when limit is 5', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const slow = { name: 'slow', async chat() { await new Promise((r) => setTimeout(r, 200)); return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' as const } } }
    const service = createAgentService({ db, provider: slow, model: 'gpt-5', maxConcurrent: 5 })
    const starts = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => {
      const meta = bookCtx(String(n))
      const em = new EventEmitter()
      return service.start({
        actionKey: 'chapter.continue', bookMeta: meta,
        chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
        sessionId: `s${n}`, emitter: em,
      })
    }))
    const rejected = starts.filter((s) => s.status === 'rejected')
    expect(rejected.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test**

```bash
cd fanqie-workbench && npx vitest run tests/agentic/multi-book-parallel.test.ts
```

Expected: PASS. If anything fails, fix the underlying bug — likely shared state across runners (e.g. ask_user resolver map keyed wrong).

- [ ] **Step 3: Commit**

```bash
git add fanqie-workbench/tests/agentic/multi-book-parallel.test.ts
git commit -m "test(agentic): multi-book parallel + concurrency limit"
```

---

## Task 30: Delete Claude Code channel

**Files:**
- Delete: `fanqie-workbench/src/claude/pty-manager.ts`
- Delete: `fanqie-workbench/src/claude/pty-event-parser.ts`
- Delete: `fanqie-workbench/src/claude/terminal-runtime.ts`
- Delete: `fanqie-workbench/src/claude/terminal-capture-loop.ts`
- Delete: `fanqie-workbench/src/claude/book-entry-terminal-runner.ts`
- Delete: `fanqie-workbench/src/claude/terminal-session-runner.ts` (if exists)
- Delete: `fanqie-workbench/src/claude/permission-prompt-detector.ts` (if exists)
- Delete: `fanqie-workbench/src/server/routes/pty-ws.ts`
- Delete: `fanqie-workbench/src/web/components/terminal-panel.tsx`
- Delete: `fanqie-workbench/src/web/components/live-log-panel.tsx`
- Delete: all `tests/claude/*` and `tests/web/terminal-panel.test.tsx` `tests/web/live-log-panel.*` tests
- Modify: `fanqie-workbench/package.json` (remove `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`)
- Modify: `fanqie-workbench/src/server/app.ts` (remove pty-ws route registration + getBookEntryPtyManager import)

- [ ] **Step 1: List what will be deleted**

```bash
cd fanqie-workbench && ls src/claude/ src/server/routes/pty-ws.ts src/web/components/terminal-panel.tsx src/web/components/live-log-panel.tsx 2>&1 | head -20
ls tests/claude/ 2>&1 | head -20
```

- [ ] **Step 2: Delete code files**

```bash
cd fanqie-workbench && \
  rm -f src/claude/pty-manager.ts src/claude/pty-event-parser.ts src/claude/terminal-runtime.ts \
        src/claude/terminal-capture-loop.ts src/claude/book-entry-terminal-runner.ts \
        src/claude/terminal-session-runner.ts src/claude/permission-prompt-detector.ts \
        src/server/routes/pty-ws.ts \
        src/web/components/terminal-panel.tsx src/web/components/live-log-panel.tsx
```

- [ ] **Step 3: Delete test files for deleted modules**

```bash
cd fanqie-workbench && rm -rf tests/claude tests/web/terminal-panel.test.tsx tests/web/live-log-panel.test.tsx tests/live-log-panel.e2e.spec.ts
```

- [ ] **Step 4: Remove deps from package.json**

```bash
cd fanqie-workbench && npm uninstall node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

- [ ] **Step 5: Remove pty-ws registration from app.ts**

In `fanqie-workbench/src/server/app.ts`:

- Remove `import { registerPtyWsRoutes } from './routes/pty-ws.js'`
- Remove the `registerPtyWsRoutes(app)` call

Also remove any remaining import of `getBookEntryPtyManager` or terminal-runtime in service files (e.g. action handlers). If any non-deleted file still references those, replace the call with a call to `agentService.start(...)`.

- [ ] **Step 6: Run full suite to catch leftovers**

```bash
cd fanqie-workbench && npm test
```

Expected: PASS. If anything fails because of dangling imports, follow the error to the file and either:
- Delete that file (if it's pure tmux glue)
- Update it to use `agentService` instead

- [ ] **Step 7: Manual smoke test**

```bash
cd fanqie-workbench && AGENT_PROVIDER=fake npm run dev:all
```

Open http://127.0.0.1:5173, pick a fixture book, click 继续写本章, confirm:
- AgentPanel renders
- Phases progress
- File gets written into novels/<book>/正文/
- Tracking files updated
- No console errors related to PTY/node-pty/xterm

- [ ] **Step 8: Commit deletion**

```bash
git add -A fanqie-workbench/src fanqie-workbench/tests fanqie-workbench/package.json fanqie-workbench/package-lock.json
git commit -m "refactor(agentic): remove Claude Code CLI channel (PTY + xterm)"
```

---

## Final verification

After Task 30, run the complete acceptance checklist from the spec:

- [ ] `cd fanqie-workbench && npm test` — all unit + integration tests pass, zero regression
- [ ] `cd fanqie-workbench && AGENT_PROVIDER=fake npm run test:e2e -- tests/agentic.e2e.spec.ts` — E2E green
- [ ] Manual: run 2 books in parallel via UI, confirm independent panels, independent file writes, no cross-talk
- [ ] Manual: trigger a real `chapter.continue` against one of the existing books (长嫡归朝 / 那年盛夏 / 均分之上) using real OPENAI_API_KEY; verify the章 written looks reasonable
- [ ] `git log --oneline feat/agentic-novel-writer ^master` — 30 small commits, clean history
- [ ] No remaining references to `node-pty`, `@xterm/*`, `tmux`, `getBookEntryPtyManager`, `terminal-runtime` in src/ or tests/

When all checks pass, open a PR to merge `feat/agentic-novel-writer` → `master`.
