// Asks GitHub Releases whether a newer Wraithgrid is out. It only reports: the user
// downloads the new build themselves, which works the same for every package type
// (AppImage, deb, rpm, pacman, the Windows installer).
import { z } from 'zod'
import type { ReleaseInfo, UpdateCheckResult } from '@shared/ipc-contract'

/** Fixed on purpose: the checker never fetches a URL that came from config or the renderer. */
export const RELEASES_REPO = 'cachewraith/wraithgrid'
const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
const TIMEOUT_MS = 10_000
/** Unauthenticated GitHub API calls are limited to 60 an hour; repeated clicks reuse the answer. */
const MIN_INTERVAL_MS = 30_000
const MAX_BODY_BYTES = 1_000_000
const MAX_NOTES = 4000

// ---- Versions ----------------------------------------------------------------------

export interface Version {
  major: number
  minor: number
  patch: number
  pre: string[]
}

const VERSION_RE =
  /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/

export function parseVersion(s: string): Version | null {
  const m = VERSION_RE.exec(s.trim())
  if (!m) return null
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? m[4].split('.') : [] }
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (core) return core
  // A release outranks its own prereleases (1.2.0 > 1.2.0-beta.1).
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) - Number(y)
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

// ---- GitHub response ---------------------------------------------------------------

const releaseSchema = z.object({
  tag_name: z.string().max(128),
  body: z.string().nullish(),
  published_at: z.string().max(64).nullish(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional()
})

/** Validates GitHub's answer. The release page URL is rebuilt from the tag, not trusted. */
export function parseRelease(raw: unknown): ReleaseInfo | null {
  const r = releaseSchema.safeParse(raw)
  if (!r.success || r.data.draft) return null
  const tag = r.data.tag_name
  const v = parseVersion(tag)
  if (!v) return null
  return {
    version: tag.replace(/^v/, ''),
    url: `https://github.com/${RELEASES_REPO}/releases/tag/${encodeURIComponent(tag)}`,
    notes: (r.data.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTES),
    publishedAt: r.data.published_at ?? null
  }
}

// ---- Checker -----------------------------------------------------------------------

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface UpdateCheckerOptions {
  currentVersion: string
  fetch: Fetch
  now?: () => number
}

type Checked = Exclude<UpdateCheckResult, { status: 'skipped' }>

export class UpdateChecker {
  private last: Checked | null = null
  private inflight: Promise<Checked> | null = null
  private readonly now: () => number

  constructor(private readonly opts: UpdateCheckerOptions) {
    this.now = opts.now ?? (() => Date.now())
  }

  /** One request at a time, and at most one every MIN_INTERVAL_MS. */
  check(): Promise<Checked> {
    if (this.inflight) return this.inflight
    if (this.last && this.now() - this.last.checkedAt < MIN_INTERVAL_MS) {
      return Promise.resolve(this.last)
    }
    this.inflight = this.request().then((r) => {
      this.last = r
      this.inflight = null
      return r
    })
    return this.inflight
  }

  private async request(): Promise<Checked> {
    const current = this.opts.currentVersion
    const checkedAt = this.now()
    const error = (msg: string): Checked => ({ status: 'error', current, error: msg, checkedAt })

    let res: Response
    try {
      res = await this.opts.fetch(LATEST_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `Wraithgrid/${current}`
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      const e = err as Error
      return error(
        e.name === 'TimeoutError'
          ? 'GitHub did not answer in time.'
          : 'Could not reach GitHub. Check your connection.'
      )
    }

    if (res.status === 404) return error('No release has been published yet.')
    if (res.status === 403 || res.status === 429) {
      return error('GitHub is rate-limiting update checks. Try again in a while.')
    }
    if (!res.ok) return error(`GitHub answered with status ${res.status}.`)

    let raw: unknown
    try {
      const text = await res.text()
      if (text.length > MAX_BODY_BYTES) return error('GitHub sent an unexpected answer.')
      raw = JSON.parse(text)
    } catch {
      return error('GitHub sent an unexpected answer.')
    }

    const latest = parseRelease(raw)
    const mine = parseVersion(current)
    if (!latest || !mine) return error('GitHub sent an unexpected answer.')
    const newer = compareVersions(parseVersion(latest.version)!, mine) > 0
    return { status: newer ? 'available' : 'current', current, latest, checkedAt }
  }
}
