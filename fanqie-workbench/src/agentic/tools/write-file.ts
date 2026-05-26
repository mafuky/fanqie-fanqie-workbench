import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

export const writeFileTool: Tool = {
  spec: {
    name: 'write_file',
    description: '写入文件到书籍目录内（自动建子目录），完成后触发 file-updated 事件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对 bookRoot 的路径' },
        content: { type: 'string', description: '完整文件内容 UTF-8' },
      },
      required: ['path', 'content'],
    },
  },
  async execute({ args, ctx }) {
    const rel = String(args.path ?? '')
    const content = String(args.content ?? '')
    if (!rel) return { ok: false, error: 'path is required' }
    try {
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
      ctx.emit({ type: 'file-updated', path: rel })
      return { ok: true, result: `wrote ${content.length} chars to ${rel}` }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
