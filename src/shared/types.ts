// Domain model shared by main, preload and renderer. Persisted shape lives in schema.ts.

/** The theme actually drawn. */
export type ThemeName = 'dark' | 'light'
/** What the user picked; `system` follows the OS light/dark setting. */
export type ThemePreference = ThemeName | 'system'

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ThemeName {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
}

export const ACCENTS = ['violet', 'blue', 'teal', 'amber', 'rose'] as const
export type AccentName = (typeof ACCENTS)[number]

/** `match` follows the app theme and accent; the rest are fixed terminal color schemes. */
export const TERMINAL_PALETTES = [
  'match',
  'dracula',
  'nord',
  'tokyo-night',
  'gruvbox-dark',
  'solarized-dark',
  'solarized-light'
] as const
export type TerminalPalette = (typeof TERMINAL_PALETTES)[number]

export const TERMINAL_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'IBM Plex Mono',
  'Source Code Pro'
] as const
export type TerminalFont = (typeof TERMINAL_FONTS)[number]

export const SHARED_MODES = ['overall', 'per-account'] as const
export type SharedMode = (typeof SHARED_MODES)[number]

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 13
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 236
export const DIFF_WIDTH_MIN = 280
export const DIFF_WIDTH_MAX = 1000
export const DIFF_WIDTH_DEFAULT = 440
export const DENSE_FONT_SIZE = 11

export const ACCOUNT_COLORS = [
  { name: 'violet', value: '#7c5cff' },
  { name: 'teal', value: '#2dd4bf' },
  { name: 'amber', value: '#f5a524' },
  { name: 'rose', value: '#f43f5e' }
] as const

/**
 * The agent CLI an account's panes run. `agy` is Antigravity CLI, Gemini CLI's successor;
 * it keeps its sign-in in the system keyring, so it has no per-account config dir.
 */
export const AGENT_CLIS = ['claude', 'gemini', 'agy'] as const
export type AgentCli = (typeof AGENT_CLIS)[number]

export const AGENT_CLI_LABEL: Record<AgentCli, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  agy: 'Antigravity CLI'
}

/** The command each CLI is found by on PATH. */
export const AGENT_CLI_BIN: Record<AgentCli, string> = {
  claude: 'claude',
  gemini: 'gemini',
  agy: 'agy'
}

export interface Account {
  id: string
  name: string
  /** Which CLI its panes run. */
  cli: AgentCli
  /**
   * Passed to the CLI as CLAUDE_CONFIG_DIR (claude) or GEMINI_CLI_HOME (gemini); unused by
   * agy. May start with `~`. Never read by Wraithgrid.
   */
  configDir: string
  color: string
  /** Wraithgrid's own flag. It is never derived from files inside configDir. */
  signedIn: boolean
  imported: boolean
  /** An icon id or emoji (see shared/icons.ts). Empty string: the first letter. */
  icon: string
  /** The sidebar folder it sits in, or null for the top level. */
  folderId: string | null
}

/** A sidebar folder that groups accounts. One level deep. */
export interface AccountFolder {
  id: string
  name: string
  collapsed: boolean
  /** An icon id or emoji. Empty string: a plain folder glyph. */
  icon: string
  /** Icon tint, '#rrggbb', or '' for neutral. */
  color: string
}

/** Quick picks for an account icon; any emoji can be typed in as well. */
export const ACCOUNT_ICONS = [
  '🤖',
  '👾',
  '🦊',
  '🐙',
  '🐳',
  '🦉',
  '🐝',
  '🌵',
  '🔥',
  '⚡',
  '🌙',
  '⭐',
  '🚀',
  '🛠️',
  '💼',
  '🏠',
  '🎓',
  '🧪',
  '🎨',
  '📚',
  '💡',
  '🔒',
  '🧠',
  '👻'
] as const

export interface Pane {
  id: string
  /** null only for plain shell panes. */
  accountId: string | null
  cwd: string
  args: string[]
  shell: boolean
  title: string
}

export type SplitDir = 'row' | 'col'

export type LayoutNode =
  | { type: 'pane'; paneId: string }
  | { type: 'empty'; slotId: string }
  | { type: 'split'; dir: SplitDir; sizes: number[]; children: LayoutNode[] }

export interface Workspace {
  id: string
  name: string
  /** An icon id or emoji. Empty string: the first letter. */
  icon: string
  /** Icon tint, '#rrggbb', or '' for neutral. */
  color: string
  /** Every pane in the workspace. Panes missing from `layout` are hidden, not closed. */
  panes: Pane[]
  layout: LayoutNode | null
}

export interface Settings {
  fontFamily: TerminalFont
  fontSize: number
  theme: ThemePreference
  accent: AccentName
  terminalPalette: TerminalPalette
  defaultAccountId: string | null
  defaultCwd: string
  sidebarCollapsed: boolean
  /** Expanded sidebar width in px; dragged from its right edge. */
  sidebarWidth: number
  /** Changes (git diff) panel width in px; dragged from its left edge. */
  diffWidth: number
  /**
   * 'overall': every account links to the machine's ~/.claude CLAUDE.md, settings,
   * skills and plugins. 'per-account': each account keeps its own.
   */
  sharedMode: SharedMode
  /** Ask GitHub for a newer release once at startup. */
  checkUpdatesOnLaunch: boolean
  /** OS notification when a pane you aren't looking at finishes or needs approval. */
  notifyPanes: boolean
  /** The shell plain shell panes run: a path or a name on PATH. Empty: automatic. */
  shellPath: string
  /** Arguments for `shellPath`, e.g. `--login -i` for Git Bash. */
  shellArgs: string[]
}

export const CONFIG_VERSION = 1

export interface Config {
  version: typeof CONFIG_VERSION
  /** Override for the claude binary. Empty string means auto-detect from PATH. */
  claudePath: string
  accounts: Account[]
  accountFolders: AccountFolder[]
  workspaces: Workspace[]
  activeWorkspace: string
  recentFolders: string[]
  settings: Settings
}

export type PaneStatus = 'starting' | 'running' | 'idle' | 'approval' | 'exited' | 'login'

export const PANE_STATUS_LABEL: Record<PaneStatus, string> = {
  starting: 'starting',
  running: 'running',
  idle: 'idle',
  approval: 'needs approval',
  exited: 'exited',
  login: 'login needed'
}
