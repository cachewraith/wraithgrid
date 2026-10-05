import { describe, expect, it } from 'vitest'
import {
  detectDesktop,
  extraBinDirs,
  mergePath,
  minimumWindowSize,
  parsePathFromEnvDump,
  resolveDefaultShell,
  spawnCommandFor
} from '../../src/main/platform'

describe('detectDesktop', () => {
  it('treats tiling compositors as tiling', () => {
    expect(
      detectDesktop('linux', { XDG_CURRENT_DESKTOP: 'Hyprland', WAYLAND_DISPLAY: 'wayland-1' })
    ).toEqual({
      chrome: 'tiling',
      desktop: 'Hyprland',
      wayland: true
    })
    expect(detectDesktop('linux', { HYPRLAND_INSTANCE_SIGNATURE: 'abc' }).chrome).toBe('tiling')
    expect(detectDesktop('linux', { SWAYSOCK: '/run/user/1000/sway.sock' }).chrome).toBe('tiling')
    expect(detectDesktop('linux', { XDG_SESSION_DESKTOP: 'i3' }).chrome).toBe('tiling')
    expect(detectDesktop('linux', { DESKTOP_SESSION: 'niri' }).chrome).toBe('tiling')
  })

  it('keeps our own window controls on stacking desktops', () => {
    expect(detectDesktop('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toEqual({
      chrome: 'custom',
      desktop: 'ubuntu',
      wayland: false
    })
    expect(
      detectDesktop('linux', { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }).wayland
    ).toBe(true)
    expect(detectDesktop('linux', {}).chrome).toBe('custom')
  })

  it('uses the native caption overlay on Windows', () => {
    expect(detectDesktop('win32', { XDG_CURRENT_DESKTOP: 'Hyprland' }).chrome).toBe('overlay')
  })

  it('relaxes the minimum size only for tiling compositors', () => {
    expect(minimumWindowSize('custom')).toEqual({ width: 1100, height: 700 })
    expect(minimumWindowSize('overlay')).toEqual({ width: 1100, height: 700 })
    expect(minimumWindowSize('tiling').width).toBeLessThan(960)
  })
})

describe('resolveDefaultShell', () => {
  const found = (names: Record<string, string>) => async (n: string) => names[n] ?? null
  const existing = (files: string[]) => async (f: string) => files.includes(f)

  it('prefers PowerShell 7, then Windows PowerShell, then cmd', async () => {
    expect(
      await resolveDefaultShell(
        'win32',
        {},
        found({ pwsh: 'C:\\pwsh.exe', powershell: 'C:\\ps.exe' }),
        existing([])
      )
    ).toBe('C:\\pwsh.exe')
    expect(
      await resolveDefaultShell('win32', {}, found({ powershell: 'C:\\ps.exe' }), existing([]))
    ).toBe('C:\\ps.exe')
    expect(
      await resolveDefaultShell('win32', { ComSpec: 'C:\\cmd.exe' }, found({}), existing([]))
    ).toBe('C:\\cmd.exe')
  })

  it('uses $SHELL, then falls back to an installed shell', async () => {
    expect(
      await resolveDefaultShell(
        'linux',
        { SHELL: '/usr/bin/fish' },
        found({}),
        existing(['/usr/bin/fish'])
      )
    ).toBe('/usr/bin/fish')
    expect(
      await resolveDefaultShell('linux', { SHELL: '/gone' }, found({}), existing(['/bin/bash']))
    ).toBe('/bin/bash')
    expect(await resolveDefaultShell('linux', {}, found({}), existing([]))).toBe('/bin/sh')
  })
})

describe('spawnCommandFor', () => {
  it('passes binaries straight through', () => {
    expect(spawnCommandFor('linux', '/usr/bin/claude', ['-c'])).toEqual({
      ok: true,
      file: '/usr/bin/claude',
      args: ['-c']
    })
    expect(spawnCommandFor('win32', 'C:\\Users\\me\\.local\\bin\\claude.exe', ['-c'])).toEqual({
      ok: true,
      file: 'C:\\Users\\me\\.local\\bin\\claude.exe',
      args: ['-c']
    })
  })

  it('runs a Windows .cmd shim through cmd.exe with a quoted command line', () => {
    const r = spawnCommandFor(
      'win32',
      'C:\\Program Files (x86)\\npm\\claude.cmd',
      ['--resume', 'two words'],
      'C:\\Windows\\system32\\cmd.exe'
    )
    expect(r).toEqual({
      ok: true,
      file: 'C:\\Windows\\system32\\cmd.exe',
      args: '/d /s /c ""C:\\Program Files (x86)\\npm\\claude.cmd" --resume "two words""'
    })
  })

  it('refuses arguments cmd.exe would reinterpret', () => {
    for (const bad of ['a&calc', 'x|y', '%PATH%', 'say "hi"', 'a^b', 'x>y']) {
      expect(spawnCommandFor('win32', 'C:\\npm\\claude.cmd', [bad]).ok).toBe(false)
    }
    // The same characters are fine where no shell is involved.
    expect(spawnCommandFor('linux', '/usr/bin/claude', ['a&calc']).ok).toBe(true)
  })
})

describe('login-shell PATH', () => {
  const M = '__WRAITHGRID_ENV__'

  it('reads PATH from the framed env dump and ignores shell noise', () => {
    const out = `Welcome back!\n${M}HOME=/home/u\0PATH=/home/u/.local/bin:/usr/bin\0SHELL=/bin/zsh\0${M}bye\n`
    expect(parsePathFromEnvDump(out)).toBe('/home/u/.local/bin:/usr/bin')
  })

  it('reads PATH from printenv output too', () => {
    expect(parsePathFromEnvDump(`Last login: Mon\n${M}/opt/homebrew/bin:/usr/bin\n${M}`)).toBe(
      '/opt/homebrew/bin:/usr/bin'
    )
    expect(parsePathFromEnvDump(`${M}\n${M}`)).toBeNull()
  })

  it('returns null when the shell failed', () => {
    expect(parsePathFromEnvDump('')).toBeNull()
    expect(parsePathFromEnvDump(`${M}HOME=/x\0`)).toBeNull()
    expect(parsePathFromEnvDump(`${M}HOME=/x\0${M}`)).toBeNull()
  })

  it('merges PATH lists in order without duplicates', () => {
    expect(mergePath(':', '/a:/b', '/b:/c:', '', undefined, '/a:/d')).toBe('/a:/b:/c:/d')
    expect(mergePath(';', 'C:\\x;C:\\y', 'C:\\y')).toBe('C:\\x;C:\\y')
  })

  it('knows where claude usually lives', () => {
    expect(extraBinDirs('linux', '/home/u', {})).toContain('/home/u/.local/bin')
    expect(
      extraBinDirs('win32', 'C:\\Users\\u', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })
    ).toEqual([
      'C:\\Users\\u\\.local\\bin',
      'C:\\Users\\u\\AppData\\Roaming\\npm',
      'C:\\Users\\u\\.bun\\bin'
    ])
  })
})

describe('macOS', () => {
  it('uses the inset traffic lights and a normal minimum size', () => {
    expect(detectDesktop('darwin', {})).toEqual({ chrome: 'mac', desktop: 'macOS', wayland: false })
    expect(minimumWindowSize('mac')).toEqual({ width: 1100, height: 700 })
  })

  it('looks for claude in Homebrew too', () => {
    const dirs = extraBinDirs('darwin', '/Users/u', {})
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/Users/u/.local/bin')
    expect(extraBinDirs('linux', '/home/u', {})).not.toContain('/opt/homebrew/bin')
  })

  it('falls back to zsh, the macOS default shell', async () => {
    const exists = (files: string[]) => (f: string) => Promise.resolve(files.includes(f))
    const none = () => Promise.resolve(null)
    expect(await resolveDefaultShell('darwin', {}, none, exists(['/bin/zsh', '/bin/bash']))).toBe(
      '/bin/zsh'
    )
    expect(
      await resolveDefaultShell(
        'darwin',
        { SHELL: '/opt/homebrew/bin/fish' },
        none,
        exists(['/opt/homebrew/bin/fish'])
      )
    ).toBe('/opt/homebrew/bin/fish')
  })
})
