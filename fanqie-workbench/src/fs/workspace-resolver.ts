import { resolve } from 'node:path'

export function resolveNovelsRoot(workspaceRoot: string) {
  return resolve(workspaceRoot, 'novels')
}
