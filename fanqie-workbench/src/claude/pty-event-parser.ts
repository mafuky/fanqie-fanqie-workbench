import type { PermissionPromptDetection } from './permission-prompt-detector.js'

export type ParsedEvent =
  | { type: 'question'; question: string; options: Array<{ label: string; checked?: boolean }>; multiSelect: boolean }
  | { type: 'thinking'; text: string }
  | { type: 'idle' }
  | { type: 'permission'; prompt: PermissionPromptDetection }

const MAX_BUFFER = 8000

export class PtyEventParser {
  private buffer = ''
  private hasClaudeOutput = false
  private lastQuestionSignature = ''
  private maxBuffer: number

  constructor(maxBuffer = MAX_BUFFER) {
    this.maxBuffer = maxBuffer
  }

  getBuffer(): string {
    return this.buffer
  }

  feed(chunk: string): ParsedEvent[] {
    this.buffer += chunk
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer)
    }

    if (/⏺/.test(chunk)) this.hasClaudeOutput = true

    const events: ParsedEvent[] = []

    const thinking = this.detectThinking(chunk)
    if (thinking) events.push(thinking)

    const question = this.detectQuestion()
    if (question) events.push(question)

    const permission = this.detectPermission()
    if (permission) events.push(permission)

    const idle = this.detectIdle()
    if (idle) events.push(idle)

    return events
  }

  private detectThinking(chunk: string): ParsedEvent | null {
    const lines = chunk.split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (t.length > 1 && /^[^\w\s]/.test(t) && /…/.test(t) && !/^⏺/.test(t)) {
        return { type: 'thinking', text: t }
      }
    }
    return null
  }

  private detectQuestion(): ParsedEvent | null {
    const buf = this.buffer
    if (!/Enter to select/.test(buf) && !/Enter to confirm/.test(buf)) return null

    const lines = buf.split('\n')
    const options: Array<{ label: string; checked?: boolean }> = []
    let hasCheckboxes = false

    for (const line of lines) {
      // Format A: checkbox after number — "  1. [✔] label" or "  1. [ ] label"
      const mPostCheckbox = line.match(/^\s*(?:❯\s*)?(\d+)\.\s+\[([ ✔✓])\]\s+(.+)/)
      if (mPostCheckbox) {
        const num = mPostCheckbox[1]
        const checkMark = mPostCheckbox[2]
        const label = mPostCheckbox[3].trim()
        hasCheckboxes = true
        options.push({ label: `${num}. ${label}`, checked: checkMark === '✔' || checkMark === '✓' })
        continue
      }

      // Format B: checkbox before number — "  [✔] 1. label" or pre-symbol "☐ 1. label"
      const mPreCheckbox = line.match(/^\s*(?:❯\s*)?(?:☐\s*|☒\s*)?(?:\[([ ✔✓])\]\s*)?(\d+)\.\s+(.+)/)
      if (mPreCheckbox) {
        const checkMark = mPreCheckbox[1]
        const num = mPreCheckbox[2]
        const label = mPreCheckbox[3].trim().replace(/^\[[ ✔✓]\]\s*/, '').replace(/^☐\s*|^☒\s*/, '')
        if (checkMark !== undefined) {
          hasCheckboxes = true
          options.push({ label: `${num}. ${label}`, checked: checkMark === '✔' || checkMark === '✓' })
        } else {
          options.push({ label: `${num}. ${label}` })
        }
      }
    }

    if (options.length === 0) return null

    const signature = options.map(o => o.label).join('|')
    if (signature === this.lastQuestionSignature) return null
    this.lastQuestionSignature = signature

    let question = ''
    const sepIndices: number[] = []
    lines.forEach((line, i) => { if (/^─{10,}/.test(line.trim())) sepIndices.push(i) })
    if (sepIndices.length >= 1) {
      for (let i = sepIndices[0] + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim()
        if (!trimmed || /^[←→]/.test(trimmed) || /^☐|^☒|^✔/.test(trimmed)) continue
        if (/^\d+\./.test(trimmed) || /^❯/.test(trimmed)) break
        if (
          trimmed.length > 2 &&
          !/^Enter to/.test(trimmed) &&
          !/^─/.test(trimmed) &&
          !/^Tab\/Arrow/.test(trimmed) &&
          !/^Review your/.test(trimmed) &&
          !/^Ready to/.test(trimmed)
        ) {
          question = trimmed
          break
        }
      }
    }

    return {
      type: 'question',
      question: question || '请选择一个选项。',
      options,
      multiSelect: hasCheckboxes,
    }
  }

  private detectPermission(): ParsedEvent | null {
    if (!this.buffer.includes('Bash command')) return null
    if (!this.buffer.includes('Do you want to proceed?')) return null
    if (!/\bNo\b/.test(this.buffer)) return null

    const marker = this.buffer.lastIndexOf('Bash command')
    const excerpt = marker >= 0 ? this.buffer.slice(marker).trim() : ''

    return {
      type: 'permission',
      prompt: {
        kind: 'bash-permission',
        title: 'Claude 正在等待 Bash 权限确认',
        excerpt,
        recommendation: '检测到 Claude Code 请求执行 Bash 命令。请确认命令内容和路径属于当前工作，再决定是否允许。',
        terminalInstruction: '请回到终端处理权限确认。',
      },
    }
  }

  private detectIdle(): ParsedEvent | null {
    if (!this.hasClaudeOutput) return null
    const lines = this.buffer.split('\n')
    const last40 = lines.slice(-40)

    const hasThinking = last40.some(line => {
      const t = line.trim()
      return t.length > 1 && /^[^\w\s]/.test(t) && /…/.test(t) && !/^⏺/.test(t)
    })
    if (hasThinking) return null

    const sepIndices: number[] = []
    for (let i = last40.length - 1; i >= 0 && sepIndices.length < 2; i--) {
      if (/^─{10,}/.test(last40[i].trim())) sepIndices.push(i)
    }
    if (sepIndices.length >= 2) {
      for (let i = sepIndices[1] + 1; i < sepIndices[0]; i++) {
        if (/^\s*❯/.test(last40[i]) && !/^\s*❯\s*\d+\./.test(last40[i])) return { type: 'idle' }
      }
    }

    if (last40.some(line => /^\s*❯\s*$/.test(line))) return { type: 'idle' }

    return null
  }
}
