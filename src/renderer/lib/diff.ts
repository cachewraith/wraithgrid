// Splits `git diff` output into files and typed lines for the diff panel. Pure, so the
// panel only renders; a diff it can't make sense of still shows as plain context lines.

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export interface DiffFile {
  path: string
  /** Set when the file was renamed. */
  oldPath: string | null
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  binary: boolean
  added: number
  removed: number
  lines: DiffLine[]
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` → null. Quoted names keep their escapes. */
function stripPrefix(name: string): string | null {
  const n = name.replace(/^"|"$/g, '').replace(/\t.*$/, '')
  if (n === '/dev/null') return null
  return n.replace(/^[ab]\//, '')
}

export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (\S+|"[^"]*") (\S+|"[^"]*")$/.exec(line)
      const path = stripPrefix(m?.[2] ?? line.slice(11)) ?? ''
      cur = {
        path,
        oldPath: null,
        status: 'modified',
        binary: false,
        added: 0,
        removed: 0,
        lines: []
      }
      files.push(cur)
      inHunk = false
      continue
    }
    if (!cur) continue
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added'
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted'
      else if (line.startsWith('rename from ')) {
        cur.status = 'renamed'
        cur.oldPath = line.slice('rename from '.length)
      } else if (line.startsWith('rename to ')) cur.path = line.slice('rename to '.length)
      else if (line.startsWith('Binary files ')) cur.binary = true
      else if (line.startsWith('+++ ')) {
        const p = stripPrefix(line.slice(4))
        if (p) cur.path = p
      } else if (line.startsWith('@@')) {
        inHunk = true
        cur.lines.push({ kind: 'hunk', text: line })
      }
      continue
    }
    if (line.startsWith('@@')) cur.lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) {
      cur.added++
      cur.lines.push({ kind: 'add', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      cur.removed++
      cur.lines.push({ kind: 'del', text: line.slice(1) })
    } else if (line.startsWith('\\')) cur.lines.push({ kind: 'meta', text: line })
    else if (line !== '' || cur.lines.length) cur.lines.push({ kind: 'ctx', text: line.slice(1) })
  }
  // A trailing newline in the patch leaves one empty context line behind.
  for (const f of files) {
    const last = f.lines[f.lines.length - 1]
    if (last?.kind === 'ctx' && last.text === '') f.lines.pop()
  }
  return files
}
