import path from 'node:path'
import { expandHome } from '@shared/paths'
import { AGENT_CLI_SPECS, CONFIG_DIR_VARS, type AgentCli } from '@shared/agent-clis'

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
 * A pane's environment as rules, without the machine's own environment: what to drop, what
 * to set and the locale to add when none is set. Local panes apply it to this process's env;
 * a remote machine's Rust host applies it to its own (ADR 0004 phase 5), so both follow one
 * set of rules. `set` values starting with `~/` mean the home of the machine applying it.
 */
export interface PaneEnvPlan {
  /** Exact names (upper case) to leave out. */
  drop: string[]
  /** Name prefixes (upper case) to leave out. */
  dropPrefixes: string[]
  set: Record<string, string>
  /** Set as LANG when none of LC_ALL, LC_CTYPE, LANG is; null on Windows. */
  lang: string | null
}

/** The rules of a pane's environment (requirements §13: one function decides them). */
export function paneEnvPlan({
  shell,
  cli = 'claude',
  configDir,
  platform = process.platform
}: Omit<PaneEnvInput, 'baseEnv' | 'homeDir' | 'modDirs'>): PaneEnvPlan {
  const set: Record<string, string> = {
    // What xterm.js is: every shell (bash, zsh, fish, nu, PowerShell…) and claude read these.
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  }
  const dirVar = AGENT_CLI_SPECS[cli].configDirVar
  if (!shell && configDir && dirVar) set[dirVar] = configDir
  return {
    // An agent pane sees only its own account's config dir, never one Wraithgrid inherited.
    drop: [...TERMINAL_VARS, ...(shell ? [] : CONFIG_DIR_VARS)],
    // Electron's own switches must not leak into child tools (e.g. ELECTRON_RUN_AS_NODE).
    dropPrefixes: ['ELECTRON_', ...TERMINAL_PREFIXES],
    set,
    // macOS apps opened from the Dock get no locale; older macOS has no C.UTF-8.
    lang: platform === 'win32' ? null : platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
  }
}

/** Applies a plan to an environment; `~` in a set value is `homeDir`, made absolute. */
export function applyEnvPlan(
  baseEnv: NodeJS.ProcessEnv,
  plan: PaneEnvPlan,
  homeDir: string
): Record<string, string> {
  const drop = new Set(plan.drop)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    const k = key.toUpperCase()
    if (value === undefined || drop.has(k) || plan.dropPrefixes.some((p) => k.startsWith(p)))
      continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(plan.set))
    env[key] =
      value === '~' || value.startsWith('~/') ? path.resolve(expandHome(value, homeDir)) : value
  if (plan.lang && !hasLocale(env)) env.LANG = plan.lang
  return env
}

/**
 * The one place that decides a pane's environment, including the CLI's config-dir variable
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
  const plan = paneEnvPlan({ shell, cli, configDir, platform })
  // A config dir that isn't under `~` is still made absolute here.
  const dirVar = AGENT_CLI_SPECS[cli].configDirVar
  if (dirVar && plan.set[dirVar])
    plan.set[dirVar] = path.resolve(expandHome(plan.set[dirVar], homeDir))
  const env = applyEnvPlan(baseEnv, plan, homeDir)
  if (!shell && cli === 'claude') {
    const dirs = pluginDirsValue(env[PLUGIN_DIRS_VAR], modDirs, homeDir, platform)
    if (dirs) env[PLUGIN_DIRS_VAR] = dirs
  }
  return env
}
