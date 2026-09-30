// Tells the user about a new release through the OS notification area, once per version.
// The last announced version lives in a small file in userData, apart from config.json,
// which the renderer owns and rewrites whole.
import fs from 'node:fs/promises'
import type { UpdateCheckResult } from '@shared/ipc-contract'
import { RELEASES_REPO } from './update-check'

export interface UpdateNotice {
  title: string
  body: string
  /** The release page, opened when no window is left to show; only RELEASES_REPO pages. */
  url: string
}

export interface NotifyDeps {
  stateFile: string
  show(notice: UpdateNotice): void
}

const RELEASE_PAGE_PREFIX = `https://github.com/${RELEASES_REPO}/releases/`

async function lastNotified(stateFile: string): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    const v = (raw as { lastNotified?: unknown } | null)?.lastNotified
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Shows a notice when `result` is a newer release not announced before. True if shown. */
export async function notifyIfNew(result: UpdateCheckResult, deps: NotifyDeps): Promise<boolean> {
  if (result.status !== 'available') return false
  const { version, url } = result.latest
  if (!url.startsWith(RELEASE_PAGE_PREFIX)) return false
  if ((await lastNotified(deps.stateFile)) === version) return false
  deps.show({
    title: `Wraithgrid ${version} is available`,
    body: `You have ${result.current}. Click to update from Settings.`,
    url
  })
  try {
    await fs.writeFile(deps.stateFile, JSON.stringify({ lastNotified: version }) + '\n', {
      mode: 0o600
    })
  } catch {
    // Worst case the same release is announced again next launch.
  }
  return true
}
