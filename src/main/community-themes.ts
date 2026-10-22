// Community themes (#24): a list of GitHub repositories (cachewraith/wraithgrid-themes), each
// holding `manifest.json`, `wraithgrid-theme.json` and `screenshot.png`. Everything is read
// from raw.githubusercontent.com over https with size limits, and nothing is trusted: the
// repository names, the manifest and the theme (parseThemeFile) are checked, and a theme is
// data only. What was installed from where is kept in `community.lock` beside the themes.
import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { CommunityTheme, CommunityThemeList } from '@shared/ipc-contract'
import {
  BUILT_IN_THEMES,
  THEMES_FILE_MAX,
  parseThemeFile,
  themeSlug,
  type ThemeFile
} from '@shared/themes'
import { writeThemeAs } from './themes'
import type { Fetch } from './update-check'

/** Fixed on purpose: main never fetches an address that came from config or the renderer. */
export const COMMUNITY_THEMES_URL =
  'https://raw.githubusercontent.com/cachewraith/wraithgrid-themes/main/community-themes.json'
const raw = (repo: string, file: string): string =>
  `https://raw.githubusercontent.com/${repo}/HEAD/${file}`

const TIMEOUT_MS = 10_000
const MAX_LIST_BYTES = 200_000
const MAX_MANIFEST_BYTES = 20_000
const MAX_SHOT_BYTES = 1_500_000
const MAX_REPOS = 200
const PARALLEL = 6
const KEEP_MS = 5 * 60_000
const LOCK = 'community.lock'

/** `owner/repo`, GitHub's own character rules. */
export const THEME_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const TEXT = /^[^\p{Cc}<>]*$/u

const listSchema = z.object({
  themes: z.array(z.object({ repo: z.string().regex(THEME_REPO) })).max(MAX_REPOS)
})

export const manifestSchema = z.object({
  name: z.string().trim().min(1).max(40).regex(TEXT),
  author: z.string().trim().min(1).max(60).regex(TEXT),
  version: z.string().regex(VERSION),
  minAppVersion: z.string().regex(VERSION).optional(),
  description: z.string().trim().max(300).regex(TEXT).default(''),
  modes: z
    .array(z.enum(['dark', 'light']))
    .min(1)
    .max(2)
})
export type ThemeManifest = z.infer<typeof manifestSchema>

/** `1.10.0` > `1.9.3`. */
export function newerVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** `https://github.com/owner/repo` (with or without a path after it) → `owner/repo`. */
export function repoFromUrl(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/\s?#]+\/[^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/.exec(
    url.trim()
  )
  const repo = m?.[1] ?? (THEME_REPO.test(url.trim()) ? url.trim() : null)
  return repo && THEME_REPO.test(repo) ? repo : null
}

type Lock = Record<string, { repo: string; version: string }>

export interface CommunityThemesDeps {
  fetch: Fetch
  dir: string
  appVersion: string
  now?: () => number
}

export class CommunityThemes {
  private last: { at: number; list: ThemeManifestEntry[] } | null = null
  constructor(private readonly deps: CommunityThemesDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private async get(url: string, max: number): Promise<Response | null> {
    const res = await this.deps.fetch(url, {
      headers: { 'User-Agent': 'Wraithgrid' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    return len > max ? null : res
  }

  private async json(url: string, max: number): Promise<unknown> {
    const res = await this.get(url, max)
    if (!res) return null
    const text = await res.text()
    if (text.length > max) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private async lock(): Promise<Lock> {
    try {
      const d = JSON.parse(await readFile(path.join(this.deps.dir, LOCK), 'utf8')) as unknown
      const r = z
        .record(
          z.string(),
          z.object({ repo: z.string().regex(THEME_REPO), version: z.string().regex(VERSION) })
        )
        .safeParse(d)
      return r.success ? r.data : {}
    } catch {
      return {}
    }
  }

  private async saveLock(lock: Lock): Promise<void> {
    await writeFile(path.join(this.deps.dir, LOCK), `${JSON.stringify(lock, null, 2)}\n`)
  }

  /** A repository's manifest, checked; null when missing or bad. */
  async manifest(repo: string): Promise<ThemeManifest | null> {
    if (!THEME_REPO.test(repo)) return null
    const r = manifestSchema.safeParse(
      await this.json(raw(repo, 'manifest.json'), MAX_MANIFEST_BYTES).catch(() => null)
    )
    return r.success ? r.data : null
  }

  /** The gallery: every listed theme with its manifest, and what is installed. */
  async list(): Promise<CommunityThemeList> {
    if (!this.last || this.now() - this.last.at >= KEEP_MS) {
      const data = await this.json(COMMUNITY_THEMES_URL, MAX_LIST_BYTES).catch(() => null)
      const parsed = listSchema.safeParse(data)
      if (!parsed.success)
        throw new Error('Could not read the community theme list. Check your connection.')
      const repos = [...new Set(parsed.data.themes.map((t) => t.repo))]
      const found: ThemeManifestEntry[] = []
      for (let i = 0; i < repos.length; i += PARALLEL) {
        const part = await Promise.all(
          repos.slice(i, i + PARALLEL).map(async (repo) => {
            const m = await this.manifest(repo)
            return m ? { repo, manifest: m } : null
          })
        )
        for (const e of part) if (e) found.push(e)
      }
      this.last = { at: this.now(), list: found }
    }
    const lock = await this.lock()
    return { themes: this.last.list.map((e) => this.row(e, lock)) }
  }

  private row(e: ThemeManifestEntry, lock: Lock): CommunityTheme {
    const id = Object.keys(lock).find((k) => lock[k]!.repo === e.repo) ?? null
    const installed = id ? lock[id]!.version : null
    return {
      repo: e.repo,
      ...e.manifest,
      minAppVersion: e.manifest.minAppVersion ?? null,
      installedId: id,
      installedVersion: installed,
      update: !!installed && newerVersion(e.manifest.version, installed),
      tooNew:
        !!e.manifest.minAppVersion && newerVersion(e.manifest.minAppVersion, this.deps.appVersion)
    }
  }

  /** The repository's screenshot as a data URL (shown only in the gallery), or null. */
  async screenshot(repo: string): Promise<string | null> {
    if (!THEME_REPO.test(repo)) return null
    const res = await this.get(raw(repo, 'screenshot.png'), MAX_SHOT_BYTES).catch(() => null)
    if (!res) return null
    const buf = Buffer.from(await res.arrayBuffer())
    // Only a PNG, by its signature: anything else is not shown.
    const png = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    return png && buf.length <= MAX_SHOT_BYTES
      ? `data:image/png;base64,${buf.toString('base64')}`
      : null
  }

  /** Installs (or updates) the repository's theme; returns its id, or why it could not. */
  async install(repo: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    if (!THEME_REPO.test(repo)) return { ok: false, error: 'Not a GitHub repository name.' }
    const m = await this.manifest(repo)
    if (!m) return { ok: false, error: `${repo} has no valid manifest.json.` }
    if (m.minAppVersion && newerVersion(m.minAppVersion, this.deps.appVersion))
      return {
        ok: false,
        error: `${m.name} needs Wraithgrid ${m.minAppVersion} or newer (this is ${this.deps.appVersion}).`
      }
    const data = await this.json(raw(repo, 'wraithgrid-theme.json'), THEMES_FILE_MAX).catch(
      () => null
    )
    if (data === null)
      return {
        ok: false,
        error: `${repo}: wraithgrid-theme.json is missing, too large or not JSON.`
      }
    const r = parseThemeFile(data)
    if (!r.ok)
      return {
        ok: false,
        error: `${repo}: wraithgrid-theme.json — ${r.error}. Nothing was installed.`
      }
    if (!m.modes.includes(r.theme.mode))
      return {
        ok: false,
        error: `${repo}: the theme is ${r.theme.mode} but its manifest says ${m.modes.join(' / ')}.`
      }
    const theme: ThemeFile = { ...r.theme, author: r.theme.author ?? m.author }
    const lock = await this.lock()
    const id =
      Object.keys(lock).find((k) => lock[k]!.repo === repo) ?? (await this.freeId(theme.name, lock))
    await writeThemeAs(theme, this.deps.dir, id)
    lock[id] = { repo, version: m.version }
    await this.saveLock(lock)
    return { ok: true, id }
  }

  private async freeId(name: string, lock: Lock): Promise<string> {
    const builtIn = new Set(BUILT_IN_THEMES.map((t) => t.id))
    const slug = themeSlug(name).slice(0, 36)
    const taken = async (id: string): Promise<boolean> => {
      if (builtIn.has(id) || lock[id]) return true
      try {
        await readFile(path.join(this.deps.dir, `${id}.json`))
        return true
      } catch {
        return false
      }
    }
    let id = slug
    for (let i = 2; await taken(id); i++) id = `${slug}-${i}`
    return id
  }

  /** Removes an installed community theme (its file and its line in the lock). */
  async uninstall(id: string): Promise<boolean> {
    const lock = await this.lock()
    if (!lock[id] || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return false
    delete lock[id]
    await unlink(path.join(this.deps.dir, `${id}.json`)).catch(() => {})
    await this.saveLock(lock)
    return true
  }
}

interface ThemeManifestEntry {
  repo: string
  manifest: ThemeManifest
}
