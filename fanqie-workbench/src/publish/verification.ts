export function verifyPublishResult(input: { pageBookTitle: string; expectedBookTitle: string }) {
  return input.pageBookTitle === input.expectedBookTitle
}
