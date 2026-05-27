import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { getMarketScanPreset } from '../../src/market/market-scan-presets.js'
import { runMarketScan } from '../../src/market/market-scan-runner.js'

function createMockSpawn() {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('# 番茄女频阅读榜\n'))
      child.emit('close', 0)
    })
    return child
  })
}

describe('market scan runner', () => {
  it('maps presets to existing oh-story scripts and args', () => {
    const preset = getMarketScanPreset('fanqie-female-reading')
    expect(preset.scriptPath).toBe('oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js')
    expect(preset.args).toEqual(['--channel', '0', '--type', '2'])
  })

  it('spawns node with script, preset args, and output directory', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'fanqie-market-runner-'))
    const spawn = createMockSpawn()

    const result = await runMarketScan({ preset: 'fanqie-female-reading', workspaceRoot: root, spawn })

    expect(spawn).toHaveBeenCalledWith('node', expect.arrayContaining([
      resolve(root, 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js'),
      '--channel', '0', '--type', '2',
      '--outdir', expect.stringContaining('data/market-scans'),
    ]), expect.any(Object))
    expect(result.status).toBe('succeeded')
    expect(result.outputFiles.length).toBeGreaterThan(0)
    await expect(readdir(result.outputDir)).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/fanqie-female-reading.*\.md/)]))
  })
})
