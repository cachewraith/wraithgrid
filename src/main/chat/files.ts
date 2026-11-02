// The `@` file menu in a chat (#159): the files and folders under the pane's own folder, as
// paths relative to it. git's own list when the folder is a repo (so .gitignore holds), a
// bounded walk otherwise; ranked here so the renderer gets a few paths, never the whole tree.
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { GitRunner } from '../git'

/** Paths sent to the menu per query. */
export const FILE_MENTIONS_MAX = 50
/** Entries a walk (no git) looks at, and how long it may take. */
export const WALK_ENTRIES_MAX = 20_000
export const WALK_MS = 1500
/** How long one folder's list is reused while typing. */
export const FILE_LIST_TTL_MS = 10_000

const SKIP = new Set(['.git', 'node_modules'])

const skipped = (rel: string): boolean => rel.split('/').some((part) => SKIP.has(part))

/** Each file's folders (`src/`, `src/main/`) once, then the files; `/` separators. */
export function withFolders(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const f of files) {
    let i = f.indexOf('/')
    while (i !== -1) {
      dirs.add(f.slice(0, i + 1))
      i = f.indexOf('/', i + 1)
    }
  }
  return [...dirs, ...files]
}

/** git's tracked and untracked-but-not-ignored files; null when `root` is not a repo. */
async function gitFiles(git: GitRunner, root: string): Promise<string[] | null> {
  let out: string
  try {
    out = await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root)
  } catch (err) {
    // Past the runner's buffer: what came first is still a list (cut at the last whole entry).
    const part = (err as { stdout?: unknown }).stdout
    if (typeof part !== 'string' || !/maxBuffer/i.test(String((err as Error).message))) return null
    out = part.slice(0, part.lastIndexOf('\0') + 1)
  }
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) => !skipped(f))
}

/** Breadth first, so a cut keeps the shallow paths; folders end with `/`. */
async function walk(root: string, now: () => number): Promise<string[]> {
  const out: string[] = []
  const until = now() + WALK_MS
  const queue = ['']
  let seen = 0
  while (queue.length && seen < WALK_ENTRIES_MAX && now() < until) {
    const rel = queue.shift()!
    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirents) {
      if (++seen > WALK_ENTRIES_MAX) break
      if (SKIP.has(d.name)) continue
      const p = rel + d.name
      if (d.isDirectory()) {
        out.push(p + '/')
        queue.push(p + '/')
      } else if (d.isFile() || d.isSymbolicLink()) out.push(p)
    }
  }
  return out
}

/** Every path the menu can offer for `root`: folders (`src/`) and files. */
export async function listProjectPaths(
  root: string,
  git: GitRunner,
  now: () => number = Date.now
): Promise<string[]> {
  const files = await gitFiles(git, root)
  return files ? withFolders(files) : walk(root, now)
}

/** `listProjectPaths` with each folder's list kept for a few seconds (one per keystroke otherwise). */
export function makeFileLister(
  git: GitRunner,
  now: () => number = Date.now
): (root: string) => Promise<string[]> {
  const cache = new Map<string, { at: number; paths: Promise<string[]> }>()
  return (root) => {
    const hit = cache.get(root)
    if (hit && now() - hit.at < FILE_LIST_TTL_MS) return hit.paths
    const paths = listProjectPaths(root, git, now).catch(() => [])
    cache.set(root, { at: now(), paths })
    return paths
  }
}

const baseOf = (p: string): string => {
  const s = p.endsWith('/') ? p.slice(0, -1) : p
  return s.slice(s.lastIndexOf('/') + 1)
}

function subsequence(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) if (ch === q[i]) i++
  return i === q.length
}

function score(p: string, q: string): number {
  const full = p.toLowerCase()
  const base = baseOf(full)
  // The name before its extension(s): `app` of `app.ts` and `app.test.ts`.
  const stem = base.indexOf('.') > 0 ? base.slice(0, base.indexOf('.')) : base
  if (base === q || full === q) return 100
  if (stem === q) return 90
  if (base.startsWith(q)) return 80
  if (full.startsWith(q)) return 70
  if (base.includes(q)) return 60
  if (full.includes(q)) return 40
  if (subsequence(q, full)) return 20
  return 0
}

const depth = (p: string): number => p.split('/').filter(Boolean).length

/**
 * The paths matching `query`, best first: the file name before the rest of the path, then
 * shallower and shorter paths. A bare `@` lists the top level. `query` uses `/` like the paths.
 */
export function rankPaths(paths: string[], query: string, limit = FILE_MENTIONS_MAX): string[] {
  const q = query.toLowerCase()
  if (!q)
    return paths
      .filter((p) => depth(p) === 1)
      .sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b))
      .slice(0, limit)
  // Inside a folder (`src/`): that folder's own entries, the way a file browser opens it.
  if (q.endsWith('/'))
    return paths
      .filter((p) => p.toLowerCase().startsWith(q) && depth(p) === depth(q) + 1)
      .sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b))
      .slice(0, limit)
  return paths
    .map((p) => ({ p, s: score(p, q) }))
    .filter((x) => x.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s || depth(a.p) - depth(b.p) || a.p.length - b.p.length || a.p.localeCompare(b.p)
    )
    .slice(0, limit)
    .map((x) => x.p)
}
