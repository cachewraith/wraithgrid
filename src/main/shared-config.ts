// One CLAUDE.md and one skills folder for every account. The source account keeps the
// real files; every other account's config dir gets links to them. Nothing inside a
// config dir is ever read: only link metadata is inspected, and anything in the way is
// renamed to a backup, never deleted.
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SHARED_ITEMS = [
  { name: 'CLAUDE.md', kind: 'file' },
  { name: 'skills', kind: 'dir' }
] as const

export type LinkOutcome = 'linked' | 'already-linked' | 'unlinked' | 'restored' | 'failed'

export interface ItemResult {
  item: string
  outcome: LinkOutcome
  /** Where an existing file or folder was moved to make room for the link. */
  backup?: string
  error?: string
}

export const BACKUP_SUFFIX = '.wraithgrid-backup'

async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await fs.lstat(p)
  } catch {
    return null
  }
}

/** True when `dst` already points at `src` (symlink or junction, or a Windows hard link). */
async function isLinkTo(dst: string, src: string): Promise<boolean> {
  const st = await lstatOrNull(dst)
  if (!st) return false
  if (st.isSymbolicLink()) {
    try {
      const target = await fs.readlink(dst)
      return path.resolve(path.dirname(dst), target) === path.resolve(src)
    } catch {
      return false
    }
  }
  // A hard link (Windows fallback) shares the source's inode.
  if (st.isFile()) {
    const s = await lstatOrNull(src)
    return !!s && s.isFile() && s.ino === st.ino && s.dev === st.dev && st.nlink > 1
  }
  return false
}

/** A free backup name next to `p`: `name.wraithgrid-backup`, then with a timestamp. */
async function backupPathFor(p: string, now: Date): Promise<string> {
  const plain = p + BACKUP_SUFFIX
  if (!(await lstatOrNull(plain))) return plain
  return `${plain}-${now.toISOString().replace(/[:.]/g, '-')}`
}

/** Makes sure the source has something to link to (an empty CLAUDE.md, an empty skills/). */
export async function ensureSource(sourceDir: string): Promise<void> {
  await fs.mkdir(path.join(sourceDir, 'skills'), { recursive: true, mode: 0o700 })
  try {
    // 'wx' creates the file only if it does not exist; an existing CLAUDE.md is untouched.
    const handle = await fs.open(path.join(sourceDir, 'CLAUDE.md'), 'wx', 0o600)
    await handle.close()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
}

async function createLink(
  src: string,
  dst: string,
  kind: 'file' | 'dir',
  platform: NodeJS.Platform
) {
  if (platform !== 'win32') return fs.symlink(src, dst)
  // Junctions need no privileges; file symlinks need Developer Mode, else a hard link.
  if (kind === 'dir') return fs.symlink(src, dst, 'junction')
  try {
    await fs.symlink(src, dst, 'file')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err
    await fs.link(src, dst)
  }
}

/** Links the shared items from `sourceDir` into `targetDir`. Idempotent. */
export async function linkShared(
  sourceDir: string,
  targetDir: string,
  opts: { platform?: NodeJS.Platform; now?: () => Date } = {}
): Promise<ItemResult[]> {
  const platform = opts.platform ?? process.platform
  const now = opts.now ?? (() => new Date())
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return []
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })

  const results: ItemResult[] = []
  for (const { name, kind } of SHARED_ITEMS) {
    const src = path.join(sourceDir, name)
    const dst = path.join(targetDir, name)
    try {
      if (await isLinkTo(dst, src)) {
        results.push({ item: name, outcome: 'already-linked' })
        continue
      }
      let backup: string | undefined
      if (await lstatOrNull(dst)) {
        backup = await backupPathFor(dst, now())
        await fs.rename(dst, backup)
      }
      await createLink(src, dst, kind, platform)
      results.push({ item: name, outcome: 'linked', ...(backup ? { backup } : {}) })
    } catch (err) {
      results.push({ item: name, outcome: 'failed', error: (err as Error).message })
    }
  }
  return results
}

/** Removes links that point at `sourceDir` and puts back what linkShared moved aside. */
export async function unlinkShared(sourceDir: string, targetDir: string): Promise<ItemResult[]> {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return []
  const results: ItemResult[] = []
  for (const { name } of SHARED_ITEMS) {
    const src = path.join(sourceDir, name)
    const dst = path.join(targetDir, name)
    try {
      if (!(await isLinkTo(dst, src))) continue
      await fs.unlink(dst)
      const backup = dst + BACKUP_SUFFIX
      if (await lstatOrNull(backup)) {
        await fs.rename(backup, dst)
        results.push({ item: name, outcome: 'restored', backup })
      } else {
        results.push({ item: name, outcome: 'unlinked' })
      }
    } catch (err) {
      results.push({ item: name, outcome: 'failed', error: (err as Error).message })
    }
  }
  return results
}
