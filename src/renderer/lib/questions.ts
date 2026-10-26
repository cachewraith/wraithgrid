// Claude's questions (AskUserQuestion) asked one at a time (#127): the pure parts of the stepper.

/** claude marks its pick by ending a label with "(Recommended)": shown as a tag instead. */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
  const m = /^(.*?)\s*\(recommended\)\s*$/i.exec(label)
  return m && m[1] ? { text: m[1], recommended: true } : { text: label, recommended: false }
}

/** Where a pick on question `at` goes: the next unanswered one after it, else the next one. */
export function nextQuestion(at: number, answered: readonly boolean[]): number {
  for (let i = at + 1; i < answered.length; i++) if (!answered[i]) return i
  return Math.min(at + 1, answered.length - 1)
}
