import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function scanBooks(novelsRoot: string) {
  const entries = await readdir(novelsRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => ({
    title: entry.name,
    rootPath: join(novelsRoot, entry.name)
  }))
}
