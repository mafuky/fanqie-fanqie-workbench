export type AgentEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'delta'; phase: string; content: string }
  | { type: 'tool-call-delta'; phase: string; toolCallIndex: number; id?: string; name?: string; argsFragment?: string }
  | { type: 'message'; phase: string; role: 'user' | 'assistant'; content: string }
  | { type: 'tool-call'; phase: string; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; phase: string; toolCallId: string; name: string; result: string; ok: boolean }
  | { type: 'question'; question: string; options: Array<{ label: string }>; multiSelect: boolean }
  | { type: 'file-updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'cancelled' }
