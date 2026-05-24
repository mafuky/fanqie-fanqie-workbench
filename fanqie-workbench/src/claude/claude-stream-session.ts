import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ClaudeEvent } from './claude-executor.js'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..')

type StartOptions = {
  prompt: string
  cwd?: string
  sessionId?: string
}

export class ClaudeStreamSession extends EventEmitter {
  private child: ChildProcess | null = null
  private buffer = ''
  private claudeSessionId: string | null = null
  private alive = false
  private cwd?: string

  get sessionId(): string | null {
    return this.claudeSessionId
  }

  get isAlive(): boolean {
    return this.alive
  }

  start(options: StartOptions) {
    this.claudeSessionId = options.sessionId ?? randomUUID()
    this.cwd = options.cwd
    this.spawnAndStream(['--session-id', this.claudeSessionId], options.prompt)
  }

  continueWith(answer: string) {
    if (!this.claudeSessionId) return
    if (this.alive) {
      try { this.child?.kill() } catch {}
    }
    this.spawnAndStream(['--resume', this.claudeSessionId], answer)
  }

  private spawnAndStream(extraArgs: string[], prompt: string) {
    this.buffer = ''
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--permission-mode', 'bypassPermissions',
      '--verbose',
      ...extraArgs,
      prompt,
    ]

    this.child = spawn('claude', args, {
      cwd: this.cwd || WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this.alive = true

    this.child.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.child.stderr!.on('data', (data: Buffer) => {
      this.emit('claude', { type: 'error', message: data.toString() } as ClaudeEvent)
    })

    this.child.on('close', (code) => {
      if (this.buffer.trim()) this.processBuffer()
      this.alive = false
      this.emit('claude', { type: 'turn-end', exitCode: code } as any)
    })

    this.child.on('error', (err) => {
      this.alive = false
      this.emit('claude', { type: 'error', message: err.message } as ClaudeEvent)
      this.emit('claude', { type: 'turn-end', exitCode: 1 } as any)
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
        this.emit('claude', { type: 'text', text: line + '\n' } as ClaudeEvent)
      }
    }
  }

  private handleEvent(event: any) {
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      this.claudeSessionId = event.session_id
      return
    }

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          this.emit('claude', { type: 'text', text: block.text } as ClaudeEvent)
        } else if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
          this.handleAskUserQuestion(block)
        } else if (block.type === 'tool_use') {
          this.emit('claude', {
            type: 'tool_use',
            name: block.name,
            input: block.input,
          } as ClaudeEvent)
        }
      }
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
    if (this.child && this.alive) {
      this.alive = false
      try {
        this.child.kill()
      } catch {}
    }
  }
}
