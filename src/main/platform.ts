// Platform differences in one place, as plain functions of (platform, env) so they are
// testable on any OS. Callers pass process.platform and process.env.
import { execFile } from 'node:child_process'
import path from 'node:path'

// ---- Desktop and window chrome ------------------------------------------------------

/**
 * How the window frame is drawn:
 * - `custom`: our own title bar with min/max/close (GNOME, KDE, Xfce, …)
 * - `overlay`: our title bar with Windows' native caption buttons over it (snap layouts)
 * - `tiling`: a tiling compositor (Hyprland, sway, i3, …) manages size; only close shows
 * - `mac`: our title bar with macOS's own traffic lights inset at its left end
 */
export type WindowChrome = 'custom' | 'overlay' | 'tiling' | 'mac'

export interface DesktopInfo {
  chrome: WindowChrome
  /** First entry of XDG_CURRENT_DESKTOP, e.g. "Hyprland", "GNOME". */
  desktop: string | null
  wayland: boolean
}

const TILING_DESKTOPS = new Set([
  'hyprland',
  'sway',
  'i3',
  'river',
  'niri',
  'bspwm',
  'qtile',
  'dwm',
  'awesome',
  'xmonad',
  'herbstluftwm',
  'leftwm',
  'miracle-wm'
])

export function detectDesktop(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): DesktopInfo {
  if (platform === 'win32') return { chrome: 'overlay', desktop: 'Windows', wayland: false }
  if (platform === 'darwin') return { chrome: 'mac', desktop: 'macOS', wayland: false }
  const names = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION]
    .filter((x): x is string => !!x)
    .flatMap((x) => x.toLowerCase().split(/[:;]/))
  const tiling =
    !!(env.HYPRLAND_INSTANCE_SIGNATURE || env.SWAYSOCK || env.I3SOCK || env.NIRI_SOCKET) ||
    names.some((n) => TILING_DESKTOPS.has(n))
  return {
    chrome: tiling ? 'tiling' : 'custom',
    desktop: env.XDG_CURRENT_DESKTOP?.split(':')[0] || null,
    wayland: !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland'
  }
}

/**
 * The approved minimum is 1100×700. A tiling compositor sizes windows itself (a half
 * tile on 1920 px is 960 px), and a larger minimum would make the window overflow its
 * tile, so there the minimum only keeps the layout usable.
 */
export function minimumWindowSize(chrome: WindowChrome): { width: number; height: number } {
  return chrome === 'tiling' ? { width: 640, height: 420 } : { width: 1100, height: 700 }
}

/** Where the traffic lights sit so they center in our 36 px title bar. */
export const MAC_TRAFFIC_LIGHTS = { x: 12, y: 11 } as const

/** Caption-button colors for Windows' title bar overlay, from the theme tokens. */
export function titleBarOverlayFor(theme: 'dark' | 'light'): {
  color: string
  symbolColor: string
  height: number
} {
  return theme === 'light'
    ? { color: '#f9f9f8', symbolColor: '#4d4d4d', height: 35 }
    : { color: '#171717', symbolColor: '#b4b4b4', height: 35 }
}

// ---- Shells and binaries ------------------------------------------------------------

export type Finder = (name: string) => Promise<string | null>
export type Exists = (file: string) => Promise<boolean>

/** The shell a plain shell pane runs: $SHELL on POSIX, PowerShell 7 → 5 → cmd on Windows. */
export async function resolveDefaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  find: Finder,
  exists: Exists
): Promise<string> {
  if (platform === 'win32') {
    return (await find('pwsh')) ?? (await find('powershell')) ?? env.ComSpec ?? 'cmd.exe'
  }
  // macOS's default shell is zsh (since 10.15); Linux's is usually bash.
  const fallbacks =
    platform === 'darwin'
      ? ['/bin/zsh', '/bin/bash', '/bin/sh']
      : ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/bin/sh']
  for (const candidate of [env.SHELL, ...fallbacks]) {
    if (candidate && (await exists(candidate))) return candidate
  }
  return '/bin/sh'
}

/** `/usr/bin/fish` → `fish`, `C:\\x\\pwsh.exe` → `pwsh`: the shell's family, for its flags. */
export function shellKind(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).toLowerCase().replace(/\.exe$/, '')
}

export interface ShellChoice {
  file: string
  args: string[]
}

/**
 * The shell a plain shell pane runs: the one picked in Settings (`pick`, '' for automatic),
 * else the default. A picked shell that is gone is an error, not a silent swap.
 */
export async function resolvePaneShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  find: Finder,
  exists: Exists,
  pick: { path: string; args: string[] }
): Promise<{ ok: true; shell: ShellChoice } | { ok: false; error: string }> {
  if (!pick.path) {
    return {
      ok: true,
      shell: { file: await resolveDefaultShell(platform, env, find, exists), args: [] }
    }
  }
  const p = platform === 'win32' ? path.win32 : path.posix
  // A bare name ("pwsh", "nu") is looked up on PATH.
  const file = p.isAbsolute(pick.path) ? pick.path : await find(pick.path)
  if (!file || !(await exists(file))) {
    return {
      ok: false,
      error: `Shell not found: ${pick.path}. Pick another in Settings → General.`
    }
  }
  return { ok: true, shell: { file, args: pick.args } }
}

export interface ShellOption {
  name: string
  path: string
  args: string[]
}

/** Shells that are not in /etc/shells when installed by cargo, brew, pip or by hand. */
const EXTRA_POSIX_SHELLS = [
  'bash',
  'zsh',
  'fish',
  'nu',
  'pwsh',
  'xonsh',
  'elvish',
  'tcsh',
  'ksh',
  'dash'
]

/**
 * Installed shells for the Settings picker. POSIX: $SHELL, /etc/shells, then well-known
 * names on PATH, one per name. Windows: PowerShell 7 and 5, cmd, Git Bash, WSL, nushell.
 */
export async function listShells(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  find: Finder,
  exists: Exists,
  readText: (file: string) => Promise<string | null>
): Promise<ShellOption[]> {
  const out: ShellOption[] = []
  const add = (name: string, file: string | null, args: string[] = []): void => {
    if (file && !out.some((o) => o.path === file || o.name === name))
      out.push({ name, path: file, args })
  }
  if (platform === 'win32') {
    add('PowerShell 7', await find('pwsh'))
    add('Windows PowerShell', await find('powershell'))
    add('Command Prompt', env.ComSpec ?? (await find('cmd')))
    for (const base of [
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')
    ]) {
      if (!base) continue
      const bash = path.win32.join(base, 'Git', 'bin', 'bash.exe')
      if (await exists(bash)) add('Git Bash', bash, ['--login', '-i'])
    }
    add('WSL', await find('wsl'))
    add('nushell', await find('nu'))
    return out
  }
  const candidates: string[] = []
  if (env.SHELL) candidates.push(env.SHELL)
  for (const line of ((await readText('/etc/shells')) ?? '').split('\n')) {
    const f = line.trim()
    if (f.startsWith('/')) candidates.push(f)
  }
  for (const f of candidates) {
    // Listed on some systems but not shells to work in.
    if (/(nologin|false|git-shell|rbash|fallback-shell)$/.test(f) || !(await exists(f))) continue
    add(shellKind(f), f)
  }
  for (const name of EXTRA_POSIX_SHELLS) add(name, await find(name))
  return out
}

/**
 * Places `claude` is commonly installed that a GUI session's PATH often lacks
 * (the native installer, npm prefixes, bun, volta).
 */
export function extraBinDirs(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv
): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32') {
    return [
      p.join(home, '.local', 'bin'),
      env.APPDATA ? p.join(env.APPDATA, 'npm') : null,
      p.join(home, '.bun', 'bin')
    ].filter((x): x is string => !!x)
  }
  return [
    p.join(home, '.local', 'bin'),
    p.join(home, '.claude', 'local'),
    // Homebrew: Apple Silicon, then Intel (/usr/local/bin below).
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
    p.join(home, '.npm-global', 'bin'),
    p.join(home, '.bun', 'bin'),
    p.join(home, '.volta', 'bin'),
    '/usr/local/bin'
  ]
}

/** Joins PATH lists in priority order, dropping empty and duplicate entries. */
export function mergePath(delimiter: string, ...lists: (string | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const dir of (list ?? '').split(delimiter)) {
      if (dir && !seen.has(dir)) {
        seen.add(dir)
        out.push(dir)
      }
    }
  }
  return out.join(delimiter)
}

// cmd.exe would interpret these inside a .cmd shim's arguments.
const CMD_UNSAFE = /[&|<>^%"\r\n]/

export type SpawnCommand =
  { ok: true; file: string; args: string[] | string } | { ok: false; error: string }

/**
 * How to start `file` in a pty. On Windows an npm-installed claude is a `.cmd` shim,
 * which CreateProcess cannot run directly; it goes through `cmd.exe /d /s /c`, and
 * arguments cmd.exe would reinterpret are refused rather than escaped.
 */
export function spawnCommandFor(
  platform: NodeJS.Platform,
  file: string,
  args: string[],
  comspec?: string
): SpawnCommand {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { ok: true, file, args }
  const bad = [file, ...args].find((a) => CMD_UNSAFE.test(a))
  if (bad !== undefined) {
    return {
      ok: false,
      error: `"${bad}" contains characters that cannot pass through ${path.win32.basename(file)}. Remove them or install the native claude.exe.`
    }
  }
  const quote = (a: string): string => (a === '' || /\s/.test(a) ? `"${a}"` : a)
  const line = [`"${file}"`, ...args.map(quote)].join(' ')
  return { ok: true, file: comspec || 'cmd.exe', args: `/d /s /c "${line}"` }
}

// ---- Login-shell environment --------------------------------------------------------

const ENV_MARK = '__WRAITHGRID_ENV__'

/**
 * Pulls PATH out of the probe's output framed by markers (shell noise before or after is
 * ignored): either `printenv PATH` (one line) or an `env -0` dump (NUL-separated).
 */
export function parsePathFromEnvDump(output: string): string | null {
  const start = output.indexOf(ENV_MARK)
  const end = output.lastIndexOf(ENV_MARK)
  if (start < 0 || end <= start) return null
  const body = output.slice(start + ENV_MARK.length, end)
  if (body.includes('\0')) {
    for (const entry of body.split('\0')) {
      if (entry.startsWith('PATH=')) return entry.slice(5) || null
    }
    return null
  }
  const line = body.trim()
  return line && !line.includes('\n') ? line : null
}

/**
 * The probe for most shells: POSIX sh, bash, zsh, fish, ksh, csh, xonsh, elvish, pwsh.
 * `printenv` exists on Linux, macOS and BSD (macOS's older `env` has no `-0`), and prints
 * PATH colon-joined even in fish, where `$PATH` is a list.
 */
const PROBE = `printf '%s' ${ENV_MARK}; printenv PATH; printf '%s' ${ENV_MARK}`
/** nushell has no `printf` and its own `printenv`-less env; `^` runs the external programs. */
const PROBE_NU = `^printf '%s' ${ENV_MARK}; ^printenv PATH; ^printf '%s' ${ENV_MARK}`

/**
 * How to run the probe as a login, interactive shell of this kind, so it reads the same
 * startup files as a terminal would. csh/tcsh only allow `-l` alone, so they get plain
 * `-c` (their rc files set PATH anyway); unknown shells get `-c`, and if that yields
 * nothing the caller falls back to `/bin/sh -l`.
 */
export function loginProbeArgs(shell: string): string[] {
  const kind = shellKind(shell)
  switch (kind) {
    case 'bash':
    case 'zsh':
    case 'sh':
    case 'dash':
    case 'ash':
    case 'ksh':
    case 'mksh':
    case 'oksh':
    case 'yash':
    case 'fish':
      return ['-i', '-l', '-c', PROBE]
    case 'xonsh':
      return ['-l', '-i', '-c', PROBE]
    case 'nu':
      return ['-l', '-i', '-c', PROBE_NU]
    case 'pwsh':
      return ['-Login', '-NoLogo', '-Command', PROBE]
    default:
      return ['-c', PROBE]
  }
}

/**
 * Apps started from a launcher (a Hyprland `exec`, a .desktop file) do not get the PATH
 * a login shell sets up, so `claude` in ~/.local/bin or an nvm prefix goes missing.
 * Asks the user's login shell once, like VS Code does; if that shell can't answer,
 * `/bin/sh -l` (which reads ~/.profile) does. POSIX only; never throws.
 */
export async function loginShellPath(
  env: NodeJS.ProcessEnv,
  timeoutMs = 4000,
  run: (file: string, args: string[]) => Promise<string> = (file, args) =>
    runProbe(file, args, env, timeoutMs)
): Promise<string | null> {
  const shell = env.SHELL
  if (shell) {
    const found = parsePathFromEnvDump(await run(shell, loginProbeArgs(shell)))
    if (found) return found
  }
  return parsePathFromEnvDump(await run('/bin/sh', ['-l', '-c', PROBE]))
}

function runProbe(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        // Lets a user's rc file skip slow setup, as with VSCODE_RESOLVING_ENVIRONMENT.
        env: { ...env, WRAITHGRID_RESOLVING_ENVIRONMENT: '1' }
      },
      (_err, stdout) => resolve(String(stdout ?? ''))
    )
  })
}
