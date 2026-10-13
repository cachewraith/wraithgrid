// Mods are claude plugins: installed ones live in an account's config dir. Wraithgrid never
// reads a config dir itself, so the list and every enable/disable go through the account's
// own `claude plugin` command, run with that account's CLAUDE_CONFIG_DIR.
import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { CatalogMod, ModInfo } from '@shared/ipc-contract'
import { marketplaceOf } from '@shared/mods'
import { spawnCommandFor } from './platform'

/** Runs the claude binary with these arguments and resolves its stdout. */
export type ClaudeRunner = (
  args: string[],
  opts: { env: Record<string, string>; cwd: string; timeoutMs?: number }
) => Promise<string>

const TIMEOUT_MS = 20_000
/** The first catalog read of an account fetches its marketplaces. */
const CATALOG_TIMEOUT_MS = 60_000
/** An install fetches the mod's repository. */
export const INSTALL_TIMEOUT_MS = 180_000
const DESCRIPTION_MAX = 400
/** The scopes `claude plugin enable/disable --scope` takes; others are auto-detected. */
const SCOPE_FLAGS = new Set(['user', 'project', 'local'])
/** A plugin id is `name@marketplace`; it must never read as an option. */
export const MOD_ID = /^[A-Za-z0-9_][A-Za-z0-9_.@/-]*$/

const listEntry = z.object({
  id: z.string().min(1).max(200),
  version: z.string().max(64).catch('unknown'),
  scope: z.string().min(1).max(32).catch('user'),
  enabled: z.boolean().catch(true),
  projectPath: z.string().max(4096).optional(),
  notes: z.array(z.string()).optional().catch(undefined)
})

/** A marketplace an account has: where its page is and what `marketplace add` takes for it. */
export interface Marketplace {
  name: string
  /** Its https page, when it has one. */
  url: string | null
  /** The source to add it to another account with: `owner/repo` or an https address. */
  add: string | null
}

export const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
const marketplaceEntry = z.object({
  name: z.string().min(1).max(120),
  source: z.string().max(32).catch(''),
  repo: z.string().max(200).optional().catch(undefined),
  url: z.string().max(500).optional().catch(undefined)
})

/** `raw` as a page to open, only when it is a plain https address. */
function httpsPage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href.replace(/\.git$/, '')
  } catch {
    return null
  }
}

/** Reads `claude plugin marketplace list --json`. */
export function parseMarketplaces(stdout: string): Marketplace[] {
  const start = stdout.indexOf('[')
  if (start < 0) throw new Error('claude printed no marketplace list')
  const raw: unknown = JSON.parse(stdout.slice(start))
  if (!Array.isArray(raw)) throw new Error('claude printed no marketplace list')
  return raw.flatMap((item): Marketplace[] => {
    const parsed = marketplaceEntry.safeParse(item)
    if (!parsed.success) return []
    const { name, source, repo, url } = parsed.data
    if (source === 'github' && repo && GITHUB_REPO.test(repo))
      return [{ name, url: `https://github.com/${repo}`, add: repo }]
    const page = httpsPage(url)
    return [{ name, url: page, add: page ? url! : null }]
  })
}

export async function listMarketplaces(
  run: ClaudeRunner,
  env: Record<string, string>,
  cwd: string
): Promise<Marketplace[]> {
  return parseMarketplaces(await run(['plugin', 'marketplace', 'list', '--json'], { env, cwd }))
}

/** The arguments that add a marketplace, or null when its source cannot be passed safely. */
export function marketplaceAddArgs(source: string): string[] | null {
  return GITHUB_REPO.test(source) || httpsPage(source)
    ? ['plugin', 'marketplace', 'add', source]
    : null
}

/** Reads `claude plugin list --json`. Entries that are not a mod are skipped, never trusted. */
export function parseModList(stdout: string): ModInfo[] {
  const start = stdout.indexOf('[')
  if (start < 0) throw new Error('claude printed no mod list')
  const raw: unknown = JSON.parse(stdout.slice(start))
  if (!Array.isArray(raw)) throw new Error('claude printed no mod list')
  return raw.flatMap((item): ModInfo[] => {
    const parsed = listEntry.safeParse(item)
    if (!parsed.success || !MOD_ID.test(parsed.data.id)) return []
    const { id, version, scope, enabled, projectPath, notes } = parsed.data
    return [
      {
        id,
        version,
        scope,
        enabled,
        projectPath: projectPath ?? null,
        url: null,
        notes: (notes ?? []).map((n) => n.slice(0, 300)).slice(0, 4)
      }
    ]
  })
}

/** The arguments that enable or disable `mod`, or null when its id cannot be passed safely. */
export function modToggleArgs(
  mod: Pick<ModInfo, 'id' | 'scope'>,
  enabled: boolean
): string[] | null {
  if (!MOD_ID.test(mod.id)) return null
  const args = ['plugin', enabled ? 'enable' : 'disable', mod.id]
  if (SCOPE_FLAGS.has(mod.scope)) args.push('--scope', mod.scope)
  return args
}

export async function listMods(
  run: ClaudeRunner,
  env: Record<string, string>,
  cwd: string
): Promise<ModInfo[]> {
  return parseModList(await run(['plugin', 'list', '--json'], { env, cwd }))
}

/** Installed mods with their marketplace's page as link: the installed list does not say more. */
export function withModLinks(mods: ModInfo[], marketplaces: Marketplace[]): ModInfo[] {
  return mods.map((m) => ({
    ...m,
    url: marketplaces.find((x) => x.name === marketplaceOf(m.id))?.url ?? null
  }))
}

const catalogEntry = z.object({
  pluginId: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  description: z.string().nullish().catch(null),
  marketplaceName: z.string().max(120).catch(''),
  version: z.string().max(64).nullish().catch(null),
  installCount: z.number().int().nonnegative().nullish().catch(null),
  source: z.unknown()
})

/** A folder inside a repository page; GitHub is the only host whose folder address is known. */
function inRepo(page: string, dir: string, rev: string): string {
  const clean = dir.replace(/^\.?\/+/, '').replace(/\/+$/, '')
  if (!clean || !page.startsWith('https://github.com/') || clean.split('/').includes('..'))
    return page
  const at = /^[A-Za-z0-9._/-]+$/.test(rev) ? rev : 'HEAD'
  return `${page}/tree/${at}/${clean.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The page of a catalog entry's source: its own repository (and folder in it), or for a mod
 * that lives inside its marketplace, that folder of the marketplace's repository.
 */
function sourceUrl(source: unknown, marketplace: string | null): string | null {
  if (typeof source === 'string') return marketplace ? inRepo(marketplace, source, 'HEAD') : null
  if (typeof source !== 'object' || source === null) return null
  const s = source as { url?: unknown; path?: unknown; ref?: unknown }
  const page = httpsPage(s.url)
  if (!page || typeof s.path !== 'string') return page
  return inRepo(page, s.path, typeof s.ref === 'string' ? s.ref : 'HEAD')
}

/** Reads the `available` half of `claude plugin list --available --json`. */
export function parseModCatalog(stdout: string, marketplaces: Marketplace[] = []): CatalogMod[] {
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error('claude printed no mod catalog')
  const raw = JSON.parse(stdout.slice(start)) as { available?: unknown }
  if (!Array.isArray(raw.available)) throw new Error('claude printed no mod catalog')
  return raw.available.flatMap((item): CatalogMod[] => {
    const parsed = catalogEntry.safeParse(item)
    if (!parsed.success || !MOD_ID.test(parsed.data.pluginId)) return []
    const d = parsed.data
    return [
      {
        id: d.pluginId,
        name: d.name,
        description: (d.description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX),
        marketplace: d.marketplaceName,
        version: d.version ?? null,
        installs: d.installCount ?? null,
        stars: null,
        url: sourceUrl(
          d.source,
          marketplaces.find((m) => m.name === d.marketplaceName)?.url ?? null
        )
      }
    ]
  })
}

export async function listModCatalog(
  run: ClaudeRunner,
  env: Record<string, string>,
  cwd: string,
  marketplaces: Marketplace[] = []
): Promise<CatalogMod[]> {
  return parseModCatalog(
    await run(['plugin', 'list', '--available', '--json'], {
      env,
      cwd,
      timeoutMs: CATALOG_TIMEOUT_MS
    }),
    marketplaces
  )
}

/** Installs for the whole account (user scope), or null when the id cannot be passed safely. */
export function modInstallArgs(id: string): string[] | null {
  return MOD_ID.test(id) ? ['plugin', 'install', id, '--scope', 'user'] : null
}

/** The line of claude's error output worth showing: its last non-empty one. */
export function lastLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines[lines.length - 1]?.slice(0, 300) ?? null
}

/** A runner for the claude binary at `file`, without a shell (cmd.exe only for claude.cmd). */
export function claudeRunner(file: string, platform = process.platform): ClaudeRunner {
  return (args, { env, cwd, timeoutMs = TIMEOUT_MS }) => {
    const cmd = spawnCommandFor(platform, file, args, process.env.ComSpec)
    if (!cmd.ok) return Promise.reject(new Error(cmd.error))
    const verbatim = typeof cmd.args === 'string'
    return new Promise((resolve, reject) => {
      execFile(
        cmd.file,
        verbatim ? [cmd.args as string] : (cmd.args as string[]),
        {
          cwd,
          env,
          timeout: timeoutMs,
          // The catalog of every marketplace mod runs to a few megabytes.
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          windowsVerbatimArguments: verbatim
        },
        (err, stdout, stderr) => {
          if (!err) return resolve(String(stdout))
          reject(new Error(lastLine(String(stderr)) ?? lastLine(String(stdout)) ?? err.message))
        }
      )
    })
  }
}
