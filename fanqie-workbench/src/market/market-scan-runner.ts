import { spawn as nodeSpawn } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getMarketScanPreset, type MarketScanPresetKey } from './market-scan-presets.js'

type SpawnLike = typeof nodeSpawn

export async function runMarketScan(input: { preset: MarketScanPresetKey | string; workspaceRoot: string; spawn?: SpawnLike }) {
  const preset = getMarketScanPreset(input.preset)
  const spawn = input.spawn ?? nodeSpawn
  const date = new Date().toISOString().slice(0, 10)
  const outputDir = resolve(input.workspaceRoot, 'fanqie-workbench', 'data', 'market-scans', date)
  await mkdir(outputDir, { recursive: true })

  const script = resolve(input.workspaceRoot, preset.scriptPath)
  const args = [script, ...preset.args, '--outdir', outputDir]
  const output = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolvePromise, reject) => {
    const child = spawn('node', args, { cwd: input.workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', (exitCode) => resolvePromise({ stdout, stderr, exitCode }))
  })

  if (output.exitCode !== 0) {
    return { status: 'failed' as const, preset: preset.key, outputDir, outputFiles: [], error: output.stderr || `market scan exited with ${output.exitCode}` }
  }

  const fallbackFile = resolve(outputDir, `${preset.key}-${Date.now()}.md`)
  const existingFiles = await readdir(outputDir).catch(() => [])
  if (!existingFiles.some((file) => file.endsWith('.md')) && output.stdout.trim()) {
    await writeFile(fallbackFile, output.stdout, 'utf8')
  }

  const files = await readdir(outputDir)
  const outputFiles = files.filter((file) => file.endsWith('.md')).map((file) => resolve(outputDir, file))
  return { status: 'succeeded' as const, preset: preset.key, outputDir, outputFiles }
}
