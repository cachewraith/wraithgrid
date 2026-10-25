import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  detectDevCommand,
  findLocalUrl,
  isLocalUrl,
  previewReport,
  shellLaunch,
  type PreviewEvent
} from '@shared/preview'
import type { ChatChild } from '../../src/main/chat/sessions'
import { DevServers } from '../../src/main/preview'

describe('detectDevCommand (#74)', () => {
  const files = (
    scripts: Record<string, string> | null,
    lockfiles: string[] = [],
    artisan = false
  ) => ({ scripts, lockfiles, artisan })

  it('runs package.json "dev", else "start", with the lockfile\'s package manager', () => {
    expect(detectDevCommand(files({ dev: 'vite', start: 'x' }, ['bun.lock']))).toEqual({
      command: 'bun run dev',
      source: 'package.json "dev", bun.lock'
    })
    expect(detectDevCommand(files({ start: 'next start' }, ['pnpm-lock.yaml']))?.command).toBe(
      'pnpm run start'
    )
    expect(detectDevCommand(files({ dev: 'vite' }, ['yarn.lock']))?.command).toBe('yarn dev')
    expect(detectDevCommand(files({ dev: 'vite' }))).toEqual({
      command: 'npm run dev',
      source: 'package.json "dev"'
    })
  })

  it('serves Laravel with artisan, and finds nothing otherwise', () => {
    expect(detectDevCommand(files({ build: 'x' }, [], true))?.command).toBe('php artisan serve')
    expect(detectDevCommand(files(null))).toBeNull()
  })
})

describe('isLocalUrl / findLocalUrl', () => {
  it('lets only this computer load', () => {
    for (const u of [
      'http://localhost:5173/',
      'https://127.0.0.1:8000/x',
      'http://[::1]:3000',
      'http://app.localhost:80'
    ])
      expect(isLocalUrl(u)).toBe(true)
    for (const u of [
      'https://example.com',
      'http://localhost.evil.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'nope'
    ])
      expect(isLocalUrl(u)).toBe(false)
  })

  it('reads the address a server prints, without colours; 0.0.0.0 is localhost', () => {
    expect(
      findLocalUrl(
        '  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m'
      )
    ).toBe('http://localhost:5173/')
    expect(findLocalUrl('INFO  Server running on [http://127.0.0.1:8000].')).toBe(
      'http://127.0.0.1:8000'
    )
    expect(findLocalUrl('Listening on http://0.0.0.0:3000')).toBe('http://localhost:3000')
    expect(findLocalUrl('Network: http://192.168.1.4:5173/')).toBeNull()
  })

  it('runs the command in the platform shell', () => {
    expect(shellLaunch('bun run dev', 'linux', {})).toEqual({
      file: '/bin/sh',
      args: ['-c', 'bun run dev']
    })
    expect(shellLaunch('npm run dev', 'win32', { ComSpec: 'C:\\cmd.exe' })).toEqual({
      file: 'C:\\cmd.exe',
      args: '/d /s /c "npm run dev"'
    })
  })
})

function fakeChild() {
  const ev = new EventEmitter()
  const child = {
    pid: 42,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    once: (e: string, cb: (...a: unknown[]) => void) => ev.once(e, cb)
  }
  return { child: child as unknown as ChatChild & typeof child, ev }
}

describe('DevServers', () => {
  const launch = { file: '/bin/sh', args: ['-c', 'x'], cwd: '/p', env: {} }

  it('streams lines, reports the first local address once, then the exit', async () => {
    const { child, ev } = fakeChild()
    const events: PreviewEvent[] = []
    const ds = new DevServers({ spawn: () => child, emit: (_id, e) => events.push(e) })
    ds.start('p1', launch)
    child.stdout.write('\x1b[1mready\x1b[0m\n  Local: http://localhost:5173/\n')
    child.stderr.write('again http://localhost:9999/\n')
    await new Promise((r) => setImmediate(r))
    ev.emit('exit', 1, null)
    expect(events).toEqual([
      { kind: 'log', line: 'ready' },
      { kind: 'log', line: '  Local: http://localhost:5173/' },
      { kind: 'url', url: 'http://localhost:5173/' },
      { kind: 'log', line: 'again http://localhost:9999/' },
      { kind: 'exit', code: 1 }
    ])
    expect(ds.running('p1')).toBe(false)
  })

  it('stop ends the server quietly, then for good after the grace time', () => {
    vi.useFakeTimers()
    const { child, ev } = fakeChild()
    const forceKill = vi.fn()
    const emit = vi.fn()
    const ds = new DevServers({ spawn: () => child, emit, forceKill, stopGraceMs: 100 })
    ds.start('p1', launch)
    ds.stop('p1')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    ev.emit('exit', null, 'SIGTERM')
    vi.advanceTimersByTime(100)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(forceKill).toHaveBeenCalledWith(42)
    expect(emit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('previewReport', () => {
  it('lists the errors and failed requests, local paths short; the chip counts them', () => {
    const r = previewReport({
      url: 'http://localhost:5173/pricing',
      size: { width: 1280, height: 720 },
      errors: ['TypeError: x\n   at y (a.tsx:1)'],
      failed: [
        { method: 'GET', url: 'http://localhost:5173/img/p.png', result: '404' },
        { method: 'POST', url: 'https://api.example.com/x', result: 'net::ERR_FAILED' }
      ]
    })
    expect(r.label).toBe('Preview /pricing · 1 console error · 2 failed requests')
    expect(r.text).toBe(
      [
        'Preview of http://localhost:5173/pricing (1280×720)',
        'Console errors:',
        '  TypeError: x at y (a.tsx:1)',
        'Failed requests:',
        '  GET /img/p.png → 404',
        '  POST https://api.example.com/x → net::ERR_FAILED'
      ].join('\n')
    )
    expect(
      previewReport({ url: 'http://localhost/', size: null, errors: [], failed: [] }).text
    ).toBe('Preview of http://localhost/\nConsole errors: none\nFailed requests: none')
  })
})
