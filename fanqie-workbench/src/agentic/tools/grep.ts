import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.isFile()) out.push(full)
  }
  return out
}

export const grepTool: Tool = {
  spec: {
    name: 'grep',
    description: '在书籍目录内按行 grep（字符串包含匹配，区分大小写）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: '相对 bookRoot 的目录，默认 "."' },
      },
      required: ['pattern'],
    },
  },
  async execute({ args, ctx }) {
    const pattern = String(args.pattern ?? '')
    const rel = String(args.path ?? '.')
    if (!pattern) return { ok: false, error: 'pattern is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const st = await stat(abs)
      const files = st.isDirectory() ? await walk(abs) : [abs]
      const hits: string[] = []
      for (const file of files) {
        const content = await readFile(file, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(pattern)) {
            hits.push(`${relative(ctx.bookRoot, file)}:${i + 1}:${lines[i]}`)
          }
        }
      }
      return { ok: true, result: hits.join('\n') }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
