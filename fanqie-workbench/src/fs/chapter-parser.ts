import { readFile } from 'node:fs/promises'

export async function parseChapterFile(fileUrl: URL) {
  const content = await readFile(fileUrl, 'utf8')
  const lines = content.split('\n')
  const header = lines.find(line => line.startsWith('#'))
  if (!header) return null

  const match = header.match(/第(\d+)章[：:_\s]\s*(.+)$/)
  if (!match) return null

  const headerIndex = lines.indexOf(header)
  const body = lines.slice(headerIndex + 1).join('\n').trim()

  return {
    chapterNumber: Number(match[1]),
    title: match[2].trim(),
    body
  }
}
