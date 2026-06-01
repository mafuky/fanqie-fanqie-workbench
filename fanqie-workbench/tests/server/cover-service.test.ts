import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCoverPrompt, decodeImageData, deriveCoverHints, derivePlatform, generateCover, inferGenre, matchGenre, saveCoverImage } from '../../src/server/cover-service.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cover-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('inferGenre', () => {
  it('detects ancient romance from palace keywords', () => {
    expect(inferGenre('长嫡归朝')).toBe('ancient-romance')
  })
  it('detects xianxia from sword/dao keywords', () => {
    expect(inferGenre('剑道独尊')).toBe('xianxia')
  })
  it('detects supernatural from tomb-raiding keywords', () => {
    expect(inferGenre('盗墓笔记')).toBe('supernatural')
  })
  it('falls back to modern-romance for untagged titles', () => {
    expect(inferGenre('那年盛夏')).toBe('modern-romance')
  })
})

describe('buildCoverPrompt', () => {
  it('embeds the book title in a Title text line', () => {
    expect(buildCoverPrompt('雾港疑局')).toContain("Title text '雾港疑局'")
  })

  it('defaults to the 番茄 platform style', () => {
    expect(buildCoverPrompt('雾港疑局')).toContain('mass-market novel cover style')
  })

  it('uses the genre-specific title font (ancient romance → Kai script)', () => {
    expect(buildCoverPrompt('长嫡归朝')).toContain('Kai script')
  })

  it('honors a platform override', () => {
    expect(buildCoverPrompt('那年盛夏', { platform: '晋江' })).toContain('dreamy ethereal aesthetic')
  })

  it('adds an author-name line only when an author is provided', () => {
    expect(buildCoverPrompt('那年盛夏', { author: '慕雨' })).toContain("Author name '慕雨'")
    expect(buildCoverPrompt('那年盛夏')).not.toContain('Author name')
  })

  it('honors an explicit genre override', () => {
    expect(buildCoverPrompt('某都市文', { genre: 'scifi' })).toContain('Sci-fi cyberpunk')
  })

  it('always requests a portrait 2:3 cover', () => {
    expect(buildCoverPrompt('雾港疑局')).toContain('portrait 2:3 ratio')
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])

describe('decodeImageData', () => {
  it('decodes a data URL into image bytes', () => {
    const out = decodeImageData('data:image/png;base64,' + PNG.toString('base64'))
    expect(out.equals(PNG)).toBe(true)
  })
  it('decodes a raw base64 string', () => {
    expect(decodeImageData(PNG.toString('base64')).equals(PNG)).toBe(true)
  })
  it('throws on empty input', () => {
    expect(() => decodeImageData('')).toThrow(/no image data/i)
  })
  it('throws on non-image data', () => {
    expect(() => decodeImageData(Buffer.from('hello world!!').toString('base64'))).toThrow(/unsupported image/i)
  })
})

describe('saveCoverImage', () => {
  it('writes 封面.png from a data URL', async () => {
    const result = await saveCoverImage({ bookRoot: root, image: 'data:image/png;base64,' + PNG.toString('base64') })
    expect(result.path).toBe('封面.png')
    const abs = join(root, '封面.png')
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs).equals(PNG)).toBe(true)
  })
})

describe('genre/platform hints from 题材定位 text', () => {
  it('matchGenre returns undefined when nothing matches', () => {
    expect(matchGenre('随便一个名字')).toBeUndefined()
  })
  it('matchGenre detects genre from a positioning line', () => {
    expect(matchGenre('题材类型：古言重生 + 朝堂权谋 + 嫡女复仇')).toBe('ancient-romance')
  })
  it('derivePlatform reads the named platform', () => {
    expect(derivePlatform('目标平台：晋江')).toBe('晋江')
    expect(derivePlatform('知乎盐言短篇')).toBe('知乎盐言')
    expect(derivePlatform('没有平台信息')).toBeUndefined()
  })
  it('deriveCoverHints combines genre + platform', () => {
    const h = deriveCoverHints('题材类型：古言宫斗复仇\n目标平台：番茄')
    expect(h.genre).toBe('ancient-romance')
    expect(h.platform).toBe('番茄')
  })
})
