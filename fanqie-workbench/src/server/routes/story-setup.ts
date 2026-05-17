import type { FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import { deployStorySetup } from '../../story/story-setup-service.js'

const DEFAULT_WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const DEFAULT_TEMPLATES_ROOT = resolve(DEFAULT_WORKSPACE_ROOT, 'oh-story-claudecode', 'skills', 'story-setup', 'references', 'templates')

export async function registerStorySetupRoutes(app: FastifyInstance) {
  app.post('/api/story/setup', async (_request, reply) => {
    const projectRoot = process.env.STORY_SETUP_PROJECT_ROOT ?? DEFAULT_WORKSPACE_ROOT
    const templatesRoot = process.env.STORY_SETUP_TEMPLATES_ROOT ?? DEFAULT_TEMPLATES_ROOT

    try {
      return await deployStorySetup({ projectRoot, templatesRoot })
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}
