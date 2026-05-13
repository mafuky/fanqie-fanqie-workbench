export function TaskLogPanel({ lines }: { lines: string[] }) {
  return (
    <pre style={{
      background: '#1e1e1e',
      color: '#d4d4d4',
      padding: 12,
      borderRadius: 4,
      fontSize: 12,
      maxHeight: 400,
      overflow: 'auto'
    }}>
      {lines.join('\n')}
    </pre>
  )
}
