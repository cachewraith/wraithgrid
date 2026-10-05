import path from 'node:path'
import { expandHome } from '@shared/paths'

/**
 * Variables that describe the terminal Wraithgrid was started from, not the pane. Inherited,
 * they make claude size itself wrong (COLUMNS/LINES) or act as if it ran inside VS Code,
 * tmux, kitty or Windows Terminal (keybindings, IDE hooks, graphics), breaking its screen.
 */
const TERMINAL_VARS = new Set([
  'COLUMNS',
  'LINES',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'TERMINAL_EMULATOR',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'WINDOW',
  'VTE_VERSION',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'ALACRITTY_LOG',
  'ALACRITTY_SOCKET',
  'ALACRITTY_WINDOW_ID',
  'GHOSTTY_RESOURCES_DIR',
  'GHOSTTY_BIN_DIR',
  'GHOSTTY_SHELL_FEATURES',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  // Set inside a claude session: a claude pane is never nested in one.
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT'
])
const TERMINAL_PREFIXES = ['KITTY_', 'WEZTERM_', 'ITERM_', 'KONSOLE_', 'VSCODE_', 'GNOME_TERMINAL_']

/** True for a variable inherited from the launching terminal that a pane must not see. */
export function isTerminalVar(key: string): boolean {
  const k = key.toUpperCase()
  return TERMINAL_VARS.has(k) || TERMINAL_PREFIXES.some((p) => k.startsWith(p))
}

/** UTF-8 is needed for claude's box drawing and spinners in the tools it runs. */
function hasLocale(env: Record<string, string>): boolean {
  return ['LC_ALL', 'LC_CTYPE', 'LANG'].some((k) => !!env[k])
}

export interface PaneEnvInput {
  baseEnv: NodeJS.ProcessEnv
  /** Plain shell panes never get CLAUDE_CONFIG_DIR from Wraithgrid. */
  shell: boolean
  /** The account's config dir, possibly starting with `~`. */
  configDir: string | null
  homeDir: string
  /** Defaults to this process's platform; tests pass one. */
  platform?: NodeJS.Platform
}

/**
 * The one place that decides a pane's environment, including CLAUDE_CONFIG_DIR
 * (requirements §13: isolate it so a CLI change touches one function).
 */
export function buildPaneEnv({
  baseEnv,
  shell,
  configDir,
  homeDir,
  platform = process.platform
}: PaneEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    // Electron's own switches must not leak into child tools (e.g. ELECTRON_RUN_AS_NODE).
    if (value === undefined || key.startsWith('ELECTRON_') || isTerminalVar(key)) continue
    env[key] = value
  }
  // What xterm.js is: every shell (bash, zsh, fish, nu, PowerShell…) and claude read these.
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // macOS apps opened from the Dock get no locale; older macOS has no C.UTF-8.
  if (platform !== 'win32' && !hasLocale(env))
    env.LANG = platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
  if (!shell && configDir) {
    env.CLAUDE_CONFIG_DIR = path.resolve(expandHome(configDir, homeDir))
  }
  return env
}
