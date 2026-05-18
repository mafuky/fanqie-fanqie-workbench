import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo.js'

class MockClaudeSession extends EventEmitter {
  start() {
    queueMicrotask(() => {
      this.emit('claude', {
        type: 'question',
        toolUseId: 'tool-1',
        question: '你想要创作什么题材的小说？',
        options: [{ label: '悬疑推理', description: '侦探、破案、解谜' }],
      })
    })
  }
  kill() {}
}

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: MockClaudeSession,
  executeClaudePrompt: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '模拟去AI/审稿输出',
    stderr: '',
  }),
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-hitl-'))
  return resolve(dir, name)
}

const fixturesNovels = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/novels')

describe('chapter session human-in-the-loop execution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
  })

  it('waits for answer on writing stage and continues after answer', async () => {
    const databasePath = await createTempDatabasePath('chapter-hitl.sqlite')
    await syncWorkspaceBooks({ novelsRoot: fixturesNovels, databasePath })
    process.env.WORKBENCH_DB = databasePath

    const { openDatabase } = await import('../../src/db/client.js')
    const db = openDatabase(databasePath)
    const chapter = db.prepare("SELECT id FROM chapters ORDER BY chapter_number LIMIT 1").get() as { id: string }
    db.close()

    const { buildServer } = await import('../../src/server/app')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { kind: 'chapter', chapterId: chapter.id, currentSkill: 'chapter-pipeline' },
    })
    const session = JSON.parse(createResponse.body).session

    await new Promise((resolve) => setTimeout(resolve, 0))

    const waitingResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })
    const waitingSession = JSON.parse(waitingResponse.body).session
    expect(waitingSession.status).toBe('waiting-answer')
    expect(waitingSession.pendingQuestionJson).toContain('悬疑推理')

    const answerResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/answer`,
      payload: { answer: '悬疑推理' },
    })
    expect(answerResponse.statusCode).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 0))

    const finalResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })
    const finalSession = JSON.parse(finalResponse.body).session
    expect(finalSession.status).toBe('succeeded')

    await app.close()
  })
})
