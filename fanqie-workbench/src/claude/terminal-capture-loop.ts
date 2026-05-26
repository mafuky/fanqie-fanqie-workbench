import type Database from 'better-sqlite3'
import {
  appendSessionMessage,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
  type SessionStatus,
} from '../db/repositories/sessions-repo.js'
import { detectPermissionPrompt } from './permission-prompt-detector.js'
import { getOrCreateEmitter } from './stream-capture.js'
import type { TerminalRuntime } from './terminal-runtime.js'

export type CaptureLoopCompletion =
  | { status: 'succeeded' }
  | { status: 'waiting-permission' }
  | { status: 'waiting-review' }
  | { status: 'waiting-answer'; question: string }
  | { status: 'failed'; message: string }

export type RunTerminalCaptureLoopInput = {
  db: Database.Database
  sessionId: string
  bookId: string
  runtime: TerminalRuntime
  currentSkill?: string | null
  captureIntervalMs?: number
  maxCaptureMs?: number
  initialCapture?: string
  isComplete?: (capture: string) => boolean
  shouldWaitForAnswer?: (capture: string) => boolean
  getPendingQuestion?: (capture: string) => string
  beforeComplete?: (capture: string) => Promise<void>
  completeStatus?: Extract<SessionStatus, 'succeeded' | 'waiting-review'>
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function extractMeaningfulContent(capture: string): string {
  const lines = capture.split('\n')
  const result: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/[▐▛▝▜▘]/.test(line)) continue
    if (/^─{10,}/.test(t)) break
    if (t.length > 1 && /^[^\w\s]/.test(t) && /…/.test(t) && !/^⏺/.test(t)) continue
    if (/[☐☒]/.test(line)) continue
    if (/\[[ ✔✓]\]\s*\d+\./.test(t) || /^\d+\.\s*\[[ ✔✓]\]/.test(t)) continue
    if (/^(Enter to select|Enter to confirm|Use ↑|space to toggle|Ready to submit)/i.test(t)) continue
    if (/^←\s/.test(t) && /→\s*$/.test(t)) continue
    if (/^●\s/.test(t)) continue
    if (/^→\s/.test(t) && t.length < 80) continue
    if (/^Review your answers/.test(t)) continue
    result.push(line)
  }
  return result.join('\n')
}

export function stripTerminalChrome(capture: string): string {
  const lines = capture.split('\n')
  const result: string[] = []
  for (const line of lines) {
    if (/^─{10,}/.test(line.trim())) break
    result.push(line)
  }
  return result.join('\n')
}

export function getCaptureDelta(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next.startsWith(previous)) return next.slice(previous.length)

  const prevLines = previous.split('\n')
  const nextLines = next.split('\n')

  let common = 0
  for (let i = 0; i < Math.min(prevLines.length, nextLines.length); i++) {
    if (prevLines[i] !== nextLines[i]) break
    common = i + 1
  }

  if (common > 0 && nextLines.length > common) {
    return nextLines.slice(common).join('\n')
  }

  return ''
}

function appendAndEmit(db: Database.Database, sessionId: string, stream: 'stdout' | 'stderr', content: string) {
  const emitter = getOrCreateEmitter(sessionId)
  const id = appendSessionMessage(db, sessionId, { role: 'assistant', stream, content })
  emitter.emit('log', { id, stream, chunk: content })
}

function detectAskUserQuestion(rawCapture: string): { question: string; options: Array<{ label: string; checked?: boolean }>; multiSelect: boolean } | null {
  const hasEnterInstruction = /Enter to select/.test(rawCapture) || /Enter to confirm/.test(rawCapture)
  const hasCursorOnOption = /^\s*❯\s*(?:☐\s*|☒\s*)?(?:\[[ ✔✓]\]\s*)?\d+\.\s/m.test(rawCapture)
  if (!hasEnterInstruction && !hasCursorOnOption) return null

  const lines = rawCapture.split('\n')
  const options: Array<{ label: string; checked?: boolean }> = []
  let hasCheckboxes = false

  for (const line of lines) {
    const optionMatch = line.match(/^\s*(?:❯\s*)?(?:☐\s*|☒\s*)?(?:\[([ ✔✓])\]\s*)?(\d+)\.\s+(.+)/)
    if (optionMatch) {
      const checkMark = optionMatch[1]
      const num = optionMatch[2]
      let label = optionMatch[3].trim()
      label = label.replace(/^\[[ ✔✓]\]\s*/, '').replace(/^☐\s*|^☒\s*/, '')
      if (checkMark !== undefined) {
        hasCheckboxes = true
        options.push({ label: `${num}. ${label}`, checked: checkMark === '✔' || checkMark === '✓' })
      } else {
        options.push({ label: `${num}. ${label}` })
      }
    }
  }

  const multiSelect = hasCheckboxes || (/[☐☒]/.test(rawCapture) && !/^\s*[☐☒]\s*(目标|核心|对标|写作)/m.test(rawCapture))

  let question = ''
  const separatorIndices: number[] = []
  lines.forEach((line, i) => { if (/^─{10,}/.test(line.trim())) separatorIndices.push(i) })
  if (separatorIndices.length >= 1) {
    const afterFirstSep = separatorIndices[0] + 1
    for (let i = afterFirstSep; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed || /^[←→]/.test(trimmed) || /^☐|^☒|^✔/.test(trimmed)) continue
      if (/^\d+\./.test(trimmed) || /^❯/.test(trimmed)) break
      if (trimmed.length > 2 && !/^Enter to/.test(trimmed) && !/^─/.test(trimmed) && !/^Review your/.test(trimmed) && !/^Ready to/.test(trimmed) && !/^Tab\/Arrow/.test(trimmed)) {
        question = trimmed
        break
      }
    }
  }

  if (options.length === 0) return null
  return { question: question || '请选择一个选项。', options, multiSelect }
}

export async function runTerminalCaptureLoop(input: RunTerminalCaptureLoopInput): Promise<CaptureLoopCompletion> {
  const intervalMs = input.captureIntervalMs ?? 1000
  const maxMs = input.maxCaptureMs ?? 1800000
  let contentHasChanged = false
  let stablePolls = 0
  const isComplete = input.isComplete ?? ((capture: string) => {
    if (!capture.trim()) return false
    const lines = capture.split('\n')

    const sepIndices: number[] = []
    for (let i = lines.length - 1; i >= 0 && sepIndices.length < 2; i--) {
      if (/^─{10,}/.test(lines[i].trim())) sepIndices.push(i)
    }

    const recentStart = Math.max(0, lines.length - 40)
    const recentLines = lines.slice(recentStart)
    const hasThinking = recentLines.some(line => {
      const t = line.trim()
      return t.length > 1 && /^[^\w\s]/.test(t) && /…/.test(t) && !/^⏺/.test(t)
    })
    if (hasThinking) return false

    if (sepIndices.length >= 2 && lines.some(line => /^\s*⏺/.test(line))) {
      for (let i = sepIndices[1] + 1; i < sepIndices[0]; i++) {
        if (/^\s*❯/.test(lines[i]) && !/^\s*❯\s*\d+\./.test(lines[i])) return true
      }
    }

    return lines.some(line => /^\s*❯\s*$/.test(line))
  })
  const shouldWaitForAnswer = input.shouldWaitForAnswer ?? (() => false)
  const getPendingQuestion = input.getPendingQuestion ?? ((capture: string) => {
    const tail = capture.split('\n').map((line) => line.trim()).filter(Boolean).slice(-8).join('\n')
    return tail || '请继续补充。'
  })

  const startedAt = Date.now()
  let emittedLength = extractMeaningfulContent(input.initialCapture ?? '').length
  let latestCapture = ''
  let lastMeaningfulLength = emittedLength

  while (Date.now() - startedAt < maxMs) {
    latestCapture = await input.runtime.capture({ bookId: input.bookId })
    const meaningful = extractMeaningfulContent(latestCapture)

    if (meaningful.length > emittedLength) {
      contentHasChanged = true
      stablePolls = 0
      const newContent = meaningful.slice(emittedLength)
      if (newContent.trim()) appendAndEmit(input.db, input.sessionId, 'stdout', newContent)
      emittedLength = meaningful.length
    } else if (meaningful.length !== lastMeaningfulLength) {
      stablePolls = 0
    } else {
      stablePolls++
    }
    lastMeaningfulLength = meaningful.length

    const captureLines = latestCapture.split('\n')
    for (let i = captureLines.length - 1; i >= Math.max(0, captureLines.length - 40); i--) {
      const t = captureLines[i].trim()
      if (t.length > 1 && /^[^\w\s]/.test(t) && /…/.test(t) && !/^⏺/.test(t)) {
        getOrCreateEmitter(input.sessionId).emit('thinking', { text: t })
        break
      }
    }

    const permissionPrompt = detectPermissionPrompt(latestCapture)
    if (permissionPrompt) {
      updateSessionMetadata(input.db, input.sessionId, {
        contextSnapshotJson: JSON.stringify({ permissionPrompt }),
      })
      updateSessionStatus(input.db, input.sessionId, 'waiting-permission', input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('permission-blocked', permissionPrompt)
      return { status: 'waiting-permission' }
    }

    const askQuestion = detectAskUserQuestion(latestCapture)
    if (askQuestion) {
      updateSessionPendingQuestion(input.db, input.sessionId, askQuestion)
      updateSessionStatus(input.db, input.sessionId, 'waiting-answer' as SessionStatus, input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('question', { toolUseId: input.sessionId, ...askQuestion })
      return { status: 'waiting-answer', question: askQuestion.question }
    }

    if (contentHasChanged && stablePolls >= 5 && isComplete(latestCapture)) {
      await input.beforeComplete?.(latestCapture)
      const completeStatus = input.completeStatus ?? 'succeeded'
      updateSessionStatus(input.db, input.sessionId, completeStatus, input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('done', { status: completeStatus })
      return { status: completeStatus }
    }

    if (shouldWaitForAnswer(latestCapture)) {
      const question = getPendingQuestion(latestCapture)
      updateSessionPendingQuestion(input.db, input.sessionId, { question, options: [] })
      updateSessionStatus(input.db, input.sessionId, 'waiting-answer' as SessionStatus, input.currentSkill ?? undefined)
      getOrCreateEmitter(input.sessionId).emit('question', { toolUseId: input.sessionId, question, options: [] })
      return { status: 'waiting-answer', question }
    }

    await wait(intervalMs)
  }

  const message = 'terminal capture timed out before completion marker'
  appendAndEmit(input.db, input.sessionId, 'stderr', message)
  updateSessionStatus(input.db, input.sessionId, 'failed', input.currentSkill ?? undefined)
  getOrCreateEmitter(input.sessionId).emit('done', { status: 'failed' })
  return { status: 'failed', message }
}
