export type PermissionPromptDetection = {
  kind: 'bash-permission'
  title: string
  excerpt: string
  recommendation: string
  terminalInstruction: string
}

function extractExcerpt(capture: string) {
  const marker = capture.lastIndexOf('Bash command')
  const excerpt = marker >= 0 ? capture.slice(marker) : capture
  return excerpt.trim()
}

export function detectPermissionPrompt(capture: string): PermissionPromptDetection | null {
  if (!capture.includes('Bash command')) return null
  if (!capture.includes('Do you want to proceed?')) return null
  if (!/\bNo\b/.test(capture)) return null

  return {
    kind: 'bash-permission',
    title: 'Claude 正在等待 Bash 权限确认',
    excerpt: extractExcerpt(capture),
    recommendation: '检测到 Claude Code 请求执行 Bash 命令。请确认命令内容和路径属于当前工作，再决定是否允许。',
    terminalInstruction: '请回到终端处理权限确认。当前选中项通常是 Yes；如确认安全，可按 Enter 允许本次。',
  }
}
