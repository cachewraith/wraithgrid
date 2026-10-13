// What a pane's program asks of the terminal beyond drawing: copy text (OSC 52) and raise
// a notification (OSC 9, 777, 99). claude sends these for a mod's `$.ui.copy` and
// `$.ui.notify`; xterm.js ignores them unless handled. Pure parsers, wired up in Terminal.tsx.

export interface TermNotice {
  title: string
  body: string
}

const COPY_MAX = 1_000_000
const TITLE_MAX = 120
const BODY_MAX = 300

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]+/g
const clean = (s: string, max: number): string => s.replace(CONTROL, ' ').trim().slice(0, max)

function notice(title: string, body: string): TermNotice | null {
  const t = clean(title, TITLE_MAX)
  const b = clean(body, BODY_MAX)
  return t || b ? { title: t, body: b } : null
}

function decodeBase64(b64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * The text an OSC 52 payload (`Pc;Pd`) puts on the clipboard, or null. A `?` asks to read
 * the clipboard back and is never answered: a program in a pane must not see what was copied.
 */
export function osc52Text(data: string): string | null {
  const split = data.indexOf(';')
  if (split < 0) return null
  const payload = data.slice(split + 1)
  if (!payload || payload === '?' || payload.length > COPY_MAX * 2) return null
  const text = decodeBase64(payload)
  return text && text.length <= COPY_MAX ? text : null
}

/**
 * OSC 9 (iTerm2): the payload is the message; a first line ending in `:` is its title.
 * `9;<number>;…` is ConEmu's family (4 = progress bar), not a notification.
 */
export function osc9Notice(data: string): TermNotice | null {
  if (/^\d+;/.test(data)) return null
  const lines = data
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const head = lines[0]
  if (lines.length > 1 && head?.endsWith(':'))
    return notice(head.slice(0, -1), lines.slice(1).join(' '))
  return notice('', lines.join(' '))
}

/** OSC 777 (rxvt, Ghostty): `notify;title;body`. */
export function osc777Notice(data: string): TermNotice | null {
  const [kind, title = '', ...body] = data.split(';')
  return kind === 'notify' ? notice(title, body.join(';')) : null
}

/**
 * OSC 99 (kitty): `key=value:…;payload`, sent in parts under one id: `p=title`, `p=body`
 * (`e=1`: base64), with `d=0` on every part but the last. One reader per terminal.
 */
export class Osc99Reader {
  private readonly parts = new Map<string, { title: string; body: string }>()

  feed(data: string): TermNotice | null {
    const split = data.indexOf(';')
    if (split < 0) return null
    const meta = new Map(
      data
        .slice(0, split)
        .split(':')
        .map((kv): [string, string] => {
          const eq = kv.indexOf('=')
          return eq < 0 ? [kv, ''] : [kv.slice(0, eq), kv.slice(eq + 1)]
        })
    )
    const raw = data.slice(split + 1)
    const payload = meta.get('e') === '1' ? (decodeBase64(raw) ?? '') : raw
    const id = meta.get('i') ?? ''
    const kind = meta.get('p') ?? 'title'
    const part = this.parts.get(id) ?? { title: '', body: '' }
    if (kind === 'title') part.title += payload
    else if (kind === 'body') part.body += payload
    else return null // close, query, icon…: nothing to show
    if (meta.get('d') === '0') {
      if (this.parts.size < 32) this.parts.set(id, part)
      return null
    }
    this.parts.delete(id)
    return notice(part.title, part.body)
  }
}
