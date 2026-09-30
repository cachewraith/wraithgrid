// Installs a newer release in place, so the user never picks a package by hand.
// electron-updater already knows every package type we ship (NSIS on Windows; pacman, deb
// and rpm through a pkexec prompt; AppImage by swapping the file), so this is a small
// facade over it: check, download with progress, then install and relaunch.
// Where files come from is fixed at build time (resources/app-update.yml → this repo's
// GitHub releases); nothing from config or the renderer picks a URL. electron-updater
// checks each download against the sha512 in the release's latest*.yml before running it.
import type { UpdateInstallResult, UpdateProgress } from '@shared/ipc-contract'
import { compareVersions, parseVersion } from './update-check'

export interface InstallerDeps {
  currentVersion: string
  /** The newest published version, or null when this build can't update itself. */
  check(): Promise<string | null>
  download(onPercent: (percent: number) => void): Promise<void>
  /** Starts the install and quits; resolves to an error message when it could not start. */
  install(): Promise<string | null>
  report(progress: UpdateProgress): void
  log(msg: string): void
}

const MANUAL = 'This copy of Wraithgrid can’t update itself. Download the new version instead.'

export class UpdateInstaller {
  private running: Promise<UpdateInstallResult> | null = null

  constructor(private readonly deps: InstallerDeps) {}

  /** One install at a time; a second click joins the one in progress. */
  install(): Promise<UpdateInstallResult> {
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<UpdateInstallResult> {
    const { deps } = this
    // Errors from electron-updater carry URLs and stack text: log them, show a short message.
    const fail = (error: string, detail?: unknown, manual = false): UpdateInstallResult => {
      if (detail !== undefined) deps.log(`update install failed: ${String(detail)}`)
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

    deps.report({ phase: 'downloading', version, percent: 0 })
    try {
      await deps.download((percent) =>
        deps.report({ phase: 'downloading', version, percent: Math.round(percent) })
      )
    } catch (err) {
      return fail('The download failed or did not match its checksum.', (err as Error).message)
    }

    deps.report({ phase: 'installing', version })
    const error = await deps.install()
    if (error !== null) {
      return fail('The update was cancelled or could not be installed.', error)
    }
    return { ok: true }
  }
}
