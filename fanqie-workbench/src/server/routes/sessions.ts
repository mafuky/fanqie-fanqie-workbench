import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'
import {
  appendSessionMessage,
  createSession,
  findBookMasterSession,
  getSessionById,
  getSessionMessages,
  listSessionsByKind,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
  type SessionKind,
} from '../../db/repositories/sessions-repo.js'
import { buildChapterCommand, type ChapterCommandAction } from '../../claude/chapter-command-builder.js'
import { ClaudeSession, type ClaudeEvent } from '../../claude/claude-executor.js'
import { getOrCreateEmitter, submitAnswer } from '../../claude/stream-capture.js'
import { runTerminalSessionCommand } from '../../claude/terminal-session-runner.js'
import { createTerminalRuntime } from '../../claude/terminal-runtime.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

function stripMarkdownEmphasis(value: string) {
  return value.replace(/^[\s#>*-]+/, '').replace(/^主推书名[:：]\s*/, '').replace(/^推荐主书名[:：]\s*/, '').replace(/^书名[:：]\s*/, '').replace(/[*`《》]/g, '').trim()
}

function parseGeneratedBook(stdout: string) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const titleLine = lines.find((line) => /^#{0,6}\s*(主推书名|推荐主书名|书名)[:：]/.test(line))
  const title = titleLine ? stripMarkdownEmphasis(titleLine.split(/[:：]/).slice(1).join('：')) : ''
  const summary = stdout.match(/简介[:：]\s*([\s\S]*?)(?=\n\s*大纲[:：]|\n\s*章节目录[:：]|$)/)?.[1]?.trim() || ''
  const outline = stdout.match(/大纲[:：]\s*([\s\S]*?)(?=\n\s*章节目录[:：]|$)/)?.[1]?.trim() || ''
  const chapterTitles = Array.from(stdout.matchAll(/第\s*(\d+)\s*章[：:_\s]+([^\n]+)/g))
    .map((match) => ({
      chapterNumber: Number(match[1]),
      title: stripMarkdownEmphasis(match[2]).replace(/[，。；、].*$/, '').trim(),
    }))
    .filter((chapter) => chapter.chapterNumber > 0 && chapter.title.length > 0)
    .filter((chapter, index, chapters) => chapters.findIndex((item) => item.chapterNumber === chapter.chapterNumber) === index)

  return {
    title,
    summary,
    outline,
    chapterTitles,
    isComplete: Boolean(title) && /简介[:：]/.test(stdout) && /大纲[:：]/.test(stdout) && /章节目录[:：]/.test(stdout) && chapterTitles.length > 0,
  }
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function getUniqueBookRootPath(title: string, dbPath: string) {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').trim() || '未命名作品'
  const db = openDatabase(dbPath)
  try {
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? '' : `-${index + 1}`
      const rootPath = resolve(WORKSPACE_ROOT, 'novels', `${safeTitle}${suffix}`)
      const existing = db.prepare('SELECT id FROM books WHERE root_path = ?').get(rootPath)
      if (!existing && !(await pathExists(rootPath))) return rootPath
    }
  } finally {
    db.close()
  }
  return resolve(WORKSPACE_ROOT, 'novels', `${safeTitle}-${randomUUID().slice(0, 8)}`)
}

async function materializeGeneratedBook(stdout: string, dbPath: string) {
  const generated = parseGeneratedBook(stdout)
  if (!generated.isComplete) {
    throw new Error('开书资料不完整，无法创建书籍文件')
  }
  const rootPath = await getUniqueBookRootPath(generated.title, dbPath)
  const settingsPath = resolve(rootPath, '设定')
  const outlinePath = resolve(rootPath, '大纲')
  const chaptersPath = resolve(rootPath, '正文')
  const trackingPath = resolve(rootPath, '追踪')
  const referencePath = resolve(rootPath, '参考资料')
  await mkdir(settingsPath, { recursive: true })
  await mkdir(outlinePath, { recursive: true })
  await mkdir(chaptersPath, { recursive: true })
  await mkdir(trackingPath, { recursive: true })
  await mkdir(resolve(rootPath, '对标'), { recursive: true })
  await mkdir(referencePath, { recursive: true })

  await writeFile(resolve(outlinePath, '大纲.md'), `# ${generated.title} 大纲\n\n${generated.outline}\n`, 'utf8')
  await writeFile(resolve(trackingPath, '上下文.md'), `# ${generated.title} 上下文\n\n- 当前位置：开书完成，待写第1章\n- 已规划章节：${generated.chapterTitles.length} 章\n- 简介：${generated.summary}\n`, 'utf8')
  await writeFile(resolve(trackingPath, '伏笔.md'), '# 伏笔\n\n| 伏笔 | 埋设章节 | 状态 | 回收计划 |\n| --- | --- | --- | --- |\n', 'utf8')
  await writeFile(resolve(trackingPath, '时间线.md'), '# 时间线\n\n| 顺序 | 章节 | 事件 |\n| --- | --- | --- |\n', 'utf8')

  const bookId = randomUUID()
  const db = openDatabase(dbPath)
  try {
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(bookId, generated.title, rootPath)

    for (const chapter of generated.chapterTitles) {
      const chapterId = randomUUID()
      const safeChapterTitle = chapter.title.replace(/[\\/:*?"<>|]/g, '-').trim() || `第${chapter.chapterNumber}章`
      const fileName = `第${String(chapter.chapterNumber).padStart(3, '0')}章_${safeChapterTitle}.md`
      const sourcePath = resolve(chaptersPath, fileName)
      await writeFile(sourcePath, `# 第${chapter.chapterNumber}章 ${chapter.title}\n\n`, 'utf8')
      db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
        .run(chapterId, bookId, chapter.chapterNumber, chapter.title, sourcePath, '待写作')
    }
  } finally {
    db.close()
  }

  return { bookId, title: generated.title, rootPath }
}

function buildBookEntryPrompt(idea: string) {
  return `你正在书籍管理页面帮助用户开一本新书。\n\n重要限制：不要调用任何工具、Skill 或斜杠命令；只用普通文本回复用户。\n\n用户开书想法：${idea}\n\n你可以先和用户多轮沟通，确认题材、主角、核心卖点、情绪基调、目标读者等关键信息；如果信息已经足够，请直接输出可落盘的开书资料。\n\n当你决定创建书籍时，最后必须严格按下面格式输出，字段名不要改，不要再给多个候选：\n书名：<最终书名，只输出一个>\n简介：<200-400字简介>\n大纲：<分卷或主线大纲>\n章节目录：\n第1章 <章节名>\n第2章 <章节名>\n第3章 <章节名>\n第4章 <章节名>\n第5章 <章节名>`
}

function buildBookEntryContinuePrompt(history: string) {
  return `${history}\n\n重要限制：不要调用任何工具、Skill 或斜杠命令；只用普通文本回复用户。\n\n请继续开书沟通。如果信息仍不足，可以继续问用户；如果信息足够，请严格按下面格式输出最终开书资料，字段名不要改：\n书名：<最终书名，只输出一个>\n简介：<200-400字简介>\n大纲：<分卷或主线大纲>\n章节目录：\n第1章 <章节名>\n第2章 <章节名>\n第3章 <章节名>\n第4章 <章节名>\n第5章 <章节名>`
}

function buildSessionTranscript(messages: ReturnType<typeof getSessionMessages>) {
  return messages.map((message) => {
    if (message.role === 'user') return `用户：${message.content}`
    if (message.stream === 'stderr') return `错误：${message.content}`
    return `Claude：${message.content}`
  }).join('\n')
}

function appendAndEmitSessionMessage(
  db: ReturnType<typeof openDatabase>,
  sessionId: string,
  emitter: ReturnType<typeof getOrCreateEmitter>,
  input: { role: string; stream?: string | null; content: string },
) {
  const id = appendSessionMessage(db, sessionId, input)
  emitter.emit('log', { id, stream: input.stream ?? 'stdout', chunk: input.content })
}

function getBookEntryQuestion(stdout: string) {
  return stdout.trim() || '请继续补充这本书的方向。'
}

function runPromptSession(sessionId: string, prompt: string, currentSkill: string | null | undefined) {
  const emitter = getOrCreateEmitter(sessionId)
  const runDb = openDatabase(getDatabasePath())
  const session = new ClaudeSession()
  let stdout = ''
  let stderr = ''
  let finished = false

  const finish = async (exitCode: number | null) => {
    if (finished) return
    finished = true

    if (exitCode !== 0) {
      updateSessionStatus(runDb, sessionId, 'failed', currentSkill ?? null)
      emitter.emit('done', { status: 'failed' })
      runDb.close()
      return
    }

    if ((currentSkill ?? null) === 'book-entry') {
      if (parseGeneratedBook(stdout).isComplete) {
        const materialized = await materializeGeneratedBook(stdout, getDatabasePath())
        updateSessionMetadata(runDb, sessionId, {
          contextSnapshotJson: JSON.stringify({ createdBookId: materialized.bookId, title: materialized.title, rootPath: materialized.rootPath }),
        })
        updateSessionStatus(runDb, sessionId, 'succeeded', currentSkill ?? null)
        emitter.emit('done', { status: 'succeeded' })
        runDb.close()
        return
      }

      updateSessionPendingQuestion(runDb, sessionId, { question: getBookEntryQuestion(stdout), options: [] })
      updateSessionStatus(runDb, sessionId, 'waiting-answer', currentSkill ?? null)
      emitter.emit('question', { toolUseId: 'book-entry', question: getBookEntryQuestion(stdout), options: [] })
      runDb.close()
      return
    }

    updateSessionStatus(runDb, sessionId, 'succeeded', currentSkill ?? null)
    emitter.emit('done', { status: 'succeeded' })
    runDb.close()
  }

  session.on('claude', (event: ClaudeEvent) => {
    void (async () => {
      switch (event.type) {
        case 'text': {
          stdout += event.text
          appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'assistant', stream: 'stdout', content: event.text })
          break
        }
        case 'tool_use': {
          const msg = `\n[tool: ${event.name}]\n`
          stdout += msg
          appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'tool', stream: 'stdout', content: msg })
          break
        }
        case 'question': {
          if (finished) break
          finished = true
          const question = event.question || getBookEntryQuestion(stdout)
          updateSessionStatus(runDb, sessionId, 'waiting-answer')
          updateSessionPendingQuestion(runDb, sessionId, { question, options: event.options })
          emitter.emit('question', { toolUseId: event.toolUseId, question, options: event.options })
          session.kill()
          runDb.close()
          break
        }
        case 'error': {
          stderr += event.message
          appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'assistant', stream: 'stderr', content: event.message })
          break
        }
        case 'done': {
          await finish(event.exitCode)
          break
        }
      }
    })().catch((error) => {
      appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'assistant', stream: 'stderr', content: String(error) })
      updateSessionStatus(runDb, sessionId, 'failed', currentSkill ?? null)
      emitter.emit('done', { status: 'failed' })
      if (!finished) runDb.close()
      finished = true
    })
  })

  session.start(prompt)
}

const chapterActionMap: Record<string, ChapterCommandAction> = {
  'chapter-polish': 'chapter-polish',
  'chapter-deslop': 'chapter-deslop',
  'chapter-review': 'chapter-review',
  'chapter-rewrite': 'chapter-rewrite',
  'chapter-pipeline': 'chapter-write',
}

export async function registerSessionRoutes(app: FastifyInstance) {
  app.post<{
    Body: { kind: SessionKind; bookId?: string; chapterId?: string; currentSkill?: string; prompt?: string; idea?: string }
  }>('/api/sessions', async (request, reply) => {
    const { kind, bookId, chapterId, currentSkill, prompt, idea } = request.body || {} as any

    if (!kind) {
      return reply.code(400).send({ error: 'kind is required' })
    }

    const sessionPrompt = (currentSkill ?? null) === 'book-entry' && typeof idea === 'string'
      ? buildBookEntryPrompt(idea.trim())
      : prompt

    const db = openDatabase(getDatabasePath())
    const isBookMasterSession = kind === 'prompt' && !!bookId && currentSkill === 'book-master-session'
    const existingBookMasterSession = isBookMasterSession ? findBookMasterSession(db, bookId) : null
    const session = existingBookMasterSession ?? createSession(db, { kind, bookId, chapterId, currentSkill })
    db.close()

    if (kind === 'prompt' && sessionPrompt && !existingBookMasterSession) {
      runPromptSession(session.id, sessionPrompt, currentSkill)
    }

    if (kind === 'chapter' && chapterId) {
      const emitter = getOrCreateEmitter(session.id)
      const runDb = openDatabase(getDatabasePath())
      const chapter = runDb.prepare(
        `SELECT c.id, c.stage, c.title, c.source_path, c.chapter_number, c.book_id,
                b.title AS book_title, b.root_path AS book_root
         FROM chapters c
         JOIN books b ON b.id = c.book_id
         WHERE c.id = ?`
      ).get(chapterId) as {
        id: string
        stage: string
        title: string
        source_path: string
        chapter_number: number
        book_id: string
        book_title: string
        book_root: string
      } | undefined

      if (chapter) {
        const action = chapterActionMap[currentSkill || 'chapter-pipeline'] ?? 'chapter-write'
        const command = buildChapterCommand({
          action,
          bookTitle: chapter.book_title,
          bookRoot: chapter.book_root,
          chapterNumber: chapter.chapter_number,
          chapterTitle: chapter.title,
          chapterPath: chapter.source_path,
        })

        void runTerminalSessionCommand({
          databasePath: getDatabasePath(),
          sessionId: session.id,
          bookId: chapter.book_id,
          command,
        })
        runDb.close()
      } else {
        updateSessionStatus(runDb, session.id, 'failed', currentSkill ?? null)
        appendAndEmitSessionMessage(runDb, session.id, emitter, {
          role: 'assistant',
          stream: 'stderr',
          content: 'chapter not found',
        })
        emitter.emit('done', { status: 'failed' })
        runDb.close()
      }
    }

    return reply.code(201).send({ session })
  })

  app.get<{ Querystring: { kind?: SessionKind } }>('/api/sessions', async (request) => {
    const { kind } = request.query || {}
    const db = openDatabase(getDatabasePath())
    const sessions = kind ? listSessionsByKind(db, kind) : []
    db.close()
    return { sessions }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    db.close()

    if (!session) {
      return reply.code(404).send({ error: 'session not found' })
    }

    return { session }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/stream', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)

    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const messages = getSessionMessages(db, sessionId)
    for (const message of messages) {
      reply.raw.write(`data: ${JSON.stringify({ id: message.id, stream: message.stream || 'stdout', chunk: message.content })}\n\n`)
    }

    if (session.pendingQuestionJson) {
      reply.raw.write(`event: question\ndata: ${session.pendingQuestionJson}\n\n`)
    }

    if (session.status === 'succeeded' || session.status === 'failed') {
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ status: session.status })}\n\n`)
      reply.raw.end()
      db.close()
      return
    }

    db.close()
    const emitter = getOrCreateEmitter(sessionId)

    const onLog = (data: { stream: string; chunk: string }) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    const onQuestion = (data: { toolUseId: string; question: string; options: any[] }) => {
      reply.raw.write(`event: question\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const onDone = (data: { status: string }) => {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`)
      reply.raw.end()
      cleanup()
    }
    const cleanup = () => {
      emitter.off('log', onLog)
      emitter.off('question', onQuestion)
      emitter.off('done', onDone)
    }

    emitter.on('log', onLog)
    emitter.on('question', onQuestion)
    emitter.on('done', onDone)
    request.raw.on('close', cleanup)
  })

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/interrupt', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, request.params.sessionId)
    db.close()

    if (!session) return reply.code(404).send({ error: 'session not found' })
    if (!session.bookId) return reply.code(400).send({ error: 'session has no bookId' })

    const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
    await runtime.interrupt({ bookId: session.bookId })
    return { interrupted: true }
  })

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/compress', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    updateSessionMetadata(db, sessionId, {
      compressedAt: new Date().toISOString(),
    })
    const updated = getSessionById(db, sessionId)
    db.close()
    return { session: updated }
  })

  app.post<{
    Params: { sessionId: string }
    Body: { answer: string }
  }>('/api/sessions/:sessionId/answer', async (request, reply) => {
    const { sessionId } = request.params
    const { answer } = request.body || {} as any

    if (!answer) {
      return reply.code(400).send({ error: 'answer is required' })
    }

    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    const ok = submitAnswer(sessionId, answer)
    if (ok) {
      db.close()
      return { answered: true }
    }

    if (session.currentSkill === 'book-entry' && session.status === 'waiting-answer') {
      appendSessionMessage(db, sessionId, { role: 'user', stream: 'question', content: answer })
      updateSessionPendingQuestion(db, sessionId, null)
      updateSessionStatus(db, sessionId, 'running', session.currentSkill)
      const messages = getSessionMessages(db, sessionId)
      const prompt = buildBookEntryContinuePrompt(buildSessionTranscript(messages))
      db.close()
      runPromptSession(sessionId, prompt, session.currentSkill)
      return { answered: true }
    }

    db.close()
    return reply.code(404).send({ error: 'no pending question for this session' })
  })
}
