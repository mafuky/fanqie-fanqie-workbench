import type { TerminalSessionCompletionInput } from './terminal-session-runner.js'

type StoredOptions = TerminalSessionCompletionInput & {
  runtimeBookId: string
  currentSkill?: string | null
  isComplete?: (capture: string) => boolean
}

const optionsBySessionId = new Map<string, StoredOptions>()

export function storeSessionRuntimeOptions(sessionId: string, options: StoredOptions) {
  optionsBySessionId.set(sessionId, options)
}

export function getSessionRuntimeOptions(sessionId: string): StoredOptions | null {
  return optionsBySessionId.get(sessionId) ?? null
}

export function clearSessionRuntimeOptions(sessionId: string) {
  optionsBySessionId.delete(sessionId)
}
