import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Tool } from './tool.js'
import { resolveInsideRoot } from './sandbox.js'

const ALLOWED = new Set(['上下文', '伏笔', '时间线'])

export const updateTrackingTool: Tool = {
  spec: {
    name: 'update_tracking',
    description: '更新追踪文件之一：上下文 / 伏笔 / 时间线。整文件覆盖写。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', enum: ['上下文', '伏笔', '时间线'] },
        content: { type: 'string' },
      },
      required: ['file', 'content'],
    },
  },
  async execute({ args, ctx }) {
    const file = String(args.file ?? '')
    const content = typeof args.content === 'string' ? args.content : ''
    if (!ALLOWED.has(file)) {
      return { ok: false, error: `file must be one of: ${Array.from(ALLOWED).join(', ')}` }
    }
    if (!content) {
      return { ok: false, error: 'content is required' }
    }
    try {
      const rel = join('追踪', `${file}.md`)
      const abs = resolveInsideRoot(ctx.bookRoot, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
      ctx.emit({ type: 'file-updated', path: rel })
      return { ok: true, result: `updated ${rel}` }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
}
