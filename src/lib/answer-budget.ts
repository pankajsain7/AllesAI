// Fits many model answers into one model's context window.
//
// Consensus and council both hand a whole panel of answers to a single reader
// (a judge, a synthesizer, a moderator). That payload has to be cut down, and
// how it is cut decides how much real signal survives — so it lives here with
// a check script rather than inline in the route.

import { getModel } from "./models";

/** Fallback ceiling when the target model's window is unknown. */
export const DEFAULT_CONTEXT_BUDGET = 280_000;

// Rough chars-per-token used to convert an advertised window into characters,
// and the share of that window the candidate answers may occupy. The rest is
// headroom for the system prompt and the model's own output.
const CHARS_PER_TOKEN = 3.5;
const CONTEXT_INPUT_SHARE = 0.6;
const MIN_CONTEXT_BUDGET = 20_000;

// Below this an excerpt has no room for a meaningful head and tail, so it
// degrades to a plain head slice.
const MIN_EXCERPT_ROOM = 200;

// Share of an excerpt given to the opening. The rest goes to the closing,
// which is usually where the recommendation is.
const EXCERPT_HEAD_SHARE = 0.6;

/**
 * Character budget for one model, derived from its own context window and
 * clamped to `cap`.
 *
 * A fixed budget regardless of target meant a small-window judge was handed a
 * payload it could only reject, while a large-window synthesizer never got to
 * use the headroom it was chosen for.
 */
export function contextBudgetFor(modelId: string, cap: number): number {
  const context = getModel(modelId)?.context;
  if (!context) return Math.min(cap, DEFAULT_CONTEXT_BUDGET);
  const fromWindow = Math.floor(context * CHARS_PER_TOKEN * CONTEXT_INPUT_SHARE);
  return Math.max(MIN_CONTEXT_BUDGET, Math.min(cap, fromWindow));
}

/**
 * Keeps the opening and the closing of an over-long answer and drops the
 * middle. A head-only slice throws away the conclusion, which is usually the
 * part that carries the actual recommendation.
 */
export function excerpt(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const label = `\n\n...[${content.length - limit} characters omitted]...\n\n`;
  const room = limit - label.length;
  if (room < MIN_EXCERPT_ROOM) return `${content.slice(0, Math.max(1, limit))}\n...[truncated]`;
  const head = Math.ceil(room * EXCERPT_HEAD_SHARE);
  return content.slice(0, head) + label + content.slice(content.length - (room - head));
}

/**
 * Fits answers into `maxTotalChars` by water-filling: every answer shorter
 * than its fair share is kept whole and its unused slack is redistributed to
 * the longer ones.
 *
 * A flat `budget / n` split truncated one thorough answer to the same size as
 * a one-line one while leaving most of the budget unspent.
 */
export function fitAnswers<T extends { content: string }>(
  answers: T[],
  maxTotalChars = DEFAULT_CONTEXT_BUDGET
): T[] {
  if (answers.length === 0) return answers;

  const limits = new Map<number, number>();
  let remaining = maxTotalChars;
  let open = answers.map((answer, index) => ({ index, length: answer.content.length }));

  while (open.length > 0) {
    const share = Math.floor(remaining / open.length);
    const fits = open.filter((entry) => entry.length <= share);
    if (fits.length === 0) {
      for (const entry of open) limits.set(entry.index, share);
      break;
    }
    for (const entry of fits) {
      limits.set(entry.index, entry.length);
      remaining -= entry.length;
    }
    open = open.filter((entry) => entry.length > share);
  }

  return answers.map((answer, index) => {
    const limit = Math.max(1, limits.get(index) ?? maxTotalChars);
    return answer.content.length <= limit
      ? answer
      : { ...answer, content: excerpt(answer.content, limit) };
  });
}
