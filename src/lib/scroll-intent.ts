const promptSubmissionAt = new Map<string, number>();

export function markPromptSubmitted(convId: string) {
  promptSubmissionAt.set(convId, Date.now());
}

export function getPromptSubmittedAt(convId: string): number {
  return promptSubmissionAt.get(convId) ?? 0;
}
