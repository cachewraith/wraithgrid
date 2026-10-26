// ↑/↓ in the chat box step through prompts already sent (#132), like a shell's history. The
// list is the chat's own user messages, so it is per pane and kept with the saved conversation.

/** The file list `withAttachments` adds after a message: not something you typed. */
const ATTACHED = /(?:^|\n\n)Attached files:\n(?:- [^\n]*(?:\n|$))+$/

/** Sent prompts, oldest first; blank ones dropped and a repeat of the one before stored once. */
export function promptHistory(items: readonly { kind: string; text?: string }[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.kind !== 'user') continue
    const text = (it.text ?? '').replace(ATTACHED, '').trim()
    if (text && out[out.length - 1] !== text) out.push(text)
  }
  return out
}

/** Where browsing is: an entry of the list, or null (the draft); `draft` is kept meanwhile. */
export interface HistoryNav {
  index: number | null
  draft: string
}

export const NOT_BROWSING: HistoryNav = { index: null, draft: '' }

/**
 * One step: -1 (↑) to an older prompt, +1 (↓) to a newer one or back to the draft. Null when
 * there is nowhere to go (the oldest already, or not browsing on ↓), so the key does nothing.
 */
export function historyStep(
  list: readonly string[],
  nav: HistoryNav,
  dir: -1 | 1,
  current: string
): { nav: HistoryNav; text: string } | null {
  if (!list.length) return null
  if (nav.index === null) {
    if (dir === 1) return null
    const index = list.length - 1
    return { nav: { index, draft: current }, text: list[index]! }
  }
  const index = nav.index + dir
  if (index < 0) return null
  if (index >= list.length) return { nav: NOT_BROWSING, text: nav.draft }
  return { nav: { ...nav, index }, text: list[index]! }
}

/** ↑ only from the first line, ↓ only from the last; elsewhere the caret moves between lines. */
export function atEdge(text: string, start: number, end: number, dir: -1 | 1): boolean {
  if (start !== end) return false
  return dir === -1 ? !text.slice(0, start).includes('\n') : !text.slice(end).includes('\n')
}
