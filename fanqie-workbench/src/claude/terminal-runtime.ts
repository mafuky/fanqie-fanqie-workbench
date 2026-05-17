import { spawn } from 'node:child_process'

export type TmuxCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type TmuxRunner = (args: string[], options?: { cwd?: string }) => Promise<TmuxCommandResult>

export type TerminalRuntime = {
  ensureSession(input: { bookId: string }): Promise<{ sessionName: string; created: boolean }>
  sendText(input: { bookId: string; text: string }): Promise<void>
  capture(input: { bookId: string }): Promise<string>
  interrupt(input: { bookId: string }): Promise<void>
  stop(input: { bookId: string }): Promise<void>
}

export function buildTmuxSessionName(bookId: string) {
  const safe = bookId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 12) || 'book'
  return `fanqie-book-${safe}`
}

export function runTmux(args: string[], options?: { cwd?: string }): Promise<TmuxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr })
    })
  })
}

export function createTerminalRuntime(input: { projectRoot: string; runner?: TmuxRunner }): TerminalRuntime {
  const runner = input.runner ?? runTmux

  return {
    async ensureSession({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const hasSessionResult = await runner(['has-session', '-t', sessionName])

      if (hasSessionResult.exitCode === 0) {
        return { sessionName, created: false }
      }

      const createResult = await runner([
        'new-session',
        '-d',
        '-s',
        sessionName,
        '-c',
        input.projectRoot,
        'claude',
      ])

      if (createResult.exitCode !== 0) {
        throw new Error(createResult.stderr || `tmux new-session failed with exit code ${createResult.exitCode}`)
      }

      return { sessionName, created: true }
    },

    async sendText({ bookId, text }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['send-keys', '-t', sessionName, text, 'Enter'])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux send-keys failed with exit code ${result.exitCode}`)
      }
    },

    async capture({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['capture-pane', '-t', sessionName, '-p'])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux capture-pane failed with exit code ${result.exitCode}`)
      }

      return result.stdout
    },

    async interrupt({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['send-keys', '-t', sessionName, 'C-c'])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux send-keys failed with exit code ${result.exitCode}`)
      }
    },

    async stop({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['kill-session', '-t', sessionName])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux kill-session failed with exit code ${result.exitCode}`)
      }
    },
  }
}
