// Domain model shared by main, preload and renderer. Persisted shape lives in schema.ts.

export type ThemeName = 'dark' | 'light'

export const TERMINAL_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'IBM Plex Mono',
  'Source Code Pro'
] as const
export type TerminalFont = (typeof TERMINAL_FONTS)[number]

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 20
export const DENSE_FONT_SIZE = 11

export const ACCOUNT_COLORS = [
  { name: 'violet', value: '#7c5cff' },
  { name: 'teal', value: '#2dd4bf' },
  { name: 'amber', value: '#f5a524' },
  { name: 'rose', value: '#f43f5e' }
] as const

export interface Account {
  id: string
  name: string
  /** Passed to the CLI as CLAUDE_CONFIG_DIR. May start with `~`. Never read by Wraithgrid. */
  configDir: string
  color: string
  /** Wraithgrid's own flag. It is never derived from files inside configDir. */
  signedIn: boolean
  imported: boolean
}

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
  /** Every pane in the workspace. Panes missing from `layout` are hidden, not closed. */
  panes: Pane[]
  layout: LayoutNode | null
}

export interface Settings {
  fontFamily: TerminalFont
  fontSize: number
  theme: ThemeName
  defaultAccountId: string | null
  defaultCwd: string
  sidebarCollapsed: boolean
}

export const CONFIG_VERSION = 1

export interface Config {
  version: typeof CONFIG_VERSION
  /** Override for the claude binary. Empty string means auto-detect from PATH. */
  claudePath: string
  accounts: Account[]
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
