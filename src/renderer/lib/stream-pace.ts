// Smooth streaming (#52): claude sends an answer in uneven bursts, and drawing each burst as
// it lands makes the text jump. The view instead reveals what has arrived at a steady pace that
// grows with what is waiting, so it never trails the CLI by more than about CATCH_UP_S.

/** Characters a second while little is waiting. */
export const BASE_CPS = 90
/** How far behind the reveal may fall: the rate is the backlog spread over this. */
export const CATCH_UP_S = 0.5
/** A frame longer than this (a hidden or busy window) counts as this long. */
const MAX_FRAME_MS = 100

/** How many characters to show after a frame of `dtMs`, given `shown` of `target`. */
export function paceStep(shown: number, target: number, dtMs: number): number {
  if (shown >= target) return target
  const cps = Math.max(BASE_CPS, (target - shown) / CATCH_UP_S)
  const step = Math.max(1, Math.round((cps * Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)) / 1000))
  return Math.min(target, shown + step)
}

/** The first `n` characters, never cutting a surrogate pair (emoji) in half. */
export function revealed(text: string, n: number): string {
  if (n >= text.length) return text
  const code = text.charCodeAt(n - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n + 1 : n)
}

/**
 * The first `n` characters, cut back to the end of the last whole word (#62), so a word appears
 * all at once and can fade in, never letter by letter. A word longer than what is shown (a long
 * link) waits until it is all there.
 */
export function revealedWords(text: string, n: number): string {
  if (n >= text.length) return text
  let i = Math.max(n, 0)
  while (i > 0 && !/\s/.test(text[i]!)) i--
  return text.slice(0, i)
}
