import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCoverPrompt, generateCover } from '../../src/server/cover-service.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cover-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('buildCoverPrompt', () => {
  it('embeds the book title', () => {
    expect(buildCoverPrompt('雾港疑局')).toContain('雾港疑局')
  })
})

describe('generateCover', () => {
  it('writes 封面.png from a b64_json response', async () => {
    const png = Buffer.from('fake-png-bytes')
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: png.toString('base64') }] }),
    })) as unknown as typeof fetch

    const result = await generateCover({
      apiKey: 'k', baseUrl: 'https://img.example/v1', model: 'gpt-image-1',
      title: '雾港疑局', bookRoot: root, fetchImpl,
    })

    expect(result.path).toBe('封面.png')
    const abs = join(root, '封面.png')
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs).equals(png)).toBe(true)
  })

  it('downloads from a url response when b64_json is absent', async () => {
    const png = Buffer.from('downloaded-bytes')
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      if (url.endsWith('/images/generations')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://cdn.example/x.png' }] }) }
      }
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }
    }) as unknown as typeof fetch

    const result = await generateCover({
      apiKey: 'k', baseUrl: 'https://img.example/v1', model: 'gpt-image-1',
      title: 'T', bookRoot: root, fetchImpl,
    })
    expect(result.path).toBe('封面.png')
    expect(existsSync(join(root, '封面.png'))).toBe(true)
    expect(calls[1]).toBe('https://cdn.example/x.png')
  })

  it('throws with the upstream error message on non-ok response', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { message: 'No available compatible accounts' } }),
    })) as unknown as typeof fetch

    await expect(generateCover({
      apiKey: 'k', baseUrl: 'https://img.example/v1', model: 'gpt-image-1',
      title: 'T', bookRoot: root, fetchImpl,
    })).rejects.toThrow(/503.*No available compatible accounts/)
    expect(existsSync(join(root, '封面.png'))).toBe(false)
  })

  it('throws when no api key', async () => {
    await expect(generateCover({
      apiKey: '', baseUrl: 'https://img.example/v1', model: 'gpt-image-1',
      title: 'T', bookRoot: root,
    })).rejects.toThrow(/key/i)
  })
})
