// How the folder picker shows and walks paths (`~/code/api`, `/etc`, `C:\work`): breadcrumb
// segments, the folder's name apart from where it is, and whether typed text is a path to
// jump to or a filter. Pure: main does the real resolving and reading.

/** Typed text that is a path (jump there) rather than a filter. */
export function looksLikePath(text: string): boolean {
  const t = text.trim()
  return t === '~' || /^~[\\/]/.test(t) || t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)
}

const sepOf = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : '/')

/** `dir` + `name`, with the separator `dir` already uses. */
export function joinPath(dir: string, name: string): string {
  const sep = sepOf(dir)
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** Breadcrumb parts, each with the path up to it: `~/a/b` → `~`, `~/a`, `~/a/b`. */
export function crumbs(p: string): { label: string; path: string }[] {
  const sep = sepOf(p)
  const out: { label: string; path: string }[] = []
  let rest = p
  let acc = ''
  if (p.startsWith('/')) {
    out.push({ label: '/', path: '/' })
    acc = '/'
    rest = p.slice(1)
  } else if (/^[A-Za-z]:[\\/]?/.test(p)) {
    const root = `${p.slice(0, 2)}${sep}`
    out.push({ label: p.slice(0, 2), path: root })
    acc = root
    rest = p.slice(3)
  }
  for (const part of rest.split(/[\\/]+/).filter(Boolean)) {
    acc = acc === '' ? part : acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`
    out.push({ label: part, path: acc })
  }
  return out
}

/** The folder's name and where it is: `~/code/api` → `api` in `~/code`. */
export function splitFolder(p: string): { name: string; parent: string } {
  const c = crumbs(p)
  const last = c[c.length - 1]
  if (!last) return { name: p, parent: '' }
  return { name: last.label, parent: c.length > 1 ? c[c.length - 2]!.path : '' }
}

/** Long paths cut in the middle, so both ends stay readable. */
export function middleTruncate(p: string, max: number): string {
  if (p.length <= max) return p
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  return `${p.slice(0, head)}…${p.slice(p.length - (keep - head))}`
}
