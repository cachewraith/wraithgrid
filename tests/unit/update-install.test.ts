import { describe, expect, it, vi } from 'vitest'
import type { UpdateProgress } from '@shared/ipc-contract'
import {
  UpdateInstaller,
  type DownloadProgress,
  type InstallerDeps
} from '../../src/main/update-install'

const MB = 1_000_000

function setup(over: Partial<InstallerDeps> = {}) {
  const progress: UpdateProgress[] = []
  const logs: string[] = []
  const deps: InstallerDeps = {
    currentVersion: '1.2.0',
    check: vi.fn(async () => '1.3.0'),
    download: vi.fn(async (on: (p: DownloadProgress) => void) => {
      on({ percent: 42.4, transferred: 42 * MB, total: 100 * MB })
      on({ percent: 100, transferred: 100 * MB, total: 100 * MB })
    }),
    cancel: vi.fn(),
    install: vi.fn(async () => null),
    report: (p) => progress.push(p),
    log: (m) => logs.push(m),
    ...over
  }
  return { installer: new UpdateInstaller(deps), deps, progress, logs }
}

describe('UpdateInstaller', () => {
  it('checks, downloads with progress, then waits for Restart now', async () => {
    const { installer, deps, progress } = setup()
    expect(await installer.download()).toEqual({ ok: true })
    expect(deps.install).not.toHaveBeenCalled()
    expect(progress).toEqual([
      { phase: 'checking' },
      { phase: 'downloading', version: '1.3.0', percent: 0, transferred: null, total: null },
      {
        phase: 'downloading',
        version: '1.3.0',
        percent: 42,
        transferred: 42 * MB,
        total: 100 * MB
      },
      {
        phase: 'downloading',
        version: '1.3.0',
        percent: 100,
        transferred: 100 * MB,
        total: 100 * MB
      },
      { phase: 'ready', version: '1.3.0' }
    ])
    expect(await installer.restart()).toEqual({ ok: true })
    expect(deps.install).toHaveBeenCalledOnce()
    expect(progress.at(-1)).toEqual({ phase: 'installing', version: '1.3.0' })
  })

  it('restart does nothing before a download', async () => {
    const { installer, deps } = setup()
    expect(await installer.restart()).toMatchObject({ ok: false })
    expect(deps.install).not.toHaveBeenCalled()
  })

  it('a second download after "Later" reuses the downloaded update', async () => {
    const { installer, deps, progress } = setup()
    await installer.download()
    expect(await installer.download()).toEqual({ ok: true })
    expect(deps.download).toHaveBeenCalledOnce()
    expect(progress.at(-1)).toEqual({ phase: 'ready', version: '1.3.0' })
  })

  it('offers the release page when this build cannot update itself', async () => {
    const { installer, deps, progress } = setup({ check: async () => null })
    const r = await installer.download()
    expect(r).toMatchObject({ ok: false, manual: true })
    expect(deps.download).not.toHaveBeenCalled()
    expect(progress.at(-1)).toEqual({ phase: 'idle' })
  })

  it('never downloads the same or an older version', async () => {
    for (const v of ['1.2.0', '1.1.9', '1.2.0-beta.1']) {
      const { installer, deps } = setup({ check: async () => v })
      expect(await installer.download()).toMatchObject({ ok: false, manual: false })
      expect(deps.download).not.toHaveBeenCalled()
    }
  })

  it('does not get ready after a failed or tampered download, and logs the detail only', async () => {
    const { installer, deps, logs } = setup({
      download: async () => {
        throw new Error('sha512 checksum mismatch, expected abc https://example.test/x')
      }
    })
    const r = await installer.download()
    expect(r).toEqual({
      ok: false,
      error: 'The download failed or did not match its checksum.',
      manual: false
    })
    expect(await installer.restart()).toMatchObject({ ok: false })
    expect(deps.install).not.toHaveBeenCalled()
    expect(logs.join()).toContain('checksum mismatch')
  })

  it('cancel stops the download and goes back to idle without an error', async () => {
    let reject: (e: Error) => void = () => {}
    const { installer, deps, progress } = setup({
      download: () => new Promise((_, rej) => (reject = rej)),
      cancel: vi.fn(() => reject(new Error('cancelled')))
    })
    const p = installer.download()
    await vi.waitFor(() => expect(progress.at(-1)).toMatchObject({ phase: 'downloading' }))
    installer.cancel()
    expect(await p).toEqual({ ok: false, cancelled: true })
    expect(deps.cancel).toHaveBeenCalledOnce()
    expect(progress.at(-1)).toEqual({ phase: 'idle' })
  })

  it('cancel outside a download does nothing', () => {
    const { installer, deps } = setup()
    installer.cancel()
    expect(deps.cancel).not.toHaveBeenCalled()
  })

  it('a refused install (e.g. the password prompt) stays ready to retry', async () => {
    const { installer, progress, logs } = setup({ install: async () => 'pkexec: dismissed' })
    await installer.download()
    expect(await installer.restart()).toMatchObject({ ok: false, manual: false })
    expect(progress.at(-1)).toEqual({ phase: 'ready', version: '1.3.0' })
    expect(logs.join()).toContain('pkexec')
  })

  it('reports an unreachable GitHub without throwing', async () => {
    const { installer } = setup({
      check: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      }
    })
    expect(await installer.download()).toMatchObject({ ok: false, manual: false })
  })

  it('joins a second click to the download already running', async () => {
    const { installer, deps } = setup({ check: vi.fn(async () => null) })
    const [a, b] = await Promise.all([installer.download(), installer.download()])
    expect(a).toEqual(b)
    expect(deps.check).toHaveBeenCalledOnce()
    // Once finished, a new attempt is allowed.
    await installer.download()
    expect(deps.check).toHaveBeenCalledTimes(2)
  })
})
