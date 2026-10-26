// docs/WHATS-NEW.md split into one entry per version. The app bundles the file so the
// installed version's notes read offline, and the release workflow publishes a version's
// section as its GitHub release body (scripts/release-notes.ts), so both say the same.

export interface ReleaseNote {
  /** Without the leading `v`, e.g. "1.12.0". */
  version: string
  /** The heading after "What's new in 1.12:" / "Previously, in 1.11:". */
  title: string
  /** `YYYY-MM-DD`, or an ISO time for notes saved from GitHub; null when unknown. */
  date: string | null
  /** Markdown source; rendered as React elements, never HTML. */
  notes: string
}

/** Fixed on purpose: release links are built from this, never taken from a response. */
export const RELEASES_REPO = 'cachewraith/wraithgrid'

/** A version's release page on GitHub. */
export function releasePageUrl(version: string): string {
  return `https://github.com/${RELEASES_REPO}/releases/tag/${encodeURIComponent(`v${version.replace(/^v/, '')}`)}`
}

/** The PR list / full changelog the workflow appends; the app cuts the notes here. */
export const NOTES_FOOTER_MARKER = '<!-- wraithgrid:footer -->'

const HEADING = /^#{1,2}\s+(.+?)\s*$/
const STAMP = /^\*v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*·\s*(\d{4}-\d{2}-\d{2})\*\s*$/
const PREFIX = /^(?:what['’]s new in|previously, in)\s+[\d.]+\s*:\s*/i

/**
 * A version's section starts at a heading followed by a `*vX.Y.Z · YYYY-MM-DD*` line and
 * runs until the next such heading. `---` rules between sections are dropped.
 */
export function parseWhatsNew(md: string): ReleaseNote[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const starts: { at: number; title: string; version: string; date: string; body: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]!)
    if (!h) continue
    let j = i + 1
    while (j < lines.length && !lines[j]!.trim()) j++
    const s = STAMP.exec(lines[j] ?? '')
    if (s)
      starts.push({
        at: i,
        title: h[1]!.replace(PREFIX, ''),
        version: s[1]!,
        date: s[2]!,
        body: j + 1
      })
  }
  return starts.map((s, k) => {
    const end = starts[k + 1]?.at ?? lines.length
    const notes = lines
      .slice(s.body, end)
      .filter((l) => l.trim() !== '---')
      .join('\n')
      .trim()
    return { version: s.version, title: s.title, date: s.date, notes }
  })
}

/** Release notes from GitHub without the generated footer, size-capped. */
export function cleanReleaseBody(body: string, max: number): string {
  const text = body.replace(/\r\n/g, '\n')
  const cut = text.indexOf(NOTES_FOOTER_MARKER)
  return (cut >= 0 ? text.slice(0, cut) : text).trim().slice(0, max)
}

/** One row of a `| New | … |` or `| Fix | … |` table: the change's name and its sentence. */
export interface NoteItem {
  name: string
  /** Markdown (bold, code, links). */
  text: string
}

/** A version's notes split for About (#124): intro text, then New and Fixed as items. */
export interface NoteParts {
  /** From a leading `## …` heading (a GitHub release body has one); null otherwise. */
  title: string | null
  /** Everything that isn't a New/Fix table, as markdown (other tables stay in it). */
  intro: string
  added: NoteItem[]
  fixed: NoteItem[]
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/

/** Table cells, split on `|` that is neither escaped nor inside backticks. */
function cells(row: string): string[] {
  const out: string[] = []
  let cur = ''
  let code = false
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '`') code = !code
    if (c === '|' && !code && s[i - 1] !== '\\') {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

/**
 * Splits a version's notes into intro + New + Fixed. Tables headed "New"/"Feature" or "Fix"/"Fixed"
 * become items (first cell the name, the rest the sentence); anything else stays markdown.
 */
export function noteParts(md: string): NoteParts {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let title: string | null = null
  let first = 0
  while (first < lines.length && !lines[first]!.trim()) first++
  const h = HEADING.exec(lines[first] ?? '')
  if (h) {
    title = h[1]!.replace(PREFIX, '')
    first++
  }
  const intro: string[] = []
  const added: NoteItem[] = []
  const fixed: NoteItem[] = []
  for (let i = first; i < lines.length;) {
    const line = lines[i]!
    if (!TABLE_ROW.test(line) || !TABLE_RULE.test(lines[i + 1] ?? '')) {
      if (line.trim() !== '---' && !STAMP.test(line)) intro.push(line)
      i++
      continue
    }
    let end = i + 2
    while (end < lines.length && TABLE_ROW.test(lines[end]!)) end++
    const kind = (cells(line)[0] ?? '').toLowerCase()
    const into =
      kind === 'new' || kind === 'feature'
        ? added
        : kind === 'fix' || kind === 'fixed'
          ? fixed
          : null
    if (into)
      for (const row of lines.slice(i + 2, end)) {
        const [name = '', ...rest] = cells(row)
        if (name || rest.length) into.push({ name, text: rest.join(' | ') })
      }
    else intro.push(...lines.slice(i, end))
    i = end
  }
  return {
    title,
    intro: intro
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    added,
    fixed
  }
}
