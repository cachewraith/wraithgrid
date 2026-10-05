import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPaneEnv, isTerminalVar } from '../../src/main/pane-env'
import {
  listShells,
  loginProbeArgs,
  loginShellPath,
  resolvePaneShell,
  shellKind
} from '../../src/main/platform'

const found =
  (map: Record<string, string>) =>
  (name: string): Promise<string | null> =>
    Promise.resolve(map[name] ?? null)
const existing =
  (files: string[]) =>
  (f: string): Promise<boolean> =>
    Promise.resolve(files.includes(f))

describe('shellKind', () => {
  it('names the shell family from a path', () => {
    expect(shellKind('/usr/bin/fish')).toBe('fish')
    expect(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellKind('/opt/homebrew/bin/NU')).toBe('nu')
  })
})

describe('login probe flags per shell', () => {
  it('runs POSIX-family shells and fish as interactive login shells', () => {
    for (const sh of ['/bin/bash', '/bin/zsh', '/usr/bin/fish', '/bin/ksh', '/bin/dash', '/bin/sh'])
      expect(loginProbeArgs(sh).slice(0, 3)).toEqual(['-i', '-l', '-c'])
  })

  it('gives csh/tcsh plain -c, since -l must be their only flag', () => {
    expect(loginProbeArgs('/bin/tcsh')).toHaveLength(2)
    expect(loginProbeArgs('/bin/csh')[0]).toBe('-c')
  })

  it('uses nushell externals and PowerShell flags', () => {
    const nu = loginProbeArgs('/usr/bin/nu')
    expect(nu.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    expect(nu[3]).toContain('^env -0')
    expect(loginProbeArgs('/usr/bin/pwsh').slice(0, 2)).toEqual(['-Login', '-NoLogo'])
    expect(loginProbeArgs('/usr/bin/xonsh').slice(0, 3)).toEqual(['-l', '-i', '-c'])
  })

  it('falls back to /bin/sh -l when the user shell gives nothing', async () => {
    const M = '__WRAITHGRID_ENV__'
    const calls: string[] = []
    const run = (file: string): Promise<string> => {
      calls.push(file)
      return Promise.resolve(file === '/bin/sh' ? `${M}PATH=/from/profile\0${M}` : 'oops')
    }
    expect(await loginShellPath({ SHELL: '/usr/bin/weirdsh' }, 100, run)).toBe('/from/profile')
    expect(calls).toEqual(['/usr/bin/weirdsh', '/bin/sh'])
  })

  // The real thing, for every shell installed here (CI has bash and sh at least).
  const installed = ['bash', 'zsh', 'fish', 'nu', 'dash', 'ksh', 'tcsh', 'xonsh', 'elvish', 'pwsh']
    .map((name) => {
      try {
        return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  it.runIf(process.platform !== 'win32' && installed.length > 0)(
    `reads PATH from real shells: ${installed.map(shellKind).join(', ')}`,
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-shells-'))
      try {
        for (const shell of installed) {
          const PATH = `/wraithgrid-probe-${shellKind(shell)}:/usr/bin:/bin`
          const got = await loginShellPath({ SHELL: shell, HOME: home, PATH }, 10_000)
          expect(got, shell).toContain('/usr/bin')
        }
      } finally {
        fs.rmSync(home, { recursive: true, force: true })
      }
    },
    60_000
  )
})

describe('resolvePaneShell', () => {
  const auto = { path: '', args: [] }

  it('uses the default when nothing is picked', async () => {
    const r = await resolvePaneShell(
      'linux',
      { SHELL: '/usr/bin/fish' },
      found({}),
      existing(['/usr/bin/fish']),
      auto
    )
    expect(r).toEqual({ ok: true, shell: { file: '/usr/bin/fish', args: [] } })
  })

  it('runs a picked shell with its arguments, finding bare names on PATH', async () => {
    const r = await resolvePaneShell(
      'linux',
      {},
      found({ nu: '/home/u/.cargo/bin/nu' }),
      existing(['/home/u/.cargo/bin/nu']),
      { path: 'nu', args: ['--no-history'] }
    )
    expect(r).toEqual({
      ok: true,
      shell: { file: '/home/u/.cargo/bin/nu', args: ['--no-history'] }
    })
    const win = await resolvePaneShell(
      'win32',
      {},
      found({}),
      existing(['C:\\Program Files\\Git\\bin\\bash.exe']),
      { path: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] }
    )
    expect(win.ok && win.shell.args).toEqual(['--login', '-i'])
  })

  it('reports a picked shell that is gone instead of swapping it', async () => {
    const r = await resolvePaneShell('linux', {}, found({}), existing([]), {
      path: '/usr/bin/elvish',
      args: []
    })
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.error).toContain('/usr/bin/elvish')
  })
})

describe('listShells', () => {
  it('lists $SHELL, /etc/shells and shells on PATH once each, without non-shells', async () => {
    const shells = await listShells(
      'linux',
      { SHELL: '/usr/bin/zsh' },
      found({ nu: '/home/u/.cargo/bin/nu', bash: '/usr/bin/bash' }),
      existing([
        '/usr/bin/zsh',
        '/bin/bash',
        '/usr/bin/bash',
        '/usr/bin/fish',
        '/usr/bin/git-shell',
        '/bin/rbash',
        '/home/u/.cargo/bin/nu'
      ]),
      () =>
        Promise.resolve(
          '# comment\n/bin/bash\n/usr/bin/bash\n/bin/rbash\n/usr/bin/git-shell\n/usr/bin/fish\n/sbin/nologin\n'
        )
    )
    expect(shells.map((s) => [s.name, s.path])).toEqual([
      ['zsh', '/usr/bin/zsh'],
      ['bash', '/bin/bash'],
      ['fish', '/usr/bin/fish'],
      ['nu', '/home/u/.cargo/bin/nu']
    ])
  })

  it('finds the Windows shells, Git Bash with login args', async () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const shells = await listShells(
      'win32',
      { ComSpec: 'C:\\Windows\\system32\\cmd.exe', ProgramFiles: 'C:\\Program Files' },
      found({ pwsh: 'C:\\pwsh.exe', powershell: 'C:\\ps.exe', wsl: 'C:\\wsl.exe' }),
      existing([bash]),
      () => Promise.resolve(null)
    )
    expect(shells.map((s) => s.name)).toEqual([
      'PowerShell 7',
      'Windows PowerShell',
      'Command Prompt',
      'Git Bash',
      'WSL'
    ])
    expect(shells.find((s) => s.name === 'Git Bash')?.args).toEqual(['--login', '-i'])
  })
})

describe('pane environment for any shell', () => {
  const home = path.resolve('/home/u')

  it('drops variables of the terminal Wraithgrid was started from', () => {
    const env = buildPaneEnv({
      baseEnv: {
        PATH: '/usr/bin',
        LANG: 'en_US.UTF-8',
        COLUMNS: '80',
        LINES: '24',
        TERM_PROGRAM: 'vscode',
        VSCODE_IPC_HOOK_CLI: '/tmp/x',
        TMUX: '/tmp/tmux,1,0',
        KITTY_WINDOW_ID: '3',
        WT_SESSION: 'abc',
        CLAUDECODE: '1',
        EDITOR: 'nvim'
      },
      shell: false,
      configDir: '~/.claude',
      homeDir: home,
      platform: 'linux'
    })
    for (const k of [
      'COLUMNS',
      'LINES',
      'TERM_PROGRAM',
      'VSCODE_IPC_HOOK_CLI',
      'TMUX',
      'KITTY_WINDOW_ID',
      'WT_SESSION',
      'CLAUDECODE'
    ])
      expect(env, k).not.toHaveProperty(k)
    expect(env).toMatchObject({ EDITOR: 'nvim', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  })

  it('matches Windows-style variable casing too', () => {
    expect(isTerminalVar('Wt_Session')).toBe(true)
    expect(isTerminalVar('PATH')).toBe(false)
  })

  it('falls back to a UTF-8 locale when none is set, except on Windows', () => {
    const linux = buildPaneEnv({
      baseEnv: {},
      shell: true,
      configDir: null,
      homeDir: home,
      platform: 'linux'
    })
    expect(linux.LANG).toBe('C.UTF-8')
    const keep = buildPaneEnv({
      baseEnv: { LC_ALL: 'de_DE.UTF-8' },
      shell: true,
      configDir: null,
      homeDir: home,
      platform: 'linux'
    })
    expect(keep).not.toHaveProperty('LANG')
    const win = buildPaneEnv({
      baseEnv: {},
      shell: true,
      configDir: null,
      homeDir: home,
      platform: 'win32'
    })
    expect(win).not.toHaveProperty('LANG')
  })
})
