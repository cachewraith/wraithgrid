// Pure string helpers usable from any process (the renderer has no `path` module).

function trimTrailingSep(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p
}

/** `~` and `~/x` become absolute under `home`. Other paths are returned unchanged. */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return trimTrailingSep(home) + p.slice(1)
  return p
}

/** The inverse of expandHome, for display. */
export function contractHome(p: string, home: string): string {
  const h = trimTrailingSep(home)
  if (!h) return p
  if (p === h) return '~'
  if (p.startsWith(h + '/') || p.startsWith(h + '\\')) return '~' + p.slice(h.length)
  return p
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Lowercase, filesystem-safe slug. Returns '' when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 48)
}
