export function AccountsPage() {
  return (
    <div>
      <h1>账号管理</h1>
      <div style={{ marginBottom: 16 }}>
        <button style={{ padding: '8px 16px', background: '#2196f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          添加账号
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>标签</th>
            <th style={{ textAlign: 'left', padding: 8 }}>状态</th>
            <th style={{ textAlign: 'left', padding: 8 }}>最后检查</th>
            <th style={{ textAlign: 'left', padding: 8 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#999' }}>
              暂无账号，点击上方按钮添加
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
