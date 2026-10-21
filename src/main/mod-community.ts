// claudemod.com is a community list of mods, each with its GitHub repository. The site has
// no API: the list is read from its browse page, and what can be installed is read from each
// repository's own marketplace file; a repository that is a bare plugin (only
// `.claude-plugin/plugin.json`) is offered for download into a mod folder instead. Nothing here is trusted: every repository, marketplace
// and mod name is checked before it can reach a `claude plugin` command.
import { z } from 'zod'
import type { CatalogMod } from '@shared/ipc-contract'
import { GITHUB_REPO, MOD_ID, type Marketplace } from './mods'
import type { Fetch } from './update-check'

/** Fixed on purpose: main never fetches an address that came from config or the renderer. */
export const COMMUNITY_URL = 'https://www.claudemod.com/browse?category=mod'
const TIMEOUT_MS = 10_000
const MAX_PAGE_BYTES = 2_000_000
const MAX_MANIFEST_BYTES = 500_000
const MAX_REPOS = 60
const PARALLEL = 6
const DESCRIPTION_MAX = 400
/** A repository's marketplace can list many mods; past this many it is a plugin store. */
const MODS_PER_REPO = 20
/** Opening the list twice in a row reuses the answer. */
const KEEP_MS = 5 * 60_000

/** One entry of the site's list. */
export interface CommunityEntry {
  slug: string
  /** `owner/repo` on GitHub. */
  repo: string
  stars: number | null
}

const pageEntry = z.object({
  slug: z.string().min(1).max(120),
  githubUrl: z.string().max(300),
  githubStars: z.number().int().nonnegative().nullish().catch(null)
})

/** The mods on the browse page: the objects in its data that name a GitHub repository. */
export function parseCommunityPage(html: string): CommunityEntry[] {
  // The page carries its data as JSON inside a script string, quotes escaped.
  const text = html.replace(/\\"/g, '"')
  const seen = new Map<string, CommunityEntry>()
  for (const m of text.matchAll(/\{[^{}]{0,600}"githubUrl":"[^{}]{0,600}\}/g)) {
    let raw: unknown
    try {
      raw = JSON.parse(m[0])
    } catch {
      continue
    }
    const parsed = pageEntry.safeParse(raw)
    if (!parsed.success) continue
    const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
      parsed.data.githubUrl
    )?.[1]
    if (!repo || !GITHUB_REPO.test(repo)) continue
    const { slug, githubStars } = parsed.data
    if (!seen.has(slug)) seen.set(slug, { slug, repo, stars: githubStars ?? null })
  }
  return [...seen.values()].slice(0, MAX_REPOS)
}

/** A marketplace or mod name on its own: neither may read as an option or hold an `@`. */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

const manifest = z.object({
  name: z.string().min(1).max(120),
  plugins: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().nullish().catch(null),
        version: z.string().max(64).nullish().catch(null)
      })
    )
    .max(500)
})

/**
 * The catalog rows for a site entry, from its repository's `.claude-plugin/marketplace.json`:
 * every mod of that marketplace, the one named like the entry first. Null when the
 * repository offers nothing `claude plugin install` could take.
 */
export function communityMod(
  entry: CommunityEntry,
  manifestJson: unknown
): { mods: CatalogMod[]; marketplace: Marketplace } | null {
  const parsed = manifest.safeParse(manifestJson)
  if (!parsed.success) return null
  const { name: market, plugins } = parsed.data
  if (!NAME.test(market)) return null
  const url = `https://github.com/${entry.repo}`
  const mods = [...plugins]
    .sort((a, b) => Number(b.name === entry.slug) - Number(a.name === entry.slug))
    .filter((p) => NAME.test(p.name) && MOD_ID.test(`${p.name}@${market}`))
    .slice(0, MODS_PER_REPO)
    .map((plugin): CatalogMod => ({
      id: `${plugin.name}@${market}`,
      name: plugin.name,
      description: (plugin.description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX),
      marketplace: market,
      version: plugin.version ?? null,
      installs: null,
      stars: entry.stars,
      clone: null,
      url
    }))
  if (mods.length === 0) return null
  return { mods, marketplace: { name: market, url, add: entry.repo } }
}

const pluginManifest = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullish().catch(null),
  version: z.string().max(64).nullish().catch(null)
})

/**
 * The catalog row for a site entry whose repository is one bare plugin: downloaded into a mod
 * folder, since there is no marketplace for `claude plugin install` to take it from.
 */
export function communityPlugin(entry: CommunityEntry, pluginJson: unknown): CatalogMod | null {
  const parsed = pluginManifest.safeParse(pluginJson)
  if (!parsed.success || !NAME.test(parsed.data.name)) return null
  const { name, description, version } = parsed.data
  return {
    // Not an install id: `@folder` marks a mod that lives in a mod folder.
    id: `${name}@folder`,
    name,
    description: (description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX),
    marketplace: 'mod folder',
    version: version ?? null,
    installs: null,
    stars: entry.stars,
    clone: entry.repo,
    url: `https://github.com/${entry.repo}`
  }
}

export interface CommunityMods {
  mods: CatalogMod[]
  /** Where each mod's marketplace is added from. */
  marketplaces: Marketplace[]
}

async function fetchText(fetch: Fetch, url: string, maxBytes: number): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Wraithgrid' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) return null
  const text = await res.text()
  return text.length <= maxBytes ? text : null
}

/** Reads the site's list, then each listed repository's marketplace file. */
export class CommunityCatalog {
  private last: { at: number; value: CommunityMods } | null = null

  constructor(
    private readonly fetch: Fetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  async read(): Promise<CommunityMods> {
    if (this.last && this.now() - this.last.at < KEEP_MS) return this.last.value
    let page: string | null
    try {
      page = await fetchText(this.fetch, COMMUNITY_URL, MAX_PAGE_BYTES)
    } catch {
      page = null
    }
    if (page === null) throw new Error('Could not reach claudemod.com. Check your connection.')
    const entries = parseCommunityPage(page)
    if (entries.length === 0) throw new Error('claudemod.com listed no mods Wraithgrid can read.')
    const found: ({ mods: CatalogMod[]; marketplace: Marketplace | null } | null)[] = []
    for (let i = 0; i < entries.length; i += PARALLEL) {
      const batch = entries.slice(i, i + PARALLEL).map(async (entry) => {
        const raw = (file: string): Promise<string | null> =>
          fetchText(
            this.fetch,
            `https://raw.githubusercontent.com/${entry.repo}/HEAD/.claude-plugin/${file}`,
            MAX_MANIFEST_BYTES
          ).catch(() => null)
        try {
          const text = await raw('marketplace.json')
          if (text !== null) return communityMod(entry, JSON.parse(text))
          const plugin = await raw('plugin.json')
          const mod = plugin === null ? null : communityPlugin(entry, JSON.parse(plugin))
          return mod ? { mods: [mod], marketplace: null } : null
        } catch {
          return null
        }
      })
      found.push(...(await Promise.all(batch)))
    }
    // Several site entries can share one repository: list its mods and marketplace once.
    const mods = new Map<string, CatalogMod>()
    const marketplaces = new Map<string, Marketplace>()
    for (const f of found) {
      if (!f) continue
      for (const m of f.mods) if (!mods.has(m.id)) mods.set(m.id, m)
      if (f.marketplace && !marketplaces.has(f.marketplace.name))
        marketplaces.set(f.marketplace.name, f.marketplace)
    }
    const value = { mods: [...mods.values()], marketplaces: [...marketplaces.values()] }
    this.last = { at: this.now(), value }
    return value
  }
}
