import { useEffect, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

const presets = [
  { key: 'fanqie-female-reading', label: '番茄女频阅读榜' },
  { key: 'fanqie-male-reading', label: '番茄男频阅读榜' },
  { key: 'qidian-signnewbook', label: '起点签约作者新书榜' },
  { key: 'qidian-hotsales', label: '起点畅销榜' },
  { key: 'dz-female', label: '点众女频短篇' },
  { key: 'heiyan-booklist', label: '黑岩短篇书库' },
]

type Scan = { id: string; date: string; fileName: string; path?: string }

export function MarketIntelligencePage() {
  const [scans, setScans] = useState<Scan[]>([])
  const [running, setRunning] = useState<string | null>(null)

  const loadScans = async () => {
    const response = await fetch('/api/market-scans')
    const body = await response.json()
    setScans(body.scans || [])
  }

  useEffect(() => {
    void loadScans()
  }, [])

  const runPreset = async (preset: string) => {
    setRunning(preset)
    try {
      await fetch('/api/market-scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      })
      await loadScans()
    } finally {
      setRunning(null)
    }
  }

  return (
    <section style={{ display: 'grid', gap: spacing.lg }}>
      <header>
        <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>市场情报</h1>
        <p style={{ color: 'var(--text-muted)' }}>第一阶段先接入手动扫榜和 Markdown 结果绑定。</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing.md }}>
        {presets.map((preset) => (
          <button key={preset.key} onClick={() => void runPreset(preset.key)} disabled={running === preset.key} style={{ padding: spacing.lg, borderRadius: radius.lg, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            {running === preset.key ? '扫描中…' : preset.label}
          </button>
        ))}
      </div>

      <section style={{ border: '1px solid var(--border)', borderRadius: radius.lg, padding: spacing.lg }}>
        <h2 style={{ marginTop: 0 }}>最近扫描结果</h2>
        {scans.map((scan) => (
          <div key={scan.id} style={{ display: 'flex', alignItems: 'center', gap: spacing.md, padding: `${spacing.sm}px 0`, borderTop: '1px solid var(--border)' }}>
            <span>{scan.fileName}</span>
            <span style={{ color: 'var(--text-muted)' }}>{scan.date}</span>
            <span style={{ flex: 1 }} />
            <button>绑定到书</button>
          </div>
        ))}
        {scans.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无扫描结果</div>}
      </section>

      <section style={{ border: '1px dashed var(--border)', borderRadius: radius.lg, padding: spacing.lg, color: 'var(--text-muted)' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>趋势分析</h2>
        第一阶段展示扫描结果列表；趋势图表进入第二阶段。
      </section>
    </section>
  )
}
