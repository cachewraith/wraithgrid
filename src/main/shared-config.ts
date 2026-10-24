// "Overall" sharing: one brain per provider. Every claude account shares one CLAUDE.md,
// skills, plugins…; every codex account one AGENTS.md and skills; and so on. The real files
// live in ~/.wraithgrid/shared/<cli>; each account's config dir gets links to them. Logins
// and history stay per account. Nothing inside a config dir is ever read: only link
// metadata is inspected, and a real file in the way is renamed to a backup, never deleted.
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentCli } from '@shared/agent-clis'

export interface SharedItem {
  name: string
  kind: 'file' | 'dir'
  /** What a missing file starts as. */
  initial?: string
}

export const SHARED_ITEMS: readonly SharedItem[] = [
  { name: 'CLAUDE.md', kind: 'file', initial: '' },
  { name: 'settings.json', kind: 'file', initial: '{}\n' },
  { name: 'skills', kind: 'dir' },
  { name: 'plugins', kind: 'dir' },
  { name: 'agents', kind: 'dir' },
  { name: 'commands', kind: 'dir' }
]

export interface ShareSpec {
  /** The CLI's own home (under the user's home dir): seeds the shared copy once. */
  home: string
  /** Where in an account's config dir the CLI reads these ('' = the dir itself). */
  sub: string
  items: readonly SharedItem[]
}

/**
 * What each CLI shares across its accounts. claude and codex are checked against the real
 * CLIs (codex 0.164 reads $CODEX_HOME/AGENTS.md, skills and prompts); gemini and copilot
 * follow their docs (GEMINI_CLI_HOME/.gemini, COPILOT_HOME). CLIs without a per-account
 * config dir (agy, opencode) already share one home; cursor has no documented global file.
 */
export const SHARE_SPECS: Partial<Record<AgentCli, ShareSpec>> = {
  claude: { home: '.claude', sub: '', items: SHARED_ITEMS },
  codex: {
    home: '.codex',
    sub: '',
    items: [
      { name: 'AGENTS.md', kind: 'file', initial: '' },
      { name: 'skills', kind: 'dir' },
      { name: 'prompts', kind: 'dir' }
    ]
  },
  gemini: {
    home: '.gemini',
    sub: '.gemini',
    items: [
      { name: 'GEMINI.md', kind: 'file', initial: '' },
      { name: 'commands', kind: 'dir' },
      { name: 'skills', kind: 'dir' }
    ]
  },
  copilot: {
    home: '.copilot',
    sub: '',
    items: [
      { name: 'copilot-instructions.md', kind: 'file', initial: '' },
      { name: 'agents', kind: 'dir' },
      { name: 'skills', kind: 'dir' }
    ]
  }
}

/** Where a CLI's shared brain lives: ~/.wraithgrid/shared/<cli>. */
export function sharedDir(homeDir: string, cli: AgentCli): string {
  return path.join(homeDir, '.wraithgrid', 'shared', cli)
}

/** The CLI's own home; claude accounts used to link straight to ~/.claude. */
export function legacySourceDir(homeDir: string, spec: ShareSpec): string {
  return path.join(homeDir, spec.home)
}

/**
 * Makes the shared dir for a CLI: an item it doesn't have yet is copied once from the CLI's
 * own home (links kept as links), else created empty. The CLI's home is never changed.
 */
export async function prepareShared(
  homeDir: string,
  cli: AgentCli,
  spec: ShareSpec
): Promise<string> {
  const dir = sharedDir(homeDir, cli)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const from = legacySourceDir(homeDir, spec)
  for (const item of spec.items) {
    const dst = path.join(dir, item.name)
    if (await lstatOrNull(dst)) continue
    const src = path.join(from, item.name)
    const st = await statOrNull(src)
    if (!st || st.isDirectory() !== (item.kind === 'dir')) continue
    await fs.cp(src, dst, { recursive: true, verbatimSymlinks: true, errorOnExist: false })
  }
  await ensureSource(dir, spec.items)
  return dir
}

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

async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await fs.stat(p)
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

/** Makes sure the source has something to link to for every item. Never overwrites. */
export async function ensureSource(
  sourceDir: string,
  items: readonly SharedItem[] = SHARED_ITEMS
): Promise<void> {
  await fs.mkdir(sourceDir, { recursive: true, mode: 0o700 })
  for (const item of items) {
    const p = path.join(sourceDir, item.name)
    if (item.kind === 'dir') {
      await fs.mkdir(p, { recursive: true, mode: 0o700 })
      continue
    }
    try {
      // 'wx' creates the file only if it does not exist; an existing file is untouched.
      await fs.writeFile(p, item.initial ?? '', { flag: 'wx', mode: 0o600 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
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
  opts: { platform?: NodeJS.Platform; now?: () => Date; items?: readonly SharedItem[] } = {}
): Promise<ItemResult[]> {
  const platform = opts.platform ?? process.platform
  const now = opts.now ?? (() => new Date())
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return []
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })

  const results: ItemResult[] = []
  for (const { name, kind } of opts.items ?? SHARED_ITEMS) {
    const src = path.join(sourceDir, name)
    const dst = path.join(targetDir, name)
    try {
      if (await isLinkTo(dst, src)) {
        results.push({ item: name, outcome: 'already-linked' })
        continue
      }
      let backup: string | undefined
      const existing = await lstatOrNull(dst)
      if (existing?.isSymbolicLink()) {
        // A link to somewhere else (e.g. an older source) holds no data of its own.
        await fs.unlink(dst)
      } else if (existing) {
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
export async function unlinkShared(
  sourceDir: string,
  targetDir: string,
  items: readonly SharedItem[] = SHARED_ITEMS
): Promise<ItemResult[]> {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return []
  const results: ItemResult[] = []
  for (const { name } of items) {
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
