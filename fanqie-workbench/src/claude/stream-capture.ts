import { EventEmitter } from 'node:events'
import type Database from 'better-sqlite3'

const taskEmitters = new Map<string, EventEmitter>()

// Pending questions waiting for user answers
const pendingAnswers = new Map<string, (answer: string) => void>()

export function getOrCreateEmitter(taskId: string): EventEmitter {
  let emitter = taskEmitters.get(taskId)
  if (!emitter) {
    emitter = new EventEmitter()
    taskEmitters.set(taskId, emitter)
  }
  return emitter
}

export function removeEmitter(taskId: string) {
  taskEmitters.delete(taskId)
  pendingAnswers.delete(taskId)
}

export function writeLogChunk(db: Database.Database, taskId: string, stream: 'stdout' | 'stderr', chunk: string) {
  db.prepare('INSERT INTO task_logs (task_id, stream, chunk, created_at) VALUES (?, ?, ?, ?)').run(
    taskId, stream, chunk, new Date().toISOString()
  )
}

export function getTaskLogs(db: Database.Database, taskId: string) {
  return db.prepare('SELECT stream, chunk, created_at FROM task_logs WHERE task_id = ? ORDER BY id').all(taskId) as Array<{ stream: string; chunk: string; created_at: string }>
}

export function waitForAnswer(taskId: string): Promise<string> {
  return new Promise((resolve) => {
    pendingAnswers.set(taskId, resolve)
  })
}

export function submitAnswer(taskId: string, answer: string): boolean {
  const resolver = pendingAnswers.get(taskId)
  if (resolver) {
    resolver(answer)
    pendingAnswers.delete(taskId)
    return true
  }
  return false
}

export function hasPendingQuestion(taskId: string): boolean {
  return pendingAnswers.has(taskId)
}
