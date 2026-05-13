import { spawn } from 'node:child_process'

export function executeClaudePrompt(prompt: string, options?: {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('claude', ['-p', prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr })
    })
  })
}
