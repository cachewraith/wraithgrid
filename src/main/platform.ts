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
 */
export type WindowChrome = 'custom' | 'overlay' | 'tiling'

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
  for (const candidate of [env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/zsh', '/bin/sh']) {
    if (candidate && (await exists(candidate))) return candidate
  }
  return '/bin/sh'
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

/** Pulls PATH out of `env -0` output framed by markers (shell noise before or after is ignored). */
export function parsePathFromEnvDump(output: string): string | null {
  const start = output.indexOf(ENV_MARK)
  const end = output.lastIndexOf(ENV_MARK)
  if (start < 0 || end <= start) return null
  const body = output.slice(start + ENV_MARK.length, end)
  for (const entry of body.split('\0')) {
    if (entry.startsWith('PATH=')) return entry.slice(5) || null
  }
  return null
}

/**
 * Apps started from a launcher (a Hyprland `exec`, a .desktop file) do not get the PATH
 * a login shell sets up, so `claude` in ~/.local/bin or an nvm prefix goes missing.
 * Asks the user's login shell once, like VS Code does. POSIX only; never throws.
 */
export function loginShellPath(env: NodeJS.ProcessEnv, timeoutMs = 4000): Promise<string | null> {
  const shell = env.SHELL
  if (!shell) return Promise.resolve(null)
  const script = `printf '%s' ${ENV_MARK}; env -0; printf '%s' ${ENV_MARK}`
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-i', '-l', '-c', script],
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        // Lets a user's rc file skip slow setup, as with VSCODE_RESOLVING_ENVIRONMENT.
        env: { ...env, WRAITHGRID_RESOLVING_ENVIRONMENT: '1' }
      },
      (_err, stdout) => resolve(parsePathFromEnvDump(String(stdout ?? '')))
    )
  })
}
