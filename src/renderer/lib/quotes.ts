import { CHAT_TEXT_MAX } from '@shared/chat'

// Reply to a part of the chat (#164): selected text becomes a quote in the message box and goes
// out as a markdown blockquote before the typed text. Plain text, so every chat CLI takes it.

/** Quotes one message can carry. */
export const QUOTES_MAX = 5

export interface Quote {
  text: string
  /** Cut at CHAT_TEXT_MAX. */
  trimmed: boolean
}

/** A selection as a quote: blank lines around it dropped, cut at the text limit; null if blank. */
export function makeQuote(selected: string, max = CHAT_TEXT_MAX): Quote | null {
  const text = selected
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd()
  if (!text.trim()) return null
  return text.length > max
    ? { text: text.slice(0, max).trimEnd(), trimmed: true }
    : { text, trimmed: false }
}

/** Code as a fenced block, with a fence longer than any run of backticks inside it. */
export function fenceCode(code: string, lang = ''): string {
  const run = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(Math.max(3, run + 1))
  return `${fence}${lang}\n${code.replace(/\n+$/, '')}\n${fence}`
}

/** One quote as a blockquote: every line behind `> ` (an empty one behind a bare `>`). */
export function quoteBlock(q: Quote): string {
  const body = q.trimmed ? `${q.text}\n[…trimmed]` : q.text
  return body
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
}

/** The message as sent: the quotes first, a blank line between blocks, then the typed text. */
export function withQuotes(quotes: readonly Quote[], body: string): string {
  return [...quotes.map(quoteBlock), body].filter(Boolean).join('\n\n')
}

/** A sent message's leading blockquotes, unquoted, and the text after them, to draw them apart. */
export function splitQuotes(text: string): { quotes: string[]; rest: string } {
  const lines = text.split('\n')
  const quotes: string[] = []
  let i = 0
  while (i < lines.length && lines[i]!.startsWith('>')) {
    const block: string[] = []
    for (; i < lines.length && lines[i]!.startsWith('>'); i++)
      block.push(lines[i]!.replace(/^> ?/, ''))
    quotes.push(block.join('\n'))
    // Blank lines between two quotes, or before the text.
    while (i < lines.length && !lines[i]!.trim()) i++
  }
  return { quotes, rest: lines.slice(i).join('\n') }
}
