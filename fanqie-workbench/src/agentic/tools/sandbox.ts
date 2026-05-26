import { resolve, sep } from 'node:path'

export function resolveInsideRoot(bookRoot: string, relative: string): string {
  const root = resolve(bookRoot)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path is outside book root: ${relative}`)
  }
  return target
}
