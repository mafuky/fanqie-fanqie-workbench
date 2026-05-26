import type { Tool } from './tool.js'

export interface AskUserOptions {
  waitForAnswer: (bookId: string) => Promise<string>
}

export function createAskUserTool(options: AskUserOptions): Tool {
  return {
    spec: {
      name: 'ask_user',
      description: '向用户提问并等待回答。仅在缺少关键信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
          },
          multiSelect: { type: 'boolean' },
        },
        required: ['question', 'options'],
      },
    },
    async execute({ args, ctx }) {
      const question = String(args.question ?? '')
      const opts = Array.isArray(args.options) ? (args.options as Array<{ label: string }>) : []
      const multiSelect = Boolean(args.multiSelect)
      if (!question || opts.length === 0) {
        return { ok: false, error: 'question and options are required' }
      }
      ctx.emit({ type: 'question', question, options: opts, multiSelect })
      const answer = await options.waitForAnswer(ctx.bookId)
      return { ok: true, result: answer }
    },
  }
}
