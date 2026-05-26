import { readFile } from 'node:fs/promises'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const readFileTool: Tool = {
  spec: {
    name: 'read_file',
    description: '读取书籍根目录内的某个文本文件，返回 UTF-8 内容。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对 bookRoot 的路径' } },
      required: ['path'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '')
    if (!rel) return { ok: false, error: 'path is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      const content = await readFile(abs, 'utf8')
      return { ok: true, result: content }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
