// Installs a newer release in place, so the user never picks a package by hand.
// electron-updater already knows every package type we ship (NSIS on Windows; pacman, deb
// and rpm through a pkexec prompt; AppImage by swapping the file), so this is a small
// facade over it: check, download with progress (cancellable), then wait until the user
// picks Restart now, install and relaunch.
// Where files come from is fixed at build time (resources/app-update.yml → this repo's
// GitHub releases); nothing from config or the renderer picks a URL. electron-updater
// checks each download against the sha512 in the release's latest*.yml before running it.
import type { UpdateInstallResult, UpdateProgress } from '@shared/ipc-contract'
import { compareVersions, parseVersion } from './update-check'

export interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

export interface InstallerDeps {
  currentVersion: string
  /** The newest published version, or null when this build can't update itself. */
  check(): Promise<string | null>
  download(onProgress: (p: DownloadProgress) => void): Promise<void>
  /** Stops the download in progress; its promise then rejects. */
  cancel(): void
  /** Starts the install and quits; resolves to an error message when it could not start. */
  install(): Promise<string | null>
  report(progress: UpdateProgress): void
  log(msg: string): void
}

const MANUAL = 'This copy of Wraithgrid can’t update itself. Download the new version instead.'

export class UpdateInstaller {
  private running: Promise<UpdateInstallResult> | null = null
  private downloading = false
  private cancelled = false
  /** The downloaded version, waiting for Restart now. */
  private ready: string | null = null

  constructor(private readonly deps: InstallerDeps) {}

  /** One download at a time; a second click joins the one in progress. */
  download(): Promise<UpdateInstallResult> {
    if (this.ready) {
      this.deps.report({ phase: 'ready', version: this.ready })
      return Promise.resolve({ ok: true })
    }
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  cancel(): void {
    if (!this.downloading) return
    this.cancelled = true
    this.deps.cancel()
  }

  /** Installs the downloaded update; the app quits and relaunches when it works. */
  async restart(): Promise<UpdateInstallResult> {
    const version = this.ready
    if (!version) return { ok: false, error: 'No update has been downloaded yet.', manual: false }
    this.deps.report({ phase: 'installing', version })
    const error = await this.deps.install()
    if (error !== null) {
      this.deps.log(`update install failed: ${error}`)
      this.deps.report({ phase: 'ready', version })
      return {
        ok: false,
        error: 'The update was cancelled or could not be installed.',
        manual: false
      }
    }
    return { ok: true }
  }

  private async run(): Promise<UpdateInstallResult> {
    const { deps } = this
    // Errors from electron-updater carry URLs and stack text: log them, show a short message.
    const fail = (error: string, detail?: unknown, manual = false): UpdateInstallResult => {
      if (detail !== undefined) deps.log(`update download failed: ${String(detail)}`)
      deps.report({ phase: 'idle' })
      return { ok: false, error, manual }
    }

    deps.report({ phase: 'checking' })
    let version: string | null
    try {
      version = await deps.check()
    } catch (err) {
      return fail('Could not reach GitHub to fetch the update.', (err as Error).message)
    }
    if (version === null) return fail(MANUAL, undefined, true)

    const found = parseVersion(version)
    const mine = parseVersion(deps.currentVersion)
    if (!found || !mine) return fail('GitHub sent an unexpected answer.', `version ${version}`)
    if (compareVersions(found, mine) <= 0) return fail('You already have the latest version.')

    deps.report({ phase: 'downloading', version, percent: 0, transferred: null, total: null })
    this.downloading = true
    this.cancelled = false
    try {
      await deps.download((p) =>
        deps.report({
          phase: 'downloading',
          version,
          percent: Math.round(p.percent),
          transferred: p.transferred,
          total: p.total
        })
      )
    } catch (err) {
      if (this.cancelled) {
        deps.report({ phase: 'idle' })
        return { ok: false, cancelled: true }
      }
      return fail('The download failed or did not match its checksum.', (err as Error).message)
    } finally {
      this.downloading = false
    }

    this.ready = version
    deps.report({ phase: 'ready', version })
    return { ok: true }
  }
}
