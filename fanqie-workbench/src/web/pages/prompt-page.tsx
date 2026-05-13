import { useState, useCallback } from 'react'
import { LiveLogPanel } from '../components/live-log-panel.js'

export function PromptPage() {
  const [prompt, setPrompt] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return
    setStatus('running')
    setTaskId(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const data = await res.json()
      setTaskId(data.taskId)
    } catch {
      setStatus('failed')
    }
  }, [prompt])

  const handleDone = useCallback((finalStatus: string) => {
    setStatus(finalStatus === 'succeeded' ? 'succeeded' : 'failed')
  }, [])

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>执行任务</h2>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="输入提示词，例如：使用 chinese-novelist-skill 为《雾港疑局》写第5章..."
        rows={6}
        style={{
          width: '100%',
          padding: 12,
          background: '#161b22',
          color: '#c9d1d9',
          border: '1px solid #30363d',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSubmit}
          disabled={status === 'running' || !prompt.trim()}
          style={{
            padding: '8px 20px',
            background: status === 'running' ? '#30363d' : '#238636',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: status === 'running' ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {status === 'running' ? '执行中...' : '执行'}
        </button>

        {status === 'succeeded' && <span style={{ color: '#3fb950' }}>完成</span>}
        {status === 'failed' && <span style={{ color: '#f85149' }}>失败</span>}
      </div>

      {taskId && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8, color: '#8b949e' }}>执行日志</h3>
          <LiveLogPanel taskId={taskId} onDone={handleDone} />
        </div>
      )}
    </div>
  )
}
