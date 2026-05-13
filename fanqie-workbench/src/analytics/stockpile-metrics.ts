export function computeStockpile(input: { publishableCount: number; dailyPublishRate: number }) {
  if (input.dailyPublishRate === 0) return Infinity
  return Math.floor(input.publishableCount / input.dailyPublishRate)
}
