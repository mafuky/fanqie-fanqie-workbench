import { spawn } from 'node:child_process'

export type TmuxCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type TmuxRunner = (args: string[], options?: { cwd?: string }) => Promise<TmuxCommandResult>

export type PermissionChoice = 'allow-once' | 'deny'

export type TerminalRuntime = {
  ensureSession(input: { bookId: string }): Promise<{ sessionName: string; created: boolean }>
  sendText(input: { bookId: string; text: string }): Promise<void>
  sendKeys(input: { bookId: string; keys: string[] }): Promise<void>
  sendPermissionChoice(input: { bookId: string; choice: PermissionChoice }): Promise<void>
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

      await runner(['set-option', '-g', 'history-limit', '50000']).catch(() => {})

      const createResult = await runner([
        'new-session',
        '-d',
        '-s',
        sessionName,
        '-c',
        input.projectRoot,
        'claude', '--permission-mode', 'bypassPermissions',
      ])

      if (createResult.exitCode !== 0) {
        throw new Error(createResult.stderr || `tmux new-session failed with exit code ${createResult.exitCode}`)
      }

      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const probe = await runner(['capture-pane', '-t', sessionName, '-p', '-S', '-'])
        if (probe.stdout.includes('~/') || probe.stdout.includes('❯') || probe.stdout.includes('>')) {
          break
        }
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

    async sendKeys({ bookId, keys }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['send-keys', '-t', sessionName, ...keys])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux send-keys failed with exit code ${result.exitCode}`)
      }
    },

    async sendPermissionChoice({ bookId, choice }) {
      const sessionName = buildTmuxSessionName(bookId)
      const keys = choice === 'allow-once' ? ['Enter'] : ['Down', 'Down', 'Enter']
      const result = await runner(['send-keys', '-t', sessionName, ...keys])

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `tmux send-keys failed with exit code ${result.exitCode}`)
      }
    },

    async capture({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['capture-pane', '-t', sessionName, '-p', '-S', '-'])

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
