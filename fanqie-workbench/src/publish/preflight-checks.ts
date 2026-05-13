export function preflightCheck(input: {
  accountId: string | null
  accountStatus: string | null
  publishableCount: number
}) {
  const errors: string[] = []

  if (!input.accountId) {
    errors.push('Book is not bound to any account')
  }

  if (input.accountStatus !== 'active') {
    errors.push(`Account status is ${input.accountStatus || 'unknown'}, must be active`)
  }

  if (input.publishableCount === 0) {
    errors.push('No publishable chapters found')
  }

  return { ok: errors.length === 0, errors }
}
