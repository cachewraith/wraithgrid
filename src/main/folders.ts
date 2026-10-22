// The New chat folder picker's backend: one folder's subfolders (names and kind only, never
// file contents), with `~` and relative paths resolved here, so the renderer never reads the
// filesystem. Capped per folder so a huge directory stays fast; unreadable folders say why.
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FolderListResult } from '@shared/ipc-contract'
import { contractHome } from '@shared/paths'
import { resolveUserPath } from './paths'

/** Folders listed per folder; the rest are cut (the picker says so). */
export const FOLDER_ENTRIES_MAX = 1000

/** The branch checked out in `dir` from `.git/HEAD` (no git process); null when not a repo. */
export async function gitBranchOf(dir: string): Promise<string | null> {
  try {
    let gitDir = path.join(dir, '.git')
    const st = await fs.stat(gitDir)
    if (st.isFile()) {
      // A worktree: `.git` is a file pointing at the real git dir.
      const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(gitDir, 'utf8'))
      if (!m) return null
      gitDir = path.resolve(dir, m[1]!.trim())
    }
    const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim()
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return ref ? ref[1]! : head.slice(0, 7)
  } catch {
    return null
  }
}

function why(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'This folder does not exist.'
  if (code === 'ENOTDIR') return 'That is a file, not a folder.'
  if (code === 'EACCES' || code === 'EPERM') return 'You don’t have permission to open this folder.'
  return 'This folder can’t be read.'
}

/** Lists `input`'s subfolders, sorted by name; hidden ones (`.x`) are marked, not dropped. */
export async function listFolder(input: string, homeDir: string): Promise<FolderListResult> {
  const raw = input.trim() || '~'
  // Relative paths are taken from home, like a new terminal.
  const abs =
    raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\') || path.isAbsolute(raw)
      ? resolveUserPath(raw, homeDir)
      : path.resolve(homeDir, raw)
  const display = contractHome(abs, homeDir)
  const parentDir = path.dirname(abs)
  const parent = parentDir === abs ? null : contractHome(parentDir, homeDir)
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true })
  } catch (err) {
    return { ok: false, path: display, parent, error: why(err) }
  }
  const dirs: string[] = []
  for (const d of dirents) {
    if (d.isDirectory()) dirs.push(d.name)
    else if (d.isSymbolicLink()) {
      // A link to a folder counts as one.
      const isDir = await fs
        .stat(path.join(abs, d.name))
        .then((s) => s.isDirectory())
        .catch(() => false)
      if (isDir) dirs.push(d.name)
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  const shown = dirs.slice(0, FOLDER_ENTRIES_MAX)
  const entries = await Promise.all(
    shown.map(async (name) => ({
      name,
      hidden: name.startsWith('.'),
      git: await fs
        .stat(path.join(abs, name, '.git'))
        .then(() => true)
        .catch(() => false)
    }))
  )
  return {
    ok: true,
    path: display,
    parent,
    entries,
    truncated: dirs.length > shown.length,
    branch: await gitBranchOf(abs)
  }
}
