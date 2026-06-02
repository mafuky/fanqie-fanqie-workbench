import type { ChatMessage, LlmProvider } from '../agentic/providers/provider.js'

export type SentenceMode = 'polish' | 'deslop' | 'expand'

export const SENTENCE_MODES: SentenceMode[] = ['polish', 'deslop', 'expand']

const MODE_INSTRUCTION: Record<SentenceMode, string> = {
  polish: '把这句改得更顺、更到位，或换一种说法；意思、信息、语气走向都不变。',
  deslop:
    '去掉这句的 AI 腔：避免「仿佛/宛如/不禁/一丝/无疑/嘴角/眼神/微微/缓缓/空气仿佛凝固」这类套词，别太工整对仗，口语一点、有点毛边；意思不变。',
  expand:
    '把这句展开成更有画面感、有感官细节的 1-2 句；要具体可感，不要堆砌形容词；不改变原意和情节走向。',
}

export interface ReviseSentenceInput {
  provider: LlmProvider
  model: string
  /** The single sentence the user selected to rewrite. */
  sentence: string
  /** Surrounding text for reference only (not rewritten). Optional. */
  context?: string
  mode: SentenceMode
  /** How many candidates to return (clamped 1..5, default 3). */
  count?: number
}

/** Build the chat messages for a single-sentence rewrite. */
export function buildSentenceMessages(
  mode: SentenceMode,
  sentence: string,
  context: string,
  count: number,
): ChatMessage[] {
  const system = [
    '你是中文网络小说的句子级润色助手。',
    '只改写用户给的这一句话，绝不改动人设、剧情、信息与时间线，不要加戏、不要解释。',
    MODE_INSTRUCTION[mode],
    `给出 ${count} 个各不相同的候选改写。`,
    '只输出一个 JSON 字符串数组（例如 ["改写一","改写二"]），不要任何额外文字，不要代码块标记。',
  ].join('\n')
  const user = [
    context ? `【上下文，仅供参考，不要改写它】\n${context}\n` : '',
    `【需要改写的句子】\n${sentence}`,
  ]
    .filter(Boolean)
    .join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Parse the model output into a list of candidate sentences (JSON array, else numbered/bulleted lines). */
export function parseCandidates(content: string, count: number): string[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0])
      if (Array.isArray(arr)) {
        const out = arr.map((s) => String(s).trim()).filter(Boolean)
        if (out.length) return out.slice(0, count)
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.、)）]|[①-⑩])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

/** Rewrite a single sentence into N candidates via the LLM provider. */
export async function reviseSentence(input: ReviseSentenceInput): Promise<{ candidates: string[] }> {
  const sentence = input.sentence?.trim()
  if (!sentence) throw new Error('sentence is required')
  const count = Math.min(Math.max(input.count ?? 3, 1), 5)
  const messages = buildSentenceMessages(input.mode, sentence, input.context?.trim() ?? '', count)
  const result = await input.provider.chat({ model: input.model, messages, tools: [], temperature: 0.8 })
  const candidates = parseCandidates(result.content, count)
  if (candidates.length === 0) throw new Error('no candidates produced')
  return { candidates }
}
