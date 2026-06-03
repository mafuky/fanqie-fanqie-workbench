export type DiffPart = { type: 'eq' | 'del' | 'ins'; text: string }

// Above this DP cell count (~1.4M) we skip the LCS and show a whole-block replace.
// Selections are bounded well below this; the guard just protects pathological inputs.
const MAX_DP_CELLS = 1_400_000

/**
 * Character-level diff between `a` (original) and `b` (rewrite), coalesced into runs.
 * - `eq`  shared text
 * - `del` text only in `a` (render red / strikethrough)
 * - `ins` text only in `b` (render green)
 *
 * Invariants: joining {eq,del} == a, joining {eq,ins} == b. Newlines are ordinary chars,
 * so multi-line selections reconstruct exactly. Uses Array.from to respect unicode.
 */
export function diffChars(a: string, b: string): DiffPart[] {
  const A = Array.from(a)
  const B = Array.from(b)
  const n = A.length
  const m = B.length

  if (n === 0 && m === 0) return []
  if ((n + 1) * (m + 1) > MAX_DP_CELLS) {
    const parts: DiffPart[] = []
    if (a) parts.push({ type: 'del', text: a })
    if (b) parts.push({ type: 'ins', text: b })
    return parts
  }

  // LCS length table (suffix DP).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const raw: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { raw.push({ type: 'eq', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ type: 'del', text: A[i] }); i++ }
    else { raw.push({ type: 'ins', text: B[j] }); j++ }
  }
  while (i < n) { raw.push({ type: 'del', text: A[i] }); i++ }
  while (j < m) { raw.push({ type: 'ins', text: B[j] }); j++ }

  // Coalesce adjacent runs of the same type.
  const out: DiffPart[] = []
  for (const part of raw) {
    const last = out[out.length - 1]
    if (last && last.type === part.type) last.text += part.text
    else out.push({ type: part.type, text: part.text })
  }
  return out
}
