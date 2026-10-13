// Mods are claude plugins: installed ones live in an account's config dir. Wraithgrid never
// reads a config dir itself, so the list and every enable/disable go through the account's
// own `claude plugin` command, run with that account's CLAUDE_CONFIG_DIR.
import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { CatalogMod, ModInfo } from '@shared/ipc-contract'
import { spawnCommandFor } from './platform'

/** Runs the claude binary with these arguments and resolves its stdout. */
export type ClaudeRunner = (
  args: string[],
  opts: { env: Record<string, string>; cwd: string; timeoutMs?: number }
) => Promise<string>

const TIMEOUT_MS = 20_000
/** An install fetches the mod's repository. */
export const INSTALL_TIMEOUT_MS = 180_000
const DESCRIPTION_MAX = 400
/** The scopes `claude plugin enable/disable --scope` takes; others are auto-detected. */
const SCOPE_FLAGS = new Set(['user', 'project', 'local'])
/** A plugin id is `name@marketplace`; it must never read as an option. */
const MOD_ID = /^[A-Za-z0-9_][A-Za-z0-9_.@/-]*$/

const listEntry = z.object({
  id: z.string().min(1).max(200),
  version: z.string().max(64).catch('unknown'),
  scope: z.string().min(1).max(32).catch('user'),
  enabled: z.boolean().catch(true),
  projectPath: z.string().max(4096).optional(),
  notes: z.array(z.string()).optional().catch(undefined)
})

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

const catalogEntry = z.object({
  pluginId: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  description: z.string().nullish().catch(null),
  marketplaceName: z.string().max(120).catch(''),
  version: z.string().max(64).nullish().catch(null),
  installCount: z.number().int().nonnegative().nullish().catch(null),
  source: z.unknown()
})

/** A source's page, only when it is a plain https address. */
function sourceUrl(source: unknown): string | null {
  const raw =
    typeof source === 'object' && source !== null ? (source as { url?: unknown }).url : null
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.href.replace(/\.git$/, '') : null
  } catch {
    return null
  }
}

/** Reads the `available` half of `claude plugin list --available --json`. */
export function parseModCatalog(stdout: string): CatalogMod[] {
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
        url: sourceUrl(d.source)
      }
    ]
  })
}

export async function listModCatalog(
  run: ClaudeRunner,
  env: Record<string, string>,
  cwd: string
): Promise<CatalogMod[]> {
  return parseModCatalog(await run(['plugin', 'list', '--available', '--json'], { env, cwd }))
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
