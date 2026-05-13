import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'

describe('claude executor', () => {
  it('captures stdout from a child process', async () => {
    const chunks: string[] = []

    const result = await new Promise<{ exitCode: number | null; stdout: string }>((resolve) => {
      const child = spawn('echo', ['hello world'])
      let stdout = ''

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        chunks.push(text)
      })

      child.on('close', (code) => {
        resolve({ exitCode: code, stdout })
      })
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello world')
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('captures non-zero exit codes', async () => {
    const result = await new Promise<{ exitCode: number | null }>((resolve) => {
      const child = spawn('sh', ['-c', 'exit 42'])
      child.on('close', (code) => resolve({ exitCode: code }))
    })

    expect(result.exitCode).toBe(42)
  })
})
