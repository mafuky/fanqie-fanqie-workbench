const DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 一..九十九 与阿拉伯数字 → int;无法解析返回 null。 */
export function chineseNumeralToInt(raw: string): number | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t)
  if (t === '十') return 10
  if (t.includes('十')) {
    const [a, b] = t.split('十')
    const tens = a === '' ? 1 : DIGITS[a]
    const ones = b === '' ? 0 : DIGITS[b]
    if (tens == null || ones == null) return null
    return tens * 10 + ones
  }
  if (t.length === 1 && DIGITS[t] != null && t !== '零') return DIGITS[t]
  return null
}

/** 卷纲_第X卷.md → 卷号(X 为中文数字);否则 null。 */
export function parseVolumeFileName(filename: string): number | null {
  const m = filename.match(/^卷纲_第(.+)卷\.md$/)
  return m ? chineseNumeralToInt(m[1]) : null
}

function matchRange(line: string): { start: number; end: number } | null {
  const m = line.match(/第\s*(\d+)\s*[-–—~至]\s*(\d+)\s*章/)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  if (!(start >= 1) || !(end >= start)) return null
  return { start, end }
}

/** 从卷纲全文取「章节范围」那一行的区间;无该行返回 null(不拿爽点节奏里的章号凑数)。 */
export function parseVolumeChapterRange(volumeText: string): { start: number; end: number } | null {
  for (const line of volumeText.split('\n')) {
    if (line.includes('章节范围')) {
      const r = matchRange(line)
      if (r) return r
    }
  }
  return null
}

export type VolumeRange = { volumeNumber: number; start: number; end: number }

/** N 恰是某卷末章且该卷唯一包含 N → 返回该卷;无匹配/重叠/非末章 → null。 */
export function findVolumeEndingAt(chapterN: number, volumes: VolumeRange[]): VolumeRange | null {
  const containing = volumes.filter((v) => chapterN >= v.start && chapterN <= v.end)
  if (containing.length !== 1) return null
  const v = containing[0]
  return chapterN === v.end ? v : null
}
