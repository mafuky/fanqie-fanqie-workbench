import type { FastifyInstance } from 'fastify'
import type { LlmProvider } from '../../agentic/providers/provider.js'
import { reviseSentence, SENTENCE_MODES, type SentenceMode } from '../sentence-revise-service.js'

export interface SentenceRoutesDeps {
  provider: LlmProvider
  model: string
}

/** Sentence-level AI rewrite: select one sentence in a chapter and get N candidate rewrites. */
export function registerSentenceRoutes(app: FastifyInstance, deps: SentenceRoutesDeps) {
  app.post<{ Body: { sentence?: string; context?: string; mode?: string; count?: number } }>(
    '/api/sentence/revise',
    async (req, reply) => {
      const { sentence, context, mode, count } = req.body ?? {}
      if (!sentence || !sentence.trim()) {
        return reply.code(400).send({ error: 'sentence is required' })
      }
      if (!mode || !SENTENCE_MODES.includes(mode as SentenceMode)) {
        return reply.code(400).send({ error: `mode must be one of ${SENTENCE_MODES.join(', ')}` })
      }
      try {
        const { candidates } = await reviseSentence({
          provider: deps.provider,
          model: deps.model,
          sentence,
          context,
          mode: mode as SentenceMode,
          count,
        })
        return reply.send({ candidates })
      } catch (err: any) {
        return reply.code(502).send({ error: err?.message ?? '改写失败' })
      }
    },
  )
}
