export function computePublishSuccessRate(input: { succeeded: number; failed: number }) {
  const total = input.succeeded + input.failed
  if (total === 0) return 0
  return Math.round((input.succeeded / total) * 100)
}
