import type { AgentCli } from './agent-clis'
import type { ChatEffort, ChatMode } from './chat'

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

/** How an agent pane is shown: a chat over the CLI's headless mode, or its own terminal UI. */
export const PANE_VIEWS = ['chat', 'terminal'] as const
export type PaneView = (typeof PANE_VIEWS)[number]

/** What closing the window does while agents run: ask, stop them, or keep them running. */
export const CLOSE_MODES = ['ask', 'stop', 'keep'] as const
export type CloseMode = (typeof CLOSE_MODES)[number]

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 13

/** App zoom (Ctrl+= / Ctrl+- / Ctrl+0), the steps a browser uses. */
export const UI_ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

/** The next zoom step up (+1) or down (-1) from `z`; 0 resets to 100%. */
export function stepZoom(z: number, delta: -1 | 0 | 1): number {
  if (delta === 0) return 1
  const steps = UI_ZOOM_STEPS as readonly number[]
  if (delta > 0) return steps.find((s) => s > z + 0.001) ?? steps[steps.length - 1]!
  return [...steps].reverse().find((s) => s < z - 0.001) ?? steps[0]!
}
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 236
export const DIFF_WIDTH_MIN = 280
export const DIFF_WIDTH_MAX = 1000
export const DIFF_WIDTH_DEFAULT = 440
export const DENSE_FONT_SIZE = 11
export const MOD_DIRS_MAX = 16
/** A pane a mod opens unasked is seated from this many columns (claude's own rule). */
export const MOD_PANE_MIN_COLS = 110

export const ACCOUNT_COLORS = [
  { name: 'violet', value: '#7c5cff' },
  { name: 'teal', value: '#2dd4bf' },
  { name: 'amber', value: '#f5a524' },
  { name: 'rose', value: '#f43f5e' }
] as const

export {
  AGENT_CLIS,
  AGENT_CLI_LABEL,
  AGENT_CLI_BIN,
  AGENT_CLI_SPECS,
  type AgentCli
} from './agent-clis'
/** App shortcuts a user can rebind; focus arrows, workspace digits and font size stay fixed. */
export const SHORTCUT_IDS = [
  'newPane',
  'closePane',
  'toggleZoom',
  'palette',
  'diff',
  'shortcuts'
] as const
export type ShortcutId = (typeof SHORTCUT_IDS)[number]

export interface Account {
  id: string
  name: string
  /** Which CLI its panes run. */
  cli: AgentCli
  /**
   * Passed to the CLI in its config-dir variable (AGENT_CLI_SPECS[cli].configDirVar); unused
   * by CLIs without one. May start with `~`. Never read by Wraithgrid.
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
  /** Continue the pane's conversation when Wraithgrid restores it (the per-pane toggle). */
  resume: boolean
  /** Something was sent to the agent, so there is a conversation to continue. */
  hasConversation: boolean
  /** Chat or terminal; shell panes and CLIs without a chat adapter are always terminals. */
  view: PaneView
  /** The chat view's conversation id, resumed when the pane starts again. */
  chatSessionId: string | null
  /** The chat's model (a CLI alias like `sonnet`); null: the account's default. */
  model: string | null
  /** The chat's effort level; null: the CLI's default. */
  effort: ChatEffort | null
  /** The chat's permission mode; null: the CLI's default (ask before edits). */
  chatMode: ChatMode | null
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
  /** The machine its panes run on (H5); null: this computer. */
  machineId: string | null
  /** Chats closed here, newest first: the project screen's History, reopened from there. */
  history: ArchivedChat[]
}

/** A closed chat, kept so it can be reopened and carry on (its saved view keeps its id). */
export interface ArchivedChat {
  pane: Pane
  closedAt: number
}

/** History entries kept per project; older ones are dropped with their saved views. */
export const HISTORY_MAX = 100

/** Another computer whose Wraithgrid runs this workspace's panes, reached with `ssh` (H5). */
export interface Machine {
  id: string
  name: string
  /** What `ssh` connects to: a Host from ~/.ssh/config, or [user@]host. */
  sshHost: string
}

export interface Settings {
  fontFamily: TerminalFont
  fontSize: number
  /** The whole app's zoom factor, 0.67–2. */
  uiZoom: number
  /** Dark, light, or follow the OS; which theme each mode draws is themeDark / themeLight. */
  theme: ThemePreference
  themeDark: string
  themeLight: string
  /** `theme` keeps the theme's own accent. */
  accent: AccentName | 'theme'
  terminalPalette: TerminalPalette
  defaultAccountId: string | null
  defaultCwd: string
  /** Folders pinned at the top of the New chat folder picker. */
  pinnedFolders: string[]
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
  /** Binary overrides for the non-claude CLIs; a missing or empty entry is found on PATH. */
  cliPaths: Partial<Record<AgentCli, string>>
  /** Rebound shortcuts as `mod+shift+KeyN` (key codes); a missing entry keeps the default. */
  shortcuts: Partial<Record<ShortcutId, string>>
  /**
   * Local mod folders (claude plugins under development) that every claude pane loads,
   * passed as CLAUDE_CODE_PLUGIN_DIRS. May start with `~`.
   */
  modDirs: string[]
  /** Draw visible terminals with the GPU, so frame-rate redraws (mod animations) stay smooth. */
  gpuTerminal: boolean
  /** Closing the window with agents running (ADR 0001); `ask` until the user remembers one. */
  onWindowClose: CloseMode
  /** Let `wraithgrid list|read|send|wait|new|split|stop` reach panes (H6). Off by default. */
  cliAccess: boolean
  /** How new agent panes open, when their CLI has a chat view (ADR 0002). */
  newPaneView: PaneView
  /** Model and effort new chats start with; null: the CLI's default. */
  chatModel: string | null
  chatEffort: ChatEffort | null
  /** Permission mode for new chats; null: ask before edits. */
  chatMode: ChatMode | null
}

export const CONFIG_VERSION = 1

export interface Config {
  version: typeof CONFIG_VERSION
  /** Override for the claude binary. Empty string means auto-detect from PATH. */
  claudePath: string
  accounts: Account[]
  accountFolders: AccountFolder[]
  workspaces: Workspace[]
  machines: Machine[]
  activeWorkspace: string
  recentFolders: string[]
  settings: Settings
}

/** `done`: a run finished while the user looked elsewhere; it turns `idle` once seen. */
export type PaneStatus = 'starting' | 'running' | 'idle' | 'done' | 'approval' | 'exited' | 'login'

export const PANE_STATUS_LABEL: Record<PaneStatus, string> = {
  starting: 'starting',
  running: 'running',
  idle: 'idle',
  done: 'done',
  approval: 'needs approval',
  exited: 'exited',
  login: 'login needed'
}
