import path from 'node:path'
import { expandHome } from '@shared/paths'
import type { AgentCli } from '@shared/types'

/** The variable that points each CLI at an account's config dir. agy has none: it uses the keyring. */
const CONFIG_DIR_VAR: Record<AgentCli, string | null> = {
  claude: 'CLAUDE_CONFIG_DIR',
  gemini: 'GEMINI_CLI_HOME',
  agy: null
}

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

/** The variable claude reads extra plugin folders from, a path list like PATH. */
export const PLUGIN_DIRS_VAR = 'CLAUDE_CODE_PLUGIN_DIRS'

/**
 * The path list for PLUGIN_DIRS_VAR: what the user's own environment already named, then
 * the mod folders from Settings as absolute paths, without repeats. A folder whose path
 * holds the list separator cannot be named in a path list and is left out.
 */
export function pluginDirsValue(
  inherited: string | undefined,
  modDirs: string[],
  homeDir: string,
  platform: NodeJS.Platform
): string {
  const sep = platform === 'win32' ? ';' : ':'
  const own = modDirs
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(expandHome(d, homeDir)))
    .filter((d) => !d.includes(sep))
  const all = [...(inherited ?? '').split(sep).filter(Boolean), ...own]
  return [...new Set(all)].join(sep)
}

export interface PaneEnvInput {
  baseEnv: NodeJS.ProcessEnv
  /** Plain shell panes never get CLAUDE_CONFIG_DIR from Wraithgrid. */
  shell: boolean
  /** The account's CLI. Defaults to claude. */
  cli?: AgentCli
  /** The account's config dir, possibly starting with `~`. */
  configDir: string | null
  homeDir: string
  /** Mod folders from Settings; claude panes get them as CLAUDE_CODE_PLUGIN_DIRS. */
  modDirs?: string[]
  /** Defaults to this process's platform; tests pass one. */
  platform?: NodeJS.Platform
}

/**
 * The one place that decides a pane's environment, including CLAUDE_CONFIG_DIR / GEMINI_CLI_HOME
 * (requirements §13: isolate it so a CLI change touches one function).
 */
export function buildPaneEnv({
  baseEnv,
  shell,
  cli = 'claude',
  configDir,
  homeDir,
  modDirs = [],
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
  // An agent pane sees only its own account's config dir, never one Wraithgrid inherited.
  if (!shell) for (const v of Object.values(CONFIG_DIR_VAR)) if (v) delete env[v]
  const dirVar = CONFIG_DIR_VAR[cli]
  if (!shell && configDir && dirVar) {
    env[dirVar] = path.resolve(expandHome(configDir, homeDir))
  }
  if (!shell && cli === 'claude') {
    const dirs = pluginDirsValue(env[PLUGIN_DIRS_VAR], modDirs, homeDir, platform)
    if (dirs) env[PLUGIN_DIRS_VAR] = dirs
  }
  return env
}
