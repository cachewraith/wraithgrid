// Release notes that outlive the update: the notes of every release a check found are kept
// in userData/release-notes.json (small and capped), next to the notes bundled with this
// build, so About can show "What's new" after the update restarts the app, offline too.
// The same file remembers the version that ran last, to say "Updated to …" once.
import fs from 'node:fs/promises'
import type { ReleaseInfo, ReleaseNotesView } from '@shared/ipc-contract'
import type { ReleaseNote } from '@shared/whats-new'
import { compareVersions, parseVersion } from './update-check'

/** Versions kept besides the installed one, and characters per entry. */
export const MAX_EARLIER = 10
export const MAX_NOTE_CHARS = 8000

export interface ReleaseNotesDeps {
  file: string
  currentVersion: string
  /** Parsed from the WHATS-NEW.md bundled with this build. */
  bundled: ReleaseNote[]
}

interface Saved {
  lastRun: string | null
  saved: ReleaseNote[]
}

function cmp(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  return x && y ? compareVersions(x, y) : 0
}

const isNote = (v: unknown): v is ReleaseNote => {
  const n = v as ReleaseNote | null
  return (
    typeof n === 'object' &&
    n !== null &&
    typeof n.version === 'string' &&
    parseVersion(n.version) !== null &&
    typeof n.title === 'string' &&
    typeof n.notes === 'string' &&
    (n.date === null || typeof n.date === 'string')
  )
}

/** Newest first, one per version (the first one seen wins), capped. */
function merge(lists: ReleaseNote[][], max: number): ReleaseNote[] {
  const byVersion = new Map<string, ReleaseNote>()
  for (const list of lists)
    for (const n of list) if (!byVersion.has(n.version)) byVersion.set(n.version, n)
  return [...byVersion.values()].sort((a, b) => cmp(b.version, a.version)).slice(0, max)
}

export class ReleaseNotesStore {
  private data: Saved = { lastRun: null, saved: [] }
  private updatedFrom: string | null = null

  constructor(private readonly deps: ReleaseNotesDeps) {}

  /** Reads the file and records this run; an older last run means the app was updated. */
  async start(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.deps.file, 'utf8')) as Partial<Saved> | null
      this.data = {
        lastRun: typeof raw?.lastRun === 'string' ? raw.lastRun : null,
        saved: Array.isArray(raw?.saved) ? raw.saved.filter(isNote) : []
      }
    } catch {
      // Missing or unreadable: start over.
    }
    const last = this.data.lastRun
    this.updatedFrom = last && cmp(last, this.deps.currentVersion) < 0 ? last : null
    if (last !== this.deps.currentVersion) {
      this.data = { ...this.data, lastRun: this.deps.currentVersion }
      await this.save()
    }
  }

  /** Keeps a release's notes (from an update check) for after the update. */
  async remember(r: ReleaseInfo): Promise<void> {
    if (!parseVersion(r.version) || !r.notes.trim()) return
    const note: ReleaseNote = {
      version: r.version,
      title: '',
      date: r.publishedAt,
      notes: r.notes.slice(0, MAX_NOTE_CHARS)
    }
    const same = this.data.saved.find((n) => n.version === note.version)
    if (same && same.notes === note.notes && same.date === note.date) return
    // Keep the newest few, whatever is installed: the update may be several versions ahead.
    this.data = { ...this.data, saved: merge([[note], this.data.saved], MAX_EARLIER + 2) }
    await this.save()
  }

  /** The installed version's notes first (bundled beats saved), then earlier versions. */
  view(): ReleaseNotesView {
    const current = this.deps.currentVersion
    const all = merge([this.deps.bundled, this.data.saved], Number.MAX_SAFE_INTEGER).filter(
      (n) => cmp(n.version, current) <= 0
    )
    const installed = all.find((n) => n.version === current) ?? null
    const earlier = all.filter((n) => n !== installed).slice(0, MAX_EARLIER)
    return { current, updatedFrom: this.updatedFrom, installed, earlier }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.deps.file, JSON.stringify(this.data) + '\n', { mode: 0o600 })
    } catch {
      // Worst case the notes come from the bundle or the next check.
    }
  }
}
