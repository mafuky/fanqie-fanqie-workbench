import type { LlmProvider } from './provider.js'

export function createFakeProvider(): LlmProvider {
  return {
    name: 'fake',
    async chat({ messages }) {
      const last = messages[messages.length - 1]?.content ?? ''
      if (last.includes('加载第') && last.includes('上下文')) {
        return { content: '上下文摘要：略', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      }
      if (last.includes('正文') && last.includes('write_file')) {
        return {
          content: '',
          toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: '正文/第001章.md', content: '## 第001章\n\n' + '雨夜里他睁开眼，窗外电闪雷鸣，远处传来一声闷响。\n'.repeat(60) } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool_calls',
        }
      }
      if (last.includes('材料')) {
        return { content: '材料齐备', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
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
