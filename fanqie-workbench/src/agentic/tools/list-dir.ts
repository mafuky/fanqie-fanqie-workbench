import { readdir } from 'node:fs/promises'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const listDirTool: Tool = {
  spec: {
    name: 'list_dir',
    description: '列出书籍目录下某个子目录的条目，文件夹后带 /。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 bookRoot 的路径，根目录用 "."' } },
      required: ['path'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '.')
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const entries = await readdir(abs, { withFileTypes: true })
      const lines = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n')
      return { ok: true, result: lines }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
