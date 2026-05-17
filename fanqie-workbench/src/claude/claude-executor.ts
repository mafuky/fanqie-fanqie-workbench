import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..')

export type ClaudeEvent =
  | { type: 'text'; text: string }
  | { type: 'question'; toolUseId: string; question: string; options: Array<{ label: string; description?: string }> }
  | { type: 'tool_use'; name: string; input: any }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number | null }

export class ClaudeSession extends EventEmitter {
  private child: ChildProcess | null = null
  private buffer = ''

  start(prompt: string, cwd?: string) {
    const args = [
      '-p', '--verbose',
      '--output-format', 'stream-json',
      prompt,
    ]

    this.child = spawn('claude', args, {
      cwd: cwd || WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this.child.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.child.stderr!.on('data', (data: Buffer) => {
      this.emit('claude', { type: 'error', message: data.toString() } as ClaudeEvent)
    })

    this.child.on('close', (code) => {
      if (this.buffer.trim()) this.processBuffer()
      this.emit('claude', { type: 'done', exitCode: code } as ClaudeEvent)
    })

    this.child.on('error', (err) => {
      this.emit('claude', { type: 'error', message: err.message } as ClaudeEvent)
      this.emit('claude', { type: 'done', exitCode: 1 } as ClaudeEvent)
    })
  }

  private processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        this.handleEvent(event)
      } catch {
        // Non-JSON line, emit as text
        this.emit('claude', { type: 'text', text: line + '\n' } as ClaudeEvent)
      }
    }
  }

  private handleEvent(event: any) {
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          this.emit('claude', { type: 'text', text: block.text } as ClaudeEvent)
        }
        if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
          this.handleAskUserQuestion(block)
        }
        if (block.type === 'tool_use' && block.name !== 'AskUserQuestion') {
          this.emit('claude', {
            type: 'tool_use',
            name: block.name,
            input: block.input,
          } as ClaudeEvent)
        }
      }
    }

    if (event.type === 'result') {
      // Final result event — don't emit done here, wait for 'close'
    }
  }

  private handleAskUserQuestion(block: any) {
    const input = block.input || {}
    const questions = input.questions || []
    if (questions.length === 0) return

    const q = questions[0]
    this.emit('claude', {
      type: 'question',
      toolUseId: block.id,
      question: q.question || '',
      options: (q.options || []).map((o: any) => ({
        label: o.label || '',
        description: o.description || '',
      })),
    } as ClaudeEvent)
  }

  kill() {
    this.child?.kill()
  }
}

// Simple non-interactive executor for backward compatibility
export function executeClaudePrompt(prompt: string, options?: {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  cwd?: string
}) {
  const cwd = options?.cwd || WORKSPACE_ROOT

  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      options?.onStdout?.(text)
    })

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      options?.onStderr?.(text)
    })

    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }))
  })
}
