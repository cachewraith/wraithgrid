import { describe, expect, it, vi } from 'vitest'
import type { UpdateProgress } from '@shared/ipc-contract'
import { UpdateInstaller, type InstallerDeps } from '../../src/main/update-install'

function setup(over: Partial<InstallerDeps> = {}) {
  const progress: UpdateProgress[] = []
  const logs: string[] = []
  const deps: InstallerDeps = {
    currentVersion: '1.2.0',
    check: vi.fn(async () => '1.3.0'),
    download: vi.fn(async (onPercent: (p: number) => void) => {
      onPercent(42.4)
      onPercent(100)
    }),
    install: vi.fn(async () => null),
    report: (p) => progress.push(p),
    log: (m) => logs.push(m),
    ...over
  }
  return { installer: new UpdateInstaller(deps), deps, progress, logs }
}

describe('UpdateInstaller', () => {
  it('checks, downloads with progress, then installs', async () => {
    const { installer, deps, progress } = setup()
    expect(await installer.install()).toEqual({ ok: true })
    expect(deps.install).toHaveBeenCalledOnce()
    expect(progress).toEqual([
      { phase: 'checking' },
      { phase: 'downloading', version: '1.3.0', percent: 0 },
      { phase: 'downloading', version: '1.3.0', percent: 42 },
      { phase: 'downloading', version: '1.3.0', percent: 100 },
      { phase: 'installing', version: '1.3.0' }
    ])
  })

  it('offers the release page when this build cannot update itself', async () => {
    const { installer, deps, progress } = setup({ check: async () => null })
    const r = await installer.install()
    expect(r).toMatchObject({ ok: false, manual: true })
    expect(deps.download).not.toHaveBeenCalled()
    expect(progress.at(-1)).toEqual({ phase: 'idle' })
  })

  it('never installs the same or an older version', async () => {
    for (const v of ['1.2.0', '1.1.9', '1.2.0-beta.1']) {
      const { installer, deps } = setup({ check: async () => v })
      expect(await installer.install()).toMatchObject({ ok: false, manual: false })
      expect(deps.download).not.toHaveBeenCalled()
    }
  })

  it('does not install after a failed or tampered download, and logs the detail only', async () => {
    const { installer, deps, logs } = setup({
      download: async () => {
        throw new Error('sha512 checksum mismatch, expected abc https://example.test/x')
      }
    })
    const r = await installer.install()
    expect(r).toEqual({
      ok: false,
      error: 'The download failed or did not match its checksum.',
      manual: false
    })
    expect(deps.install).not.toHaveBeenCalled()
    expect(logs.join()).toContain('checksum mismatch')
  })

  it('reports a cancelled install (e.g. the password prompt) and goes back to idle', async () => {
    const { installer, progress } = setup({ install: async () => 'pkexec: dismissed' })
    expect(await installer.install()).toMatchObject({ ok: false, manual: false })
    expect(progress.at(-1)).toEqual({ phase: 'idle' })
  })

  it('reports an unreachable GitHub without throwing', async () => {
    const { installer } = setup({
      check: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      }
    })
    expect(await installer.install()).toMatchObject({ ok: false, manual: false })
  })

  it('joins a second click to the install already running', async () => {
    const { installer, deps } = setup()
    const [a, b] = await Promise.all([installer.install(), installer.install()])
    expect(a).toEqual(b)
    expect(deps.check).toHaveBeenCalledOnce()
    // Once finished, a new attempt is allowed.
    await installer.install()
    expect(deps.check).toHaveBeenCalledTimes(2)
  })
})
