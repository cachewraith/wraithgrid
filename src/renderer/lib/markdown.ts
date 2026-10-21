// The markdown agents answer in, parsed to a small tree the chat view renders as React
// elements. Never HTML: agent output is untrusted text. Covers what agents write (fences,
// headings, lists, tasks, quotes, tables, rules, inline code/bold/italic/strike/links) and
// tolerates half-streamed input (an open fence is a code block so far).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'b' | 'i' | 's'; c: Inline[] }
  | { t: 'a'; href: string; c: Inline[] }

export interface ListItem {
  depth: number
  /** A `[ ]` / `[x]` task box, or null for a plain item. */
  task: boolean | null
  c: Inline[]
}

export type Block =
  | { type: 'code'; lang: string; text: string; open: boolean }
  | { type: 'heading'; level: number; c: Inline[] }
  | { type: 'para'; c: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; blocks: Block[] }
  | {
      type: 'table'
      head: Inline[][]
      rows: Inline[][][]
      align: ('left' | 'center' | 'right' | null)[]
    }
  | { type: 'hr' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const splitRow = (line: string): string[] => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) blocks.push({ type: 'para', c: parseInline(para.join('\n')) })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const mark = fence[1]!
      const body: string[] = []
      let open = true
      for (i++; i < lines.length; i++) {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]!)
        if (close && close[1]![0] === mark[0] && close[1]!.length >= mark.length) {
          open = false
          break
        }
        body.push(lines[i]!)
      }
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n'), open })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      flush()
      blocks.push({ type: 'heading', level: h[1]!.length, c: parseInline(h[2]!) })
      continue
    }
    if (HR.test(line) && !para.length) {
      blocks.push({ type: 'hr' })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      flush()
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]!).map((c) =>
        c.startsWith(':') && c.endsWith(':')
          ? 'center'
          : c.endsWith(':')
            ? 'right'
            : c.startsWith(':')
              ? 'left'
              : null
      )
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++)
        rows.push(splitRow(lines[i]!).map(parseInline))
      i--
      blocks.push({ type: 'table', head: head.map(parseInline), rows, align })
      continue
    }
    if (QUOTE.test(line)) {
      flush()
      const body: string[] = []
      for (; i < lines.length && QUOTE.test(lines[i]!); i++) body.push(QUOTE.exec(lines[i]!)![1]!)
      i--
      blocks.push({ type: 'quote', blocks: parseMarkdown(body.join('\n')) })
      continue
    }
    const li = LIST.exec(line)
    if (li && (!para.length || li[1] === '')) {
      flush()
      const ordered = /\d/.test(li[2]!)
      const items: ListItem[] = []
      const base = li[1]!.length
      for (; i < lines.length; i++) {
        const m = LIST.exec(lines[i]!)
        if (m) {
          const task = TASK.exec(m[3]!)
          items.push({
            depth: Math.max(0, Math.floor((m[1]!.length - base) / 2)),
            task: task ? task[1] !== ' ' : null,
            c: parseInline(task ? task[2]! : m[3]!)
          })
        } else if (lines[i]!.trim() && /^\s+/.test(lines[i]!) && items.length) {
          // A wrapped line of the item above.
          const last = items[items.length - 1]!
          last.c = [...last.c, { t: 'text', v: ' ' }, ...parseInline(lines[i]!.trim())]
        } else break
      }
      i--
      blocks.push({ type: 'list', ordered, start: ordered ? parseInt(li[2]!, 10) : 1, items })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

const SAFE_URL = /^(https?:|mailto:)/i

/** Inline spans; anything unmatched stays plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const pushText = (): void => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    const rest = src.slice(i)
    if (ch === '\\' && i + 1 < src.length && /[\\`*_~[\]()#|>-]/.test(src[i + 1]!)) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const ticks = /^`+/.exec(rest)![0]
      const end = src.indexOf(ticks, i + ticks.length)
      if (end > 0) {
        pushText()
        out.push({ t: 'code', v: src.slice(i + ticks.length, end).replace(/^ (.+) $/, '$1') })
        i = end + ticks.length
        continue
      }
    }
    const emph =
      /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest) ??
      /^(~~)(?=\S)([\s\S]*?\S)\1/.exec(rest) ??
      /^(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1(?![*_\w])/.exec(rest)
    if (emph && (ch !== '_' || i === 0 || !/\w/.test(src[i - 1]!))) {
      pushText()
      const kind = emph[1]!.length === 2 ? (emph[1] === '~~' ? 's' : 'b') : 'i'
      out.push({ t: kind, c: parseInline(emph[2]!) })
      i += emph[0].length
      continue
    }
    if (ch === '[') {
      const link = /^\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest)
      if (link && SAFE_URL.test(link[2]!)) {
        pushText()
        out.push({ t: 'a', href: link[2]!, c: parseInline(link[1]!) })
        i += link[0].length
        continue
      }
    }
    if (ch === 'h' && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      const url = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest)
      if (url) {
        pushText()
        out.push({ t: 'a', href: url[0], c: [{ t: 'text', v: url[0] }] })
        i += url[0].length
        continue
      }
    }
    text += ch
    i++
  }
  pushText()
  return out
}
