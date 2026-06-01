import { useCallback, useEffect, useState } from 'react'
import { spacing, radius, fontSize } from '../styles/tokens.js'

type AssetNodeType = 'dir' | 'text' | 'image'
interface AssetNode {
  path: string
  name: string
  type: AssetNodeType
  children?: AssetNode[]
}

export function BookAssetsPanel({ bookId }: { bookId: string }) {
  const [tree, setTree] = useState<AssetNode[]>([])
  const [selected, setSelected] = useState<AssetNode | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadTree = useCallback(async () => {
    const res = await fetch(`/api/books/${bookId}/assets`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(body.error || '加载资产失败'); return }
    setTree(body.tree || [])
  }, [bookId])

  useEffect(() => { void loadTree() }, [loadTree])

  const openNode = async (node: AssetNode) => {
    if (node.type === 'dir') return
    setSelected(node)
    setDirty(false)
    if (node.type === 'text') {
      const res = await fetch(`/api/books/${bookId}/file?path=` + encodeURIComponent(node.path))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || '读取失败'); return }
      setContent(body.content ?? '')
    }
  }

  const save = async () => {
    if (!selected || selected.type !== 'text') return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/${bookId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selected.path, content }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || '保存失败'); return }
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const renderNodes = (nodes: AssetNode[], depth = 0) => nodes.map((node) => (
    <div key={node.path}>
      <div
        onClick={() => void openNode(node)}
        style={{ paddingLeft: depth * 12 + spacing.sm, paddingTop: 4, paddingBottom: 4, cursor: node.type === 'dir' ? 'default' : 'pointer', fontSize: fontSize.sm }}
      >
        {node.type === 'dir' ? '📁' : node.type === 'image' ? '🖼' : '📄'} {node.name}
      </div>
      {node.children && node.children.length > 0 && renderNodes(node.children, depth + 1)}
    </div>
  ))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: spacing.md, alignItems: 'start' }}>
      <aside style={{ border: '1px solid var(--border)', borderRadius: radius.md, padding: spacing.sm, maxHeight: 520, overflowY: 'auto' }}>
        {error && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}
        {tree.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>暂无资产</div> : renderNodes(tree)}
      </aside>
      <section style={{ minHeight: 200 }}>
        {selected?.type === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <strong style={{ fontSize: fontSize.sm }}>{selected.path}</strong>
              <button onClick={() => void save()} disabled={saving || !dirty}>{saving ? '保存中…' : '保存'}</button>
            </div>
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true) }}
              style={{ width: '100%', minHeight: 420, fontFamily: 'monospace', fontSize: fontSize.sm, padding: spacing.sm }}
            />
          </div>
        )}
        {selected?.type === 'image' && (
          <img src={`/api/books/${bookId}/file?path=` + encodeURIComponent(selected.path)} alt={selected.name} style={{ maxWidth: '100%' }} />
        )}
        {!selected && <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>点击左侧文件查看内容</div>}
      </section>
    </div>
  )
}
