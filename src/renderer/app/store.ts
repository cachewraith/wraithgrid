import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  AccountMods,
  AppInfo,
  ClaudeDetectResult,
  CliAction,
  CliActionResult,
  GitStatus,
  ModInfo,
  PtyExitEvent,
  ReleaseNotesView,
  SharedReportEntry,
  UpdateCheckResult,
  UpdateProgress,
  WraithApi
} from '@shared/ipc-contract'
import {
  AGENT_CLI_LABEL,
  AGENT_PROVIDER_LABEL,
  AGENT_CLI_SPECS,
  CONTINUE_AS_CLIS,
  DIALOG_LOGIN_CLIS
} from '@shared/agent-clis'
import type {
  ApprovalDecision,
  ChatAccountInfo,
  ChatEffort,
  ChatMode,
  ChatImage,
  ChatModel
} from '@shared/chat'
import { baseName, slugify } from '@shared/paths'
import { PROJECT_ICON_ID } from '@shared/project-icons'
import { defaultConfig } from '@shared/schema'
import { EMPTY_USAGE, type UsageData } from '@shared/usage'
import {
  BUILT_IN_THEMES,
  pickTheme,
  withAccent,
  type AppTheme,
  type ThemeFile
} from '@shared/themes'
import {
  ACCOUNT_COLORS,
  type Account,
  type AgentCli,
  type Config,
  type LayoutNode,
  type Pane,
  type PaneStatus,
  type PaneView,
  resolveTheme,
  type Settings,
  type SharedMode,
  type ThemeName,
  type Workspace,
  HISTORY_MAX
} from '@shared/types'
import { neighborInDirection, type Direction } from '../layout/focus'
import { buildPreset, type PresetId } from '../layout/presets'
import {
  autoGrid,
  normalizeLayout,
  paneIds,
  placeNewPane,
  removePane,
  setSizesAt,
  swapPanes,
  type Path
} from '../layout/tree'
import { buildHandoff } from '../lib/chat-handoff'
import { decideSwitch } from '../lib/auto-switch'
import { newId } from '../lib/ids'
import type { ChatBus } from '../lib/chat-bus'
import type { PtyBus } from '../lib/pty-bus'
import type { RectRegistry } from '../lib/scheduling'
import { StaggeredQueue } from '../lib/scheduling'
import { deriveStatus, lastErrorLine } from '../lib/status'
import { setShortcutBindings } from './shortcuts'

export interface ExitInfo {
  code: number
  signal: number | null
  at: number
  message: string | null
  /** The process never started (bad binary, missing folder). */
  spawnError: boolean
}

export interface PaneRuntime {
  requested: boolean
  started: boolean
  pid: number | null
  status: PaneStatus
  exit: ExitInfo | null
  /** Opened from an account's Login action. */
  loginFlow: boolean
  /** The user pressed "Run /login" in the banner. */
  loginStarted: boolean
  /** When it last ran (the sidebar's "2m"); null until it has, this session. */
  activeAt: number | null
}

/** `project`: the active workspace's chats and history (the sidebar's project click). */
export type View = 'grid' | 'project' | 'accounts' | 'mods' | 'settings' | 'usage'
export type AccountsMode = 'list' | 'add' | 'import'
export type Modal =
  | { kind: 'newPane'; slotId: string | null }
  | { kind: 'shortcuts' }
  | { kind: 'workspaces' }
  | { kind: 'newProject' }
  | { kind: 'removeAccount'; accountId: string }
  | { kind: 'palette' }
  | { kind: 'removeWorktree'; cwd: string; title: string }
  | { kind: 'deleteChat'; wsId: string; paneId: string }
  | { kind: 'switchChatAccount'; paneId: string; accountId: string }
  | { kind: 'login'; accountId: string }
  /** `at`: where it was opened (a right-click); null: centred (the palette). */
  | { kind: 'branches'; paneId: string; at: { x: number; y: number } | null }
  | { kind: 'projectIcon'; wsId: string }

export interface NewProjectInput {
  name: string
  /** The project's folder; '' = none picked. */
  folder: string
  /** Default account for its chats; null: the app-wide default. */
  accountId: string | null
  /** Where its panes run (H5); null: this computer. */
  machineId: string | null
  /** Open the first chat right away (needs a folder and an account). */
  startChat: boolean
}

export interface NewPaneInput {
  accountId: string | null
  cwd: string
  args: string[]
  shell: boolean
  slotId: string | null
  /** Overrides settings.newPaneView (a `wraithgrid new` pane must be a terminal). */
  view?: PaneView
}

export interface AppState {
  ready: boolean
  config: Config
  info: AppInfo
  claude: ClaudeDetectResult | null
  /** What the last change to CLAUDE.md/skills sharing did, for Settings to show. */
  sharedReport: SharedReportEntry[] | null
  runtime: Record<string, PaneRuntime>
  view: View
  accountsMode: AccountsMode
  modal: Modal | null
  focusedPaneId: string | null
  zoomedPaneId: string | null
  closingPaneId: string | null
  /** Workspaces whose panes have been started this session. */
  activated: Record<string, true>
  /** The OS light/dark setting, used when the theme is `system`. */
  systemTheme: ThemeName
  update: {
    checking: boolean
    result: UpdateCheckResult | null
    /** An in-app install in progress, and the last one's error. */
    install: UpdateProgress
    installError: { error: string; manual: boolean } | null
    /** Release notes for About (installed + earlier versions), kept across updates. */
    notes: ReleaseNotesView | null
    /** "Updated to …" shown once after an update; null once seen or dismissed. */
    updatedTo: string | null
  }
  /** A Settings section to scroll to once, then cleared. */
  settingsAnchor: 'updates' | null
  /** Branch and change count per pane, polled for the active workspace. */
  git: Record<string, GitStatus>
  /** The diff panel beside the grid, showing the focused pane's folder. */
  diffOpen: boolean
  /** Each account's plan and models, as its CLI said when a chat last started (not saved). */
  accountInfo: Record<string, { info: ChatAccountInfo | null; models: ChatModel[] }>
  /** Installed mods per claude account, as each account's CLI last listed them. */
  mods: { loading: boolean; accounts: AccountMods[] | null }
  /** Built-in themes, then the user's from ~/.wraithgrid/themes. */
  themes: AppTheme[]
  /** The theme editor's draft (#24): drawn over the whole app while it is open. */
  themeDraft: ThemeFile | null
  /** Theme files that could not be loaded, and why. */
  themeProblems: { file: string; error: string }[]
  /** Chat usage and plan limits from main; limits also update live from chat events. */
  usage: UsageData

  init(): Promise<void>
  updateConfig(fn: (c: Config) => Config): void

  // panes
  requestStart(paneId: string): void
  createPane(input: NewPaneInput): string
  closePane(paneId: string, force?: boolean): void
  cancelClose(): void
  restartPane(paneId: string): void
  /** Notes that a prompt was sent to an agent pane, so a restore can continue it. */
  markConversation(paneId: string): void
  /** The per-pane "continue the conversation on restore" toggle. */
  setPaneResume(paneId: string, resume: boolean): void
  /** Chat or terminal (ADR 0002): stops the pane's process and starts it in the other view. */
  setPaneView(paneId: string, view: PaneView): void
  chatSend(paneId: string, text: string, images: ChatImage[]): void
  chatApprove(paneId: string, reqId: string, decision: ApprovalDecision): void
  chatInterrupt(paneId: string): void
  /** Starts a new conversation in a chat pane; the old one stays in the CLI's history. */
  chatNew(paneId: string): void
  /** Switches a chat's model; a running chat switches at once. */
  chatSetModel(paneId: string, model: string | null): void
  /** Switches a chat's permission mode; live when it runs, else at its next start. */
  chatSetMode(paneId: string, mode: ChatMode): void
  /** Sets a chat's effort; the chat restarts and carries on the conversation. */
  chatSetEffort(paneId: string, effort: ChatEffort | null): void
  /**
   * Carries the chat on as another account of its CLI (claude, codex): its conversation is
   * copied there, then the
   * chat restarts as that account and resumes. Returns why it could not, or null.
   */
  chatSwitchAccount(paneId: string, accountId: string): Promise<string | null>
  /** Opens a project's screen: its open chats and history. */
  openProject(wsId: string): void
  /** Reopens a closed chat from History; it carries on its conversation. */
  reopenChat(wsId: string, paneId: string): void
  /** Deletes a chat, open (stops it, not archived) or in History, with its saved view. */
  deleteChat(wsId: string, paneId: string): void
  /** The pane's name in its header and the sidebar; empty goes back to the folder name. */
  renamePane(paneId: string, title: string): void
  focusPane(paneId: string | null): void
  focusDirection(dir: Direction): void
  toggleZoom(paneId?: string): void
  /** Types into a terminal pane as if from the keyboard. */
  typeInPane(paneId: string, text: string): void
  runLogin(paneId: string): void
  /** Switches to the pane's workspace, puts it in the grid if hidden, and focuses it. */
  revealPane(paneId: string): void
  refreshGit(): Promise<void>
  /** Checks out a branch in a pane's folder; returns git's error, or null. */
  switchBranch(
    paneId: string,
    kind: 'local' | 'remote' | 'create',
    name: string
  ): Promise<string | null>
  toggleDiff(open?: boolean): void
  /** A notification the pane's program asked its terminal for (e.g. a mod's `$.ui.notify`). */
  paneNotice(paneId: string, title: string, body: string): void

  // layout
  applyPreset(id: PresetId): void
  showAllPanes(): void
  swap(a: string, b: string): void
  setSplitSizes(path: Path, sizes: number[]): void

  // workspaces
  switchWorkspace(id: string): void
  switchWorkspaceIndex(index: number): void
  /** Creates a project (workspace) from the New project dialog; returns an error to show, or null. */
  createProject(input: NewProjectInput): string | null
  renameWorkspace(id: string, name: string): void
  /** A project's icon (#80): `set:name`, or '' for the plain folder. */
  setWorkspaceIcon(id: string, icon: string): void
  /** Runs a workspace's panes on a machine (H5), or here with null; only while it has none. */
  setWorkspaceMachine(id: string, machineId: string | null): void
  /** Adds a machine reached over ssh; returns an error to show, or null. */
  addMachine(name: string, sshHost: string): string | null
  /** Removes a machine; its workspaces run here again (their panes there keep running). */
  removeMachine(id: string): void
  deleteWorkspace(id: string): void

  // accounts
  addAccount(name: string, color: string, cli?: AgentCli): Promise<string | null>
  importAccount(dir: string): string | null
  renameAccount(id: string, name: string): void
  /** null moves the account out of any folder. */
  moveAccountToFolder(id: string, folderId: string | null): void
  createFolder(name: string): string | null
  renameFolder(id: string, name: string): void
  toggleFolder(id: string): void
  /** The folder's accounts move to the top level; none are removed. */
  deleteFolder(id: string): void
  removeAccount(id: string, deleteDir: boolean): Promise<string | null>
  markSignedIn(id: string): void
  /** 'overall' links ~/.claude into every account; 'per-account' takes the links out. */
  setSharedMode(mode: SharedMode): Promise<string | null>
  /** Restarts every started claude pane, e.g. so a new CLAUDE.md or skill is picked up. */
  restartClaudePanes(): number
  /** Signs an account in: a dialog for claude, a pane running the CLI's own login otherwise. */
  loginAccount(id: string): void
  /** Opens a pane running the CLI so it can sign in there. */
  loginInTerminal(id: string): void

  // mods
  loadMods(): Promise<void>
  /** Enables or disables one listed mod; resolves an error message, or null. */
  setModEnabled(accountId: string, mod: ModInfo, enabled: boolean): Promise<string | null>

  loadUsage(): Promise<void>

  // themes
  loadThemes(): Promise<void>
  /** Draws this theme now; it also becomes the theme for its mode when following the OS. */
  chooseTheme(id: string): void
  /** Asks for a theme file and adds it; resolves an error message, or null. */
  importTheme(): Promise<string | null>
  /** Shows a draft theme live (null: back to the chosen one). */
  setThemeDraft(t: ThemeFile | null): void
  /** Saves the draft as a new theme and switches to it; returns why it could not, or null. */
  saveThemeDraft(): Promise<string | null>
  deleteTheme(id: string): Promise<string | null>

  // settings
  updateSettings(patch: Partial<Settings>): void
  setClaudePath(path: string): void
  detectClaude(): Promise<void>
  setSystemTheme(theme: ThemeName): void
  checkForUpdates(reason: 'launch' | 'manual'): Promise<void>
  /** Downloads the newest release; it then waits (`ready`) for restartToUpdate. */
  installUpdate(): Promise<void>
  /** Installs the downloaded release; the app restarts. */
  restartToUpdate(): Promise<void>
  cancelUpdate(): void
  /** Hides the one-time "Updated to …" notice. */
  dismissUpdated(): void

  // ui
  setView(view: View): void
  setAccountsMode(mode: AccountsMode): void
  openModal(modal: Modal): void
  closeModal(): void
  toggleSidebar(): void
  /** Opens Settings at the updates section. */
  showUpdates(): void
  clearSettingsAnchor(): void
}

export interface StoreDeps {
  api: WraithApi
  bus: PtyBus
  chat: ChatBus
  rects: RectRegistry
  now?: () => number
  /** Whether the window has the user's attention; notifications only fire when it doesn't. */
  windowFocused?: () => boolean
}

/** A pane must have worked this long before going quiet counts as "finished". */
export const NOTIFY_MIN_RUN_MS = 8000
/** Git status refresh for the active workspace's panes. */
const GIT_POLL_MS = 5000

// ---- Selectors ---------------------------------------------------------------------

export function activeWorkspace(s: Pick<AppState, 'config'>): Workspace {
  const { workspaces, activeWorkspace: id } = s.config
  return workspaces.find((w) => w.id === id) ?? workspaces[0]!
}

export function findPane(config: Config, paneId: string): { ws: Workspace; pane: Pane } | null {
  for (const ws of config.workspaces) {
    const pane = ws.panes.find((p) => p.id === paneId)
    if (pane) return { ws, pane }
  }
  return null
}

/** The theme being drawn: the user's pick, or the OS setting for `system`. */
export function currentTheme(s: Pick<AppState, 'config' | 'systemTheme'>): ThemeName {
  return resolveTheme(s.config.settings.theme, s.systemTheme === 'dark')
}

const drawnCache = new WeakMap<AppTheme, Map<string, ThemeFile>>()

/** The theme being drawn, with the accent laid over it. Same inputs, same object. */
export function drawnTheme(
  s: Pick<AppState, 'config' | 'systemTheme' | 'themes'> & { themeDraft?: ThemeFile | null }
): ThemeFile {
  if (s.themeDraft) return s.themeDraft
  const mode = currentTheme(s)
  const { themeDark, themeLight, accent } = s.config.settings
  const t = pickTheme(s.themes, mode === 'dark' ? themeDark : themeLight, mode)
  let byAccent = drawnCache.get(t)
  if (!byAccent) drawnCache.set(t, (byAccent = new Map()))
  let d = byAccent.get(accent)
  if (!d) byAccent.set(accent, (d = withAccent(t, accent)))
  return d
}

/** Same rule as the config schema's ssh host: no leading `-`, no spaces or quotes. */
const SSH_HOST = /^[A-Za-z0-9_.@%:[\]][A-Za-z0-9_.@%:[\]-]*$/

export function accountById(config: Config, id: string | null): Account | undefined {
  return id ? config.accounts.find((a) => a.id === id) : undefined
}

/**
 * How a pane is shown. Chat only for an agent pane whose CLI has a chat adapter and runs
 * on this computer (ADR 0002); everything else is a terminal, whatever was saved.
 */
export function paneView(config: Config, paneId: string): PaneView {
  const found = findPane(config, paneId)
  if (!found || found.pane.shell || found.pane.view !== 'chat' || found.ws.machineId)
    return 'terminal'
  const cli = accountById(config, found.pane.accountId)?.cli ?? 'claude'
  return AGENT_CLI_SPECS[cli].chat ? 'chat' : 'terminal'
}

/** Whether the pane could be shown as a chat (the header's Chat/Terminal switch). */
export function canChat(config: Config, paneId: string): boolean {
  const found = findPane(config, paneId)
  if (!found || found.pane.shell || found.ws.machineId) return false
  return AGENT_CLI_SPECS[accountById(config, found.pane.accountId)?.cli ?? 'claude'].chat
}

/** A pane's name before anyone named it: its folder (`home` for ~), or `shell`. */
export function autoTitle(pane: Pick<Pane, 'shell' | 'cwd'>): string {
  return pane.shell ? 'shell' : baseName(pane.cwd) === '~' ? 'home' : baseName(pane.cwd)
}

/** A chat's name from its first message, like a chat app's history: one line, ~6 words. */
export function titleFromMessage(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 48) return line
  const cut = line.slice(0, 48)
  const word = cut.lastIndexOf(' ')
  return `${(word > 24 ? cut.slice(0, word) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

/** Six or more visible panes switch to the compact 8-pane density. */
export const DENSE_PANE_COUNT = 6

export function visiblePaneIds(s: Pick<AppState, 'config' | 'zoomedPaneId'>): string[] {
  const ws = activeWorkspace(s)
  if (s.zoomedPaneId && ws.panes.some((p) => p.id === s.zoomedPaneId)) return [s.zoomedPaneId]
  return paneIds(ws.layout)
}

export function nextFreeColor(accounts: Account[]): string {
  const used = new Set(accounts.map((a) => a.color.toLowerCase()))
  const free = ACCOUNT_COLORS.find((c) => !used.has(c.value))
  return (free ?? ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length]!).value
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base || 'account'
  for (let i = 2; taken.has(slug); i++) slug = `${base || 'account'}-${i}`
  return slug
}

function freshRuntime(extra: Partial<PaneRuntime> = {}): PaneRuntime {
  return {
    requested: false,
    started: false,
    pid: null,
    status: 'starting',
    exit: null,
    loginFlow: false,
    loginStarted: false,
    activeAt: null,
    ...extra
  }
}

function withWorkspace(config: Config, wsId: string, fn: (w: Workspace) => Workspace): Config {
  return { ...config, workspaces: config.workspaces.map((w) => (w.id === wsId ? fn(w) : w)) }
}

/** Repairs every workspace's tree against its panes; a missing tree is auto-arranged. */
export function normalizeWorkspaces(config: Config): Config {
  return {
    ...config,
    workspaces: config.workspaces.map((w) => {
      const ids = w.panes.map((p) => p.id)
      const layout = normalizeLayout(w.layout, ids) ?? autoGrid(ids)
      return { ...w, layout }
    })
  }
}

/** A folder Wraithgrid made with "Work on a new branch" (main saves them home-relative). */
export function isWorktreeCwd(cwd: string): boolean {
  return cwd.replace(/\\/g, '/').startsWith('~/.wraithgrid/worktrees/')
}

const RESTART_MARK = (t: Date): string =>
  `\r\n\x1b[2m— restarted ${t.toTimeString().slice(0, 5)} —\x1b[0m\r\n`

// ---- Store -------------------------------------------------------------------------

export function createAppStore({
  api,
  bus,
  chat,
  rects,
  now = () => Date.now(),
  windowFocused = () => typeof document === 'undefined' || document.hasFocus()
}: StoreDeps): StoreApi<AppState> {
  const startQueue = new StaggeredQueue(150, now)
  /** When each pane last started running, to tell real work from a brief redraw. */
  const runningSince = new Map<string, number>()
  /** Panes started at least once since launch (created here, or restored and started). */
  const spawned = new Set<string>()
  /** When each pane's last unseen run ended (its "done" status). */
  const doneAt = new Map<string, number>()
  /** Panes just switched between chat and terminal: the next start continues the conversation. */
  const switched = new Set<string>()

  const store = createStore<AppState>()((set, get) => {
    const patchRuntime = (paneId: string, patch: Partial<PaneRuntime>): void => {
      const cur = get().runtime[paneId]
      if (!cur) return
      set({ runtime: { ...get().runtime, [paneId]: { ...cur, ...patch } } })
    }

    /** Changes one pane's saved fields, wherever its workspace is. */
    const patchPane = (paneId: string, patch: Partial<Pane>): void => {
      const found = findPane(get().config, paneId)
      if (!found) return
      get().updateConfig((c) =>
        withWorkspace(c, found.ws.id, (w) => ({
          ...w,
          panes: w.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p))
        }))
      )
    }

    /**
     * Restarts a chat without a word in the view: its conversation resumes by id. For start-up
     * flags (effort), and for a CLI that can't stop a turn or switch model/mode live (agy).
     */
    const restartChatQuietly = (paneId: string): void => {
      if (!get().runtime[paneId]?.requested) return
      api.chat.stop(paneId, false)
      set({ runtime: { ...get().runtime, [paneId]: freshRuntime({ requested: true }) } })
      startQueue.push(() => void spawn(paneId))
    }

    const spawnChat = async (paneId: string, pane: Pane): Promise<void> => {
      switched.delete(paneId)
      await chat.load(paneId)
      if (!pane.accountId) return
      const res = await api.chat.start({
        paneId,
        accountId: pane.accountId,
        cwd: pane.cwd,
        args: pane.args,
        sessionId: pane.chatSessionId,
        // A conversation begun in the terminal view carries on here.
        continueLast: !pane.chatSessionId && pane.hasConversation && pane.resume,
        model: pane.model,
        effort: pane.effort,
        mode: pane.chatMode
      })
      if (!get().runtime[paneId]) {
        if (res.ok) api.chat.stop(paneId, false)
        return
      }
      if (res.ok) {
        patchRuntime(paneId, { started: true, pid: res.pid, exit: null })
        if (
          !pane.hasConversation &&
          chat.thread(paneId).items.some((it) => it.kind === 'handoff')
        ) {
          chat.sendPreparedHandoff(paneId)
          get().markConversation(paneId)
        }
      } else {
        chat.notice(paneId, 'error', res.error)
        patchRuntime(paneId, {
          started: false,
          pid: null,
          status: 'exited',
          exit: { code: -1, signal: null, at: now(), message: res.error, spawnError: true }
        })
      }
    }

    const spawn = async (paneId: string): Promise<void> => {
      const found = findPane(get().config, paneId)
      if (!found) return
      const { pane } = found
      if (paneView(get().config, paneId) === 'chat') return spawnChat(paneId, pane)
      const { cols, rows } = bus.size(paneId)
      // Only a pane's first start after launch resumes; a restart or a new pane starts fresh.
      const restored = !spawned.has(paneId)
      spawned.add(paneId)
      const fromChat = switched.delete(paneId)
      const cli = accountById(get().config, pane.accountId)?.cli ?? 'claude'
      bus.setApprovalPattern(paneId, pane.shell ? null : AGENT_CLI_SPECS[cli].approval)
      const res = await api.pty.create({
        paneId,
        accountId: pane.shell ? null : pane.accountId,
        cwd: pane.cwd,
        args: pane.args,
        shell: pane.shell,
        resume: (restored || fromChat) && !pane.shell && pane.resume && pane.hasConversation,
        attach: restored && !fromChat,
        cols,
        rows
      })
      // The pane may have been closed while the process was starting.
      if (!get().runtime[paneId]) {
        if (res.ok) api.pty.kill(paneId)
        return
      }
      if (res.ok && res.exit) {
        // Reattached to a pane that ended while Wraithgrid was closed.
        patchRuntime(paneId, { started: true, pid: res.pid, exit: null })
        onExit({ paneId, exitCode: res.exit.exitCode, signal: res.exit.signal })
      } else if (res.ok) patchRuntime(paneId, { started: true, pid: res.pid, exit: null })
      else {
        bus.writeLocal(paneId, `\x1b[31m${res.error}\x1b[0m\r\n`)
        patchRuntime(paneId, {
          started: false,
          pid: null,
          status: 'exited',
          exit: { code: -1, signal: null, at: now(), message: res.error, spawnError: true }
        })
      }
    }

    const onExit = (e: PtyExitEvent): void => {
      if (!get().runtime[e.paneId]) return
      // The terminal this pane had before it switched to chat.
      if (paneView(get().config, e.paneId) === 'chat') return
      // The link to its machine dropped: Restart first tries to reattach, as at launch.
      if (e.disconnected) spawned.delete(e.paneId)
      patchRuntime(e.paneId, {
        status: 'exited',
        exit: {
          code: e.exitCode,
          signal: e.signal,
          at: now(),
          message: e.error ?? lastErrorLine(bus.tail(e.paneId)),
          spawnError: false
        }
      })
    }

    /** `wraithgrid new|split` (H6): picks the account, workspace and folder, then adds the pane. */
    const runCliAction = (action: CliAction): CliActionResult => {
      const c = get().config
      const byName = <T extends { id: string; name: string }>(
        list: T[],
        q: string
      ): T | undefined =>
        list.find((x) => x.id === q) ?? list.find((x) => x.name.toLowerCase() === q.toLowerCase())
      let base: Pane | undefined
      if (action.kind === 'split') {
        const found = findPane(c, action.paneId)
        if (!found) return { ok: false, error: `No pane ${action.paneId}.` }
        get().switchWorkspace(found.ws.id)
        get().focusPane(found.pane.id)
        base = found.pane
      } else if (action.workspace) {
        const ws = byName(c.workspaces, action.workspace)
        if (!ws) return { ok: false, error: `No workspace "${action.workspace}".` }
        get().switchWorkspace(ws.id)
      }
      const shell = action.shell ?? base?.shell ?? false
      let accountId: string | null = null
      if (!shell) {
        const focused = findPane(get().config, get().focusedPaneId ?? '')?.pane
        const account = action.account
          ? byName(c.accounts, action.account)
          : (accountById(c, (base ?? focused)?.accountId ?? null) ?? c.accounts[0])
        if (!account)
          return {
            ok: false,
            error: action.account ? `No account "${action.account}".` : 'Add an account first.'
          }
        accountId = account.id
      }
      const paneId = get().createPane({
        accountId,
        cwd: action.cwd ?? base?.cwd ?? '~',
        args: shell ? [] : (action.args ?? base?.args ?? []),
        shell,
        slotId: null,
        // The command line drives panes through the pty host, where chat panes do not run.
        view: 'terminal'
      })
      set({ view: 'grid' })
      return { ok: true, paneId }
    }

    const placePane = (ws: Workspace, paneId: string, slotId: string | null): LayoutNode => {
      const focused = get().focusedPaneId
      const r = focused ? rects.get(focused) : undefined
      return placeNewPane(ws.layout, paneId, {
        slotId,
        targetId: focused,
        dir: r && r.height > r.width ? 'col' : 'row'
      })
    }

    const addPaneToActive = (
      input: NewPaneInput,
      runtimeExtra: Partial<PaneRuntime> = {}
    ): string => {
      const s = get()
      const ws = activeWorkspace(s)
      const id = newId('p')
      const account = accountById(s.config, input.shell ? null : input.accountId)
      const pane: Pane = {
        id,
        accountId: input.shell ? null : input.accountId,
        cwd: input.cwd,
        args: input.shell ? [] : input.args,
        shell: input.shell,
        title: autoTitle(input),
        resume: true,
        hasConversation: false,
        // Signing in happens in the CLI's own screen, so a login pane is a terminal.
        view:
          runtimeExtra.loginFlow || (account && !account.signedIn)
            ? 'terminal'
            : (input.view ?? s.config.settings.newPaneView),
        chatSessionId: null,
        model: s.config.settings.chatModel,
        effort: s.config.settings.chatEffort,
        chatMode: s.config.settings.chatMode
      }
      spawned.add(id)
      const layout = placePane(ws, id, input.slotId)
      const recent = [input.cwd, ...s.config.recentFolders.filter((f) => f !== input.cwd)].slice(
        0,
        8
      )
      set({
        config: {
          ...withWorkspace(s.config, ws.id, (w) => ({ ...w, panes: [...w.panes, pane], layout })),
          recentFolders: recent
        },
        runtime: { ...s.runtime, [id]: freshRuntime(runtimeExtra) },
        focusedPaneId: id,
        zoomedPaneId: null,
        view: 'grid',
        modal: null
      })
      return id
    }

    /** Removes a pane; `archive` keeps it (and its saved chat view) in the project's History. */
    const dropPane = (paneId: string, archive = false): void => {
      api.pty.kill(paneId)
      api.chat.stop(paneId, !archive)
      chat.forget(paneId, archive)
      bus.forget(paneId)
      const s = get()
      const found = findPane(s.config, paneId)
      const runtime = { ...s.runtime }
      delete runtime[paneId]
      let config = s.config
      if (found) {
        const kept = archive ? [{ pane: found.pane, closedAt: now() }, ...found.ws.history] : null
        // Past the limit, the oldest entries go, with their saved views.
        kept?.slice(HISTORY_MAX).forEach((h) => api.chat.stop(h.pane.id, true))
        config = withWorkspace(config, found.ws.id, (w) => ({
          ...w,
          panes: w.panes.filter((p) => p.id !== paneId),
          layout: removePane(w.layout, paneId),
          history: kept ? kept.slice(0, HISTORY_MAX) : w.history
        }))
      }
      const nextFocus =
        s.focusedPaneId === paneId
          ? (paneIds(activeWorkspace({ config }).layout)[0] ?? null)
          : s.focusedPaneId
      set({
        config,
        runtime,
        focusedPaneId: nextFocus,
        zoomedPaneId: s.zoomedPaneId === paneId ? null : s.zoomedPaneId,
        closingPaneId: s.closingPaneId === paneId ? null : s.closingPaneId
      })
    }

    const updateActiveLayout = (fn: (ws: Workspace) => LayoutNode | null): void => {
      const s = get()
      const ws = activeWorkspace(s)
      set({ config: withWorkspace(s.config, ws.id, (w) => ({ ...w, layout: fn(w) })) })
    }

    /** Is the user looking at this pane right now? Then no notification is needed. */
    const attending = (paneId: string): boolean => {
      const s = get()
      return windowFocused() && s.view === 'grid' && visiblePaneIds(s).includes(paneId)
    }

    const maybeNotify = (paneId: string, from: PaneStatus, to: PaneStatus): void => {
      const asks = to === 'approval' && from !== 'approval'
      const done = to === 'done' && from !== 'done'
      const s = get()
      if ((!asks && !done) || !s.config.settings.notifyPanes) return
      const found = findPane(s.config, paneId)
      if (!found || found.pane.shell) return
      const bin = AGENT_CLI_SPECS[accountById(s.config, found.pane.accountId)?.cli ?? 'claude'].bin
      const where = `${found.pane.title} · ${found.ws.name}`
      if (asks)
        api.notify.pane(paneId, `${where} needs approval`, `${bin} is waiting for your answer.`)
      else api.notify.pane(paneId, `${where} is done`, `${bin} finished and is waiting for you.`)
    }

    /**
     * "done": a run of real work ended while the user was not looking, and they have not
     * looked or typed since. Looking at the pane turns it back into "idle".
     */
    const withDone = (paneId: string, from: PaneStatus, to: PaneStatus, t: number): PaneStatus => {
      // Background work (#39) is part of the run: "done" comes when it ends too.
      if (to === 'running' || to === 'background') {
        if (from !== 'running' && from !== 'background') runningSince.set(paneId, t)
        doneAt.delete(paneId)
        return to
      }
      const since = runningSince.get(paneId)
      runningSince.delete(paneId)
      if (to !== 'idle') {
        doneAt.delete(paneId)
        return to
      }
      if (
        (from === 'running' || from === 'background') &&
        since !== undefined &&
        t - since >= NOTIFY_MIN_RUN_MS
      )
        doneAt.set(paneId, t)
      const at = doneAt.get(paneId)
      if (at === undefined) return to
      if (attending(paneId) || (bus.activity(paneId)?.lastInputAt ?? 0) > at) {
        doneAt.delete(paneId)
        return to
      }
      return 'done'
    }

    const refreshStatuses = (): void => {
      const s = get()
      const t = now()
      let changed = false
      const runtime: Record<string, PaneRuntime> = {}
      for (const [paneId, rt] of Object.entries(s.runtime)) {
        const found = findPane(s.config, paneId)
        const account = found ? accountById(s.config, found.pane.accountId) : undefined
        const derived = rt.exit
          ? 'exited'
          : paneView(s.config, paneId) === 'chat'
            ? rt.started
              ? chat.status(paneId)
              : 'starting'
            : deriveStatus({
                started: rt.started,
                exited: false,
                loginNeeded: !!found && !found.pane.shell && !!account && !account.signedIn,
                activity: bus.activity(paneId),
                now: t
              })
        const status = withDone(paneId, rt.status, derived, t)
        // Minute precision is all the sidebar shows: refresh it every few seconds, not ticks.
        const activeAt =
          status === 'running' && (rt.activeAt === null || t - rt.activeAt >= 5000)
            ? t
            : rt.activeAt
        runtime[paneId] =
          status === rt.status && activeAt === rt.activeAt ? rt : { ...rt, status, activeAt }
        if (activeAt !== rt.activeAt) changed = true
        if (status !== rt.status) {
          changed = true
          if (!attending(paneId)) maybeNotify(paneId, rt.status, status)
        }
      }
      if (changed) set({ runtime })
    }

    return {
      ready: false,
      config: defaultConfig(),
      info: {
        homeDir: '',
        platform: '',
        configPath: '',
        version: '',
        chrome: 'custom',
        desktop: null
      },
      claude: null,
      sharedReport: null,
      runtime: {},
      view: 'grid',
      accountsMode: 'list',
      modal: null,
      focusedPaneId: null,
      zoomedPaneId: null,
      closingPaneId: null,
      activated: {},
      systemTheme: 'dark',
      update: {
        checking: false,
        result: null,
        install: { phase: 'idle' },
        installError: null,
        notes: null,
        updatedTo: null
      },
      settingsAnchor: null,
      git: {},
      diffOpen: false,
      mods: { loading: false, accounts: null },
      themes: BUILT_IN_THEMES,
      themeDraft: null,
      themeProblems: [],
      usage: EMPTY_USAGE,
      accountInfo: {},

      async init() {
        const [raw, info] = await Promise.all([api.config.get(), api.app.info()])
        const config = normalizeWorkspaces(raw)
        const ws = activeWorkspace({ config })
        bus.start()
        bus.onExit(onExit)
        chat.start()
        chat.onSession((paneId, id) => {
          const pane = findPane(get().config, paneId)?.pane
          if (pane && pane.chatSessionId !== id) patchPane(paneId, { chatSessionId: id })
        })
        chat.onCapabilities((paneId, e) => {
          const accountId = findPane(get().config, paneId)?.pane.accountId
          if (!accountId) return
          set({
            accountInfo: {
              ...get().accountInfo,
              [accountId]: { info: e.account, models: e.models }
            }
          })
        })
        let usageTimer: ReturnType<typeof setTimeout> | null = null
        chat.onUsage((paneId, e) => {
          if (e.t === 'limits') {
            const accountId = findPane(get().config, paneId)?.pane.accountId
            if (!accountId) return
            const usage = get().usage
            set({ usage: { ...usage, limits: { ...usage.limits, [accountId]: e.limits } } })
            return
          }
          if (e.usage && !usageTimer) {
            // Main has recorded the turn by now; read it back once things settle.
            usageTimer = setTimeout(() => {
              usageTimer = null
              void get().loadUsage()
            }, 400)
          }
          void autoSwitch(paneId, e.error)
        })

        // Switching account at the limit (#61): after a turn, a chat at its account's limit
        // carries on as the next account of its CLI with room, via "Continue as…" (the whole
        // conversation goes with it). A turn the limit refused is sent again there, once.
        const switching = new Set<string>()
        const toldNoneLeft = new Set<string>()
        const autoSwitch = async (paneId: string, error: string | null): Promise<void> => {
          if (!get().config.settings.autoSwitchAtLimit || switching.has(paneId)) return
          // The turn's end and "not busy" come as separate messages: let the turn settle.
          for (let i = 0; i < 40 && chat.thread(paneId).busy; i++)
            await new Promise((r) => setTimeout(r, 50))
          const s = get()
          if (switching.has(paneId)) return
          const pane = findPane(s.config, paneId)?.pane
          const from = pane ? accountById(s.config, pane.accountId) : null
          const thread = chat.thread(paneId)
          // Never under running background work: switching restarts the chat.
          if (!pane || !from || thread.busy || thread.background.length) return
          const d = decideSwitch(
            s.config.accounts,
            from,
            s.usage.limits,
            now(),
            s.config.settings.autoSwitchAt,
            error
          )
          if (d.kind === 'stay') {
            toldNoneLeft.delete(paneId)
            return
          }
          if (d.kind === 'none-left') {
            if (toldNoneLeft.has(paneId)) return
            toldNoneLeft.add(paneId)
            chat.notice(
              paneId,
              'error',
              `${d.reason}, and no other ${AGENT_CLI_LABEL[from.cli]} account has room left.`
            )
            return
          }
          toldNoneLeft.delete(paneId)
          const last = [...thread.items]
            .reverse()
            .find((it) => it.kind === 'user' || it.kind === 'handoff')
          switching.add(paneId)
          chat.notice(paneId, 'info', `${d.reason}: switching to ${d.to.name}`)
          const err = await get().chatSwitchAccount(paneId, d.to.id)
          switching.delete(paneId)
          if (err) {
            chat.notice(paneId, 'error', `Could not switch to ${d.to.name}: ${err}`)
            return
          }
          if (d.resend && (last?.kind === 'user' || last?.kind === 'handoff') && last.text.trim()) {
            // Once the new account's chat is up (a few seconds at most).
            const until = now() + 30_000
            const wait = setInterval(() => {
              if (get().runtime[paneId]?.started) {
                clearInterval(wait)
                if (last.kind === 'handoff') chat.sendPreparedHandoff(paneId)
                else get().chatSend(paneId, last.text, [])
              } else if (now() > until) clearInterval(wait)
            }, 200)
          }
        }
        // claude can change mode itself (leaving plan mode): the next start keeps that.
        chat.onMode((paneId, mode) => {
          const pane = findPane(get().config, paneId)?.pane
          const want = mode === 'default' ? null : mode
          if (pane && pane.chatMode !== want) patchPane(paneId, { chatMode: want })
        })
        chat.onExit((paneId, e) => {
          if (!get().runtime[paneId] || paneView(get().config, paneId) !== 'chat') return
          patchRuntime(paneId, {
            status: 'exited',
            exit: {
              code: e.code ?? -1,
              signal: e.signal,
              at: now(),
              message: e.error,
              spawnError: false
            }
          })
        })
        bus.onLoginDetected((paneId) => {
          const found = findPane(get().config, paneId)
          const account = found && accountById(get().config, found.pane.accountId)
          if (account && !account.signedIn) get().markSignedIn(account.id)
        })
        setInterval(refreshStatuses, 500)
        api.update.onProgress((install) => set({ update: { ...get().update, install } }))
        api.update.onShow(() => get().showUpdates())
        api.notify.onReveal((paneId) => get().revealPane(paneId))
        api.window.onCloseMode((onWindowClose) => get().updateSettings({ onWindowClose }))
        api.cli.onAction((id, action) => api.cli.reply(id, runCliAction(action)))
        setInterval(() => void get().refreshGit(), GIT_POLL_MS)
        set({
          config,
          info,
          ready: true,
          activated: { [ws.id]: true },
          focusedPaneId: paneIds(ws.layout)[0] ?? null
        })
        void get().detectClaude()
        void get().loadThemes()
        void get().loadUsage()
        void get().refreshGit()
        if (config.settings.checkUpdatesOnLaunch) void get().checkForUpdates('launch')
        void api.update.notes().then((notes) =>
          set({
            update: { ...get().update, notes, updatedTo: notes.updatedFrom ? notes.current : null }
          })
        )
      },

      updateConfig(fn) {
        set({ config: fn(get().config) })
      },

      // ---- panes ---------------------------------------------------------------

      requestStart(paneId) {
        const rt = get().runtime[paneId]
        if (rt?.requested) return
        set({
          runtime: { ...get().runtime, [paneId]: { ...(rt ?? freshRuntime()), requested: true } }
        })
        startQueue.push(() => void spawn(paneId))
      },

      createPane(input) {
        return addPaneToActive(input)
      },

      closePane(paneId, force = false) {
        const rt = get().runtime[paneId]
        if (
          !force &&
          rt &&
          (rt.status === 'running' || rt.status === 'approval' || rt.status === 'background')
        ) {
          set({ closingPaneId: paneId, focusedPaneId: paneId })
          return
        }
        const pane = findPane(get().config, paneId)?.pane
        // A conversation is kept in the project's History; an unused pane or a shell is not.
        dropPane(paneId, !!pane && !pane.shell && pane.hasConversation)
        // The last pane on a Wraithgrid worktree: offer to remove its folder.
        if (pane && isWorktreeCwd(pane.cwd) && !get().modal) {
          const used = get().config.workspaces.some((w) => w.panes.some((p) => p.cwd === pane.cwd))
          if (!used) set({ modal: { kind: 'removeWorktree', cwd: pane.cwd, title: pane.title } })
        }
      },

      cancelClose() {
        set({ closingPaneId: null })
      },

      restartPane(paneId) {
        if (!get().runtime[paneId]) return
        if (paneView(get().config, paneId) === 'chat') {
          api.chat.stop(paneId, false)
          chat.notice(paneId, 'info', 'Restarted')
        }
        bus.resetActivity(paneId)
        bus.writeLocal(paneId, RESTART_MARK(new Date(now())))
        set({
          runtime: {
            ...get().runtime,
            [paneId]: {
              ...freshRuntime(),
              requested: true,
              loginFlow: get().runtime[paneId]!.loginFlow
            }
          }
        })
        startQueue.push(() => void spawn(paneId))
      },

      markConversation(paneId) {
        const found = findPane(get().config, paneId)
        if (!found || found.pane.shell || found.pane.hasConversation) return
        patchPane(paneId, { hasConversation: true })
      },

      setPaneResume(paneId, resume) {
        patchPane(paneId, { resume })
      },

      setPaneView(paneId, view) {
        const rt = get().runtime[paneId]
        if (paneView(get().config, paneId) === view || !canChat(get().config, paneId)) return
        // Stop the old view's process; the new view starts its own when it mounts.
        if (view === 'terminal') api.chat.stop(paneId, false)
        else api.pty.kill(paneId)
        switched.add(paneId)
        bus.resetActivity(paneId)
        patchPane(paneId, { view })
        set({
          runtime: {
            ...get().runtime,
            [paneId]: freshRuntime({ loginFlow: rt?.loginFlow ?? false })
          }
        })
      },

      chatSend(paneId, text, images) {
        const pane = findPane(get().config, paneId)?.pane
        // The first message names a chat whose name was never changed.
        if (pane && !pane.hasConversation && text.trim() && pane.title === autoTitle(pane))
          patchPane(paneId, { title: titleFromMessage(text) })
        chat.send(paneId, text, images)
        get().markConversation(paneId)
      },

      chatSetModel(paneId, model) {
        patchPane(paneId, { model })
        if (chat.thread(paneId).controls?.live.model === false) return restartChatQuietly(paneId)
        // null (the default) needs the CLI's own default: claude names it `default`.
        if (get().runtime[paneId]?.started) api.chat.setModel(paneId, model ?? 'default')
      },

      chatSetMode(paneId, mode) {
        patchPane(paneId, { chatMode: mode === 'default' ? null : mode })
        if (chat.thread(paneId).controls?.live.mode === false) return restartChatQuietly(paneId)
        if (get().runtime[paneId]?.started) api.chat.setMode(paneId, mode)
      },

      chatSetEffort(paneId, effort) {
        if (findPane(get().config, paneId)?.pane.effort === effort) return
        patchPane(paneId, { effort })
        // Effort is a start-up flag: restart quietly; the conversation resumes by its id.
        restartChatQuietly(paneId)
      },

      async chatSwitchAccount(paneId, accountId) {
        const pane = findPane(get().config, paneId)?.pane
        if (!pane) return 'That chat is gone.'
        if (pane.accountId === accountId) return null
        const from = accountById(get().config, pane.accountId)
        const to = accountById(get().config, accountId)
        if (!to || !from) return 'That account is gone.'
        if (!to.signedIn) return `${to.name} is not signed in yet.`
        if (chat.thread(paneId).busy) return 'Wait for the answer to finish, or stop it first.'
        if (to.cli !== from.cli) {
          if (!AGENT_CLI_SPECS[to.cli].chat) {
            const found = findPane(get().config, paneId)!
            get().switchWorkspace(found.ws.id)
            addPaneToActive({
              accountId,
              cwd: pane.cwd,
              args: [],
              shell: false,
              view: 'terminal',
              slotId: null
            })
            return null
          }
          const found = findPane(get().config, paneId)!
          const handoff = buildHandoff(chat.thread(paneId).items, from.cli, from.name)
          const id = newId('p')
          const next: Pane = {
            ...pane,
            id,
            accountId,
            args: [],
            view: 'chat',
            resume: false,
            hasConversation: false,
            chatSessionId: null,
            model: null,
            effort: null,
            chatMode: null
          }
          // Preserve the original session and saved view under its original id. A new id also
          // isolates late process events and lets History reopen the source independently.
          api.chat.stop(paneId, false)
          chat.forget(paneId, true)
          api.pty.kill(paneId)
          bus.forget(paneId)
          const s = get()
          const history = [{ pane, closedAt: now() }, ...found.ws.history]
          history.slice(HISTORY_MAX).forEach((h) => api.chat.stop(h.pane.id, true))
          const replace = (node: LayoutNode | null): LayoutNode | null => {
            if (!node) return null
            if (node.type === 'empty') return node
            if (node.type === 'pane') return node.paneId === paneId ? { ...node, paneId: id } : node
            return { ...node, children: node.children.map((child) => replace(child)!) }
          }
          const runtime = { ...s.runtime }
          delete runtime[paneId]
          runtime[id] = freshRuntime({ requested: true })
          set({
            config: withWorkspace(s.config, found.ws.id, (w) => ({
              ...w,
              panes: w.panes.map((p) => (p.id === paneId ? next : p)),
              layout: replace(w.layout),
              history: history.slice(0, HISTORY_MAX)
            })),
            runtime,
            focusedPaneId: s.focusedPaneId === paneId ? id : s.focusedPaneId,
            zoomedPaneId: s.zoomedPaneId === paneId ? id : s.zoomedPaneId
          })
          const at = new Date(now()).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
          })
          chat.prepareHandoff(
            id,
            handoff,
            to.cli,
            `continued in ${AGENT_PROVIDER_LABEL[to.cli]} as ${to.name} · ${at}`
          )
          // Pane mounting calls requestStart; mark it requested above so only this start runs.
          await spawn(id)
          return null
        }
        const shared = AGENT_CLI_SPECS[from.cli].signIn === 'shared'
        if (!CONTINUE_AS_CLIS.includes(from.cli) && !shared)
          return 'This CLI cannot copy conversations between accounts.'
        const running = !!get().runtime[paneId]?.requested
        if (running) api.chat.stop(paneId, false)
        if (pane.chatSessionId && !shared) {
          const r = await api.chat.moveAccount(paneId, accountId, pane.chatSessionId)
          if (!r.ok) {
            // Nothing changed: carry on as before.
            if (running) {
              set({ runtime: { ...get().runtime, [paneId]: freshRuntime({ requested: true }) } })
              startQueue.push(() => void spawn(paneId))
            }
            return r.error
          }
        }
        patchPane(paneId, { accountId })
        const at = new Date(now()).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        })
        chat.notice(paneId, 'divider', `Continued as ${to.name} · ${at}`)
        // Restart as the new account; the conversation resumes by its id.
        set({ runtime: { ...get().runtime, [paneId]: freshRuntime({ requested: true }) } })
        startQueue.push(() => void spawn(paneId))
        return null
      },

      openProject(wsId) {
        if (!get().config.workspaces.some((w) => w.id === wsId)) return
        get().switchWorkspace(wsId)
        set({ view: 'project' })
      },

      reopenChat(wsId, paneId) {
        const ws = get().config.workspaces.find((w) => w.id === wsId)
        const entry = ws?.history.find((h) => h.pane.id === paneId)
        if (!ws || !entry || findPane(get().config, paneId)) return
        get().switchWorkspace(wsId)
        const s = get()
        const active = activeWorkspace(s)
        const layout = placePane(active, paneId, null)
        // Same id as before: its saved chat view loads, and its first start resumes.
        spawned.delete(paneId)
        set({
          config: withWorkspace(s.config, wsId, (w) => ({
            ...w,
            panes: [...w.panes, { ...entry.pane, resume: true }],
            layout,
            history: w.history.filter((h) => h.pane.id !== paneId)
          })),
          runtime: { ...s.runtime, [paneId]: freshRuntime() },
          focusedPaneId: paneId,
          zoomedPaneId: null,
          view: 'grid'
        })
      },

      deleteChat(wsId, paneId) {
        if (findPane(get().config, paneId)) return dropPane(paneId, false)
        get().updateConfig((c) =>
          withWorkspace(c, wsId, (w) => ({
            ...w,
            history: w.history.filter((h) => h.pane.id !== paneId)
          }))
        )
        api.chat.stop(paneId, true)
      },

      renamePane(paneId, title) {
        const pane = findPane(get().config, paneId)?.pane
        if (!pane) return
        patchPane(paneId, { title: title.trim().slice(0, 128) || autoTitle(pane) })
      },

      chatApprove(paneId, reqId, decision) {
        chat.approve(paneId, reqId, decision)
      },

      chatInterrupt(paneId) {
        // A CLI with no way to stop a turn (agy): end the process, carry on the conversation.
        if (chat.thread(paneId).controls?.live.interrupt === false) {
          chat.settle(paneId, 'Interrupted')
          return restartChatQuietly(paneId)
        }
        chat.interrupt(paneId)
      },

      chatNew(paneId) {
        if (paneView(get().config, paneId) !== 'chat') return
        const pane = findPane(get().config, paneId)?.pane
        // A new conversation is named by its own first message.
        patchPane(paneId, {
          chatSessionId: null,
          hasConversation: false,
          ...(pane ? { title: autoTitle(pane) } : {})
        })
        get().restartPane(paneId)
        // After the restart's own notice: a new conversation starts on an empty view.
        chat.clear(paneId)
      },

      focusPane(paneId) {
        if (get().focusedPaneId !== paneId) set({ focusedPaneId: paneId })
      },

      focusDirection(dir) {
        const s = get()
        if (s.zoomedPaneId || !s.focusedPaneId) {
          if (!s.focusedPaneId) set({ focusedPaneId: visiblePaneIds(s)[0] ?? null })
          return
        }
        const next = neighborInDirection(rects.all(), s.focusedPaneId, dir)
        if (next) set({ focusedPaneId: next })
      },

      toggleZoom(paneId) {
        const s = get()
        if (s.zoomedPaneId && (!paneId || paneId === s.zoomedPaneId)) {
          set({ zoomedPaneId: null })
          return
        }
        const ws = activeWorkspace(s)
        const target = paneId ?? s.focusedPaneId ?? paneIds(ws.layout)[0]
        if (target && ws.panes.some((p) => p.id === target)) {
          set({ zoomedPaneId: target, focusedPaneId: target, view: 'grid' })
        }
      },

      revealPane(paneId) {
        const found = findPane(get().config, paneId)
        if (!found) return
        if (get().config.activeWorkspace !== found.ws.id) get().switchWorkspace(found.ws.id)
        const ws = activeWorkspace(get())
        if (!paneIds(ws.layout).includes(paneId)) {
          updateActiveLayout((w) => placePane(w, paneId, null))
        }
        set({ focusedPaneId: paneId, view: 'grid', modal: null, zoomedPaneId: null })
      },

      async switchBranch(paneId, kind, name) {
        const r = await api.git.switchBranch(paneId, kind, name)
        // Every pane on that folder shows the new branch at once, not at the next poll.
        await get().refreshGit()
        return r.ok ? null : r.error
      },

      async refreshGit() {
        if (typeof document !== 'undefined' && document.hidden) return
        const ws = activeWorkspace(get())
        // One git call per folder: panes often share one.
        const byCwd = new Map<string, string[]>()
        for (const p of ws.panes) byCwd.set(p.cwd, [...(byCwd.get(p.cwd) ?? []), p.id])
        const results = await Promise.all(
          [...byCwd.values()].map(async (ids) => [ids, await api.git.status(ids[0]!)] as const)
        )
        const next = { ...get().git }
        let changed = false
        for (const [ids, st] of results) {
          for (const id of ids) {
            const cur = next[id]
            if (
              !cur ||
              cur.repo !== st.repo ||
              cur.branch !== st.branch ||
              cur.changed !== st.changed ||
              cur.ahead !== st.ahead ||
              cur.behind !== st.behind
            ) {
              next[id] = st
              changed = true
            }
          }
        }
        if (changed) set({ git: next })
      },

      toggleDiff(open) {
        const diffOpen = open ?? !get().diffOpen
        if (diffOpen !== get().diffOpen) set({ diffOpen })
      },

      typeInPane(paneId, text) {
        bus.input(paneId, text)
      },

      runLogin(paneId) {
        bus.input(paneId, '/login\r')
        patchRuntime(paneId, { loginStarted: true })
      },

      // ---- layout --------------------------------------------------------------

      applyPreset(id) {
        updateActiveLayout((ws) => {
          const shown = paneIds(ws.layout)
          const hidden = ws.panes.map((p) => p.id).filter((p) => !shown.includes(p))
          return buildPreset(id, [...shown, ...hidden], () => newId('s'))
        })
        set({ zoomedPaneId: null })
      },

      showAllPanes() {
        updateActiveLayout((ws) => {
          const shown = paneIds(ws.layout)
          const hidden = ws.panes.map((p) => p.id).filter((p) => !shown.includes(p))
          return autoGrid([...shown, ...hidden])
        })
      },

      swap(a, b) {
        if (a === b) return
        updateActiveLayout((ws) => (ws.layout ? swapPanes(ws.layout, a, b) : ws.layout))
      },

      setSplitSizes(path, sizes) {
        updateActiveLayout((ws) => (ws.layout ? setSizesAt(ws.layout, path, sizes) : ws.layout))
      },

      // ---- workspaces ----------------------------------------------------------

      switchWorkspace(id) {
        const s = get()
        const ws = s.config.workspaces.find((w) => w.id === id)
        if (!ws) return
        set({
          config: { ...s.config, activeWorkspace: id },
          activated: { ...s.activated, [id]: true },
          zoomedPaneId: null,
          closingPaneId: null,
          focusedPaneId: paneIds(ws.layout)[0] ?? null,
          view: 'grid',
          modal: null
        })
      },

      switchWorkspaceIndex(index) {
        const ws = get().config.workspaces[index]
        if (ws) get().switchWorkspace(ws.id)
      },

      createProject(input) {
        const name = input.name.trim().slice(0, 64)
        if (!name) return 'Give the project a name.'
        const s = get()
        if (s.config.workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase()))
          return `A project named ${name} exists.`
        const accountId =
          input.accountId && s.config.accounts.some((a) => a.id === input.accountId)
            ? input.accountId
            : null
        const machineId =
          input.machineId && s.config.machines.some((m) => m.id === input.machineId)
            ? input.machineId
            : null
        const folder = input.folder.trim().slice(0, 4096)
        const ws: Workspace = {
          id: newId('ws'),
          name,
          icon: '',
          color: '',
          machineId,
          folder,
          accountId,
          panes: [],
          layout: null,
          history: []
        }
        set({ config: { ...s.config, workspaces: [...s.config.workspaces, ws] } })
        get().switchWorkspace(ws.id)
        // Its icon from what's in the folder (#80), unless one was picked meanwhile.
        if (folder && !machineId) {
          const suggest = async (tries: number): Promise<void> => {
            const ids = await api.project.suggestIcons(ws.id)
            // Main learns of the project once the config is saved: ask again shortly.
            if (ids === null) {
              if (tries > 0) setTimeout(() => void suggest(tries - 1), 300)
              return
            }
            const cur = get().config.workspaces.find((w) => w.id === ws.id)
            if (ids[0] && cur && !cur.icon) get().setWorkspaceIcon(ws.id, ids[0])
          }
          void suggest(10)
        }
        if (input.startChat && folder && accountId)
          get().createPane({ accountId, cwd: folder, args: [], shell: false, slotId: null })
        return null
      },

      setWorkspaceIcon(id, icon) {
        if (icon && !PROJECT_ICON_ID.test(icon)) return
        get().updateConfig((cfg) => withWorkspace(cfg, id, (w) => ({ ...w, icon })))
      },

      renameWorkspace(id, name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return
        set({ config: withWorkspace(get().config, id, (w) => ({ ...w, name: trimmed })) })
      },

      setWorkspaceMachine(id, machineId) {
        const c = get().config
        if (machineId && !c.machines.some((m) => m.id === machineId)) return
        get().updateConfig((cfg) =>
          withWorkspace(cfg, id, (w) => (w.panes.length ? w : { ...w, machineId }))
        )
      },

      addMachine(name, sshHost) {
        const n = name.trim().slice(0, 64)
        const host = sshHost.trim()
        if (!n) return 'Give the machine a name.'
        if (!SSH_HOST.test(host) || host.length > 255)
          return 'Use a Host from ~/.ssh/config or user@host (no spaces, not starting with -).'
        const c = get().config
        if (c.machines.some((m) => m.name.toLowerCase() === n.toLowerCase()))
          return `A machine named ${n} exists.`
        get().updateConfig((cfg) => ({
          ...cfg,
          machines: [...cfg.machines, { id: newId('m'), name: n, sshHost: host }]
        }))
        return null
      },

      removeMachine(id) {
        get().updateConfig((cfg) => ({
          ...cfg,
          machines: cfg.machines.filter((m) => m.id !== id),
          workspaces: cfg.workspaces.map((w) =>
            w.machineId === id ? { ...w, machineId: null } : w
          )
        }))
      },

      deleteWorkspace(id) {
        const s = get()
        if (s.config.workspaces.length <= 1) return
        const ws = s.config.workspaces.find((w) => w.id === id)
        if (!ws) return
        ws.panes.forEach((p) => dropPane(p.id))
        ws.history.forEach((h) => api.chat.stop(h.pane.id, true))
        const after = get()
        const workspaces = after.config.workspaces.filter((w) => w.id !== id)
        const activated = { ...after.activated }
        delete activated[id]
        set({ config: { ...after.config, workspaces }, activated })
        if (after.config.activeWorkspace === id) get().switchWorkspace(workspaces[0]!.id)
      },

      // ---- accounts ------------------------------------------------------------

      async addAccount(name, color, cli = 'claude') {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return 'Enter a name.'
        const s = get()
        if (s.config.accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
          return 'An account with that name already exists.'
        }
        const taken = new Set(s.config.accounts.map((a) => baseName(a.configDir)))
        const slug = uniqueSlug(slugify(trimmed), taken)
        const res = await api.account.createDir(slug)
        if (!res.ok) return res.error
        const account: Account = {
          id: newId('a'),
          name: trimmed,
          cli,
          configDir: res.dir,
          color,
          // gemini and agy ask to sign in on their first launch; the /login banner is claude's.
          signedIn: cli !== 'claude',
          imported: false,
          icon: '',
          folderId: null
        }
        get().updateConfig((c) => ({
          ...c,
          accounts: [...c.accounts, account],
          settings: { ...c.settings, defaultAccountId: c.settings.defaultAccountId ?? account.id }
        }))
        return null
      },

      importAccount(dir) {
        const trimmed = dir.trim()
        if (!trimmed) return 'Choose a folder.'
        const s = get()
        if (s.config.accounts.some((a) => a.configDir === trimmed)) {
          return 'That folder is already an account.'
        }
        const base = slugify(baseName(trimmed).replace(/^\.+/, '')) || 'imported'
        const name = uniqueSlug(base, new Set(s.config.accounts.map((a) => a.name)))
        const account: Account = {
          id: newId('a'),
          name,
          cli: 'claude',
          configDir: trimmed,
          color: nextFreeColor(s.config.accounts),
          signedIn: true,
          imported: true,
          icon: '',
          folderId: null
        }
        get().updateConfig((c) => ({
          ...c,
          accounts: [...c.accounts, account],
          settings: { ...c.settings, defaultAccountId: c.settings.defaultAccountId ?? account.id }
        }))
        return null
      },

      moveAccountToFolder(id, folderId) {
        get().updateConfig((c) => {
          if (folderId && !c.accountFolders.some((f) => f.id === folderId)) return c
          return {
            ...c,
            accounts: c.accounts.map((a) => (a.id === id ? { ...a, folderId } : a))
          }
        })
      },

      createFolder(name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed || get().config.accountFolders.length >= 32) return null
        const id = newId('f')
        get().updateConfig((c) => ({
          ...c,
          accountFolders: [
            ...c.accountFolders,
            { id, name: trimmed, collapsed: false, icon: '', color: '' }
          ]
        }))
        return id
      },

      renameFolder(id, name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return
        get().updateConfig((c) => ({
          ...c,
          accountFolders: c.accountFolders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
        }))
      },

      toggleFolder(id) {
        get().updateConfig((c) => ({
          ...c,
          accountFolders: c.accountFolders.map((f) =>
            f.id === id ? { ...f, collapsed: !f.collapsed } : f
          )
        }))
      },

      deleteFolder(id) {
        get().updateConfig((c) => ({
          ...c,
          accountFolders: c.accountFolders.filter((f) => f.id !== id),
          accounts: c.accounts.map((a) => (a.folderId === id ? { ...a, folderId: null } : a))
        }))
      },

      renameAccount(id, name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return
        get().updateConfig((c) => ({
          ...c,
          accounts: c.accounts.map((a) => (a.id === id ? { ...a, name: trimmed } : a))
        }))
      },

      async removeAccount(id, deleteDir) {
        const s = get()
        const account = accountById(s.config, id)
        if (!account) return null
        // Panes first: a running claude must not keep writing into a dir being deleted.
        s.config.workspaces
          .flatMap((w) => w.panes)
          .filter((p) => p.accountId === id)
          .forEach((p) => dropPane(p.id))
        if (deleteDir) {
          const res = await api.account.deleteDir(account.configDir)
          if (!res.ok) return res.error
        }
        get().updateConfig((c) => ({
          ...c,
          accounts: c.accounts.filter((a) => a.id !== id),
          workspaces: c.workspaces.map((w) => (w.accountId === id ? { ...w, accountId: null } : w)),
          settings: {
            ...c.settings,
            defaultAccountId:
              c.settings.defaultAccountId === id ? null : c.settings.defaultAccountId
          }
        }))
        return null
      },

      async setSharedMode(mode) {
        const res = await api.shared.apply(mode)
        if (!res.ok) return res.error
        get().updateSettings({ sharedMode: mode })
        set({ sharedReport: res.report })
        return null
      },

      restartClaudePanes() {
        const s = get()
        const ids = s.config.workspaces
          .flatMap((w) => w.panes)
          .filter((p) => !p.shell && s.runtime[p.id]?.requested)
          .map((p) => p.id)
        ids.forEach((id) => get().restartPane(id))
        return ids.length
      },

      async loadMods() {
        if (get().mods.loading) return
        set({ mods: { ...get().mods, loading: true } })
        const accounts = await api.mods.list()
        set({ mods: { loading: false, accounts } })
      },

      async setModEnabled(accountId, mod, enabled) {
        const res = await api.mods.setEnabled(accountId, mod, enabled)
        if (!res.ok) return res.error
        const same = (m: ModInfo): boolean =>
          m.id === mod.id && m.scope === mod.scope && m.projectPath === mod.projectPath
        const accounts = get().mods.accounts?.map((a) =>
          a.accountId === accountId && a.ok
            ? { ...a, mods: a.mods.map((m) => (same(m) ? { ...m, enabled } : m)) }
            : a
        )
        set({ mods: { ...get().mods, accounts: accounts ?? null } })
        return null
      },

      markSignedIn(id) {
        get().updateConfig((c) => ({
          ...c,
          accounts: c.accounts.map((a) => (a.id === id ? { ...a, signedIn: true } : a))
        }))
      },

      loginAccount(id) {
        const account = accountById(get().config, id)
        if (account && DIALOG_LOGIN_CLIS.includes(account.cli))
          set({ modal: { kind: 'login', accountId: id } })
        else if (account) get().loginInTerminal(id)
      },

      loginInTerminal(id) {
        const s = get()
        if (!accountById(s.config, id)) return
        const paneId = addPaneToActive(
          {
            accountId: id,
            cwd: s.config.settings.defaultCwd,
            args: [],
            shell: false,
            slotId: null
          },
          { loginFlow: true }
        )
        set({ zoomedPaneId: paneId })
      },

      paneNotice(paneId, title, body) {
        const s = get()
        const found = findPane(s.config, paneId)
        if (!found || !s.config.settings.notifyPanes || attending(paneId)) return
        const where = `${found.pane.title} · ${found.ws.name}`
        api.notify.pane(paneId, (title ? `${title} · ${where}` : where).slice(0, 120), body)
      },

      async loadUsage() {
        set({ usage: await api.usage.get() })
      },

      // ---- themes --------------------------------------------------------------

      async loadThemes() {
        const r = await api.themes.list()
        set({ themes: [...BUILT_IN_THEMES, ...r.themes], themeProblems: r.problems })
      },

      chooseTheme(id) {
        const t = get().themes.find((x) => x.id === id)
        if (!t) return
        const slot = t.mode === 'dark' ? 'themeDark' : 'themeLight'
        const follow = get().config.settings.theme === 'system'
        // A theme comes with its own accent; picking one drops an accent laid over the last.
        get().updateSettings({ [slot]: id, accent: 'theme', ...(follow ? {} : { theme: t.mode }) })
      },

      async importTheme() {
        const r = await api.themes.import()
        if (!r) return null
        if (!r.ok) return r.error
        await get().loadThemes()
        get().chooseTheme(r.id)
        return null
      },

      setThemeDraft(t) {
        set({ themeDraft: t })
      },

      async saveThemeDraft() {
        const draft = get().themeDraft
        if (!draft) return null
        const r = await api.themes.save(draft)
        if (!r.ok) return r.error
        await get().loadThemes()
        set({ themeDraft: null })
        get().chooseTheme(r.id)
        return null
      },

      async deleteTheme(id) {
        const r = await api.themes.delete(id)
        if (!r.ok) return r.error
        await get().loadThemes()
        return null
      },

      // ---- settings ------------------------------------------------------------

      updateSettings(patch) {
        get().updateConfig((c) => ({ ...c, settings: { ...c.settings, ...patch } }))
      },

      setClaudePath(path) {
        get().updateConfig((c) => ({ ...c, claudePath: path }))
      },

      async detectClaude() {
        const claude = await api.claude.detect(get().config.claudePath)
        set({ claude })
      },

      setSystemTheme(theme) {
        if (theme !== get().systemTheme) set({ systemTheme: theme })
      },

      async checkForUpdates(reason) {
        if (get().update.checking) return
        set({ update: { ...get().update, checking: true } })
        const result = await api.update.check(reason)
        // A skipped launch check keeps whatever an earlier check found.
        set({
          update: {
            ...get().update,
            checking: false,
            result: result.status === 'skipped' ? get().update.result : result
          }
        })
      },

      async installUpdate() {
        if (get().update.install.phase !== 'idle') return
        set({ update: { ...get().update, installError: null } })
        const r = await api.update.download()
        // On success main reports `ready`; a cancelled download is not an error.
        if (!r.ok && !('cancelled' in r)) {
          set({
            update: {
              ...get().update,
              install: { phase: 'idle' },
              installError: { error: r.error, manual: r.manual }
            }
          })
        }
      },

      async restartToUpdate() {
        if (get().update.install.phase !== 'ready') return
        set({ update: { ...get().update, installError: null } })
        const r = await api.update.restart()
        // On success the app is quitting; there is nothing left to show.
        if (!r.ok && !('cancelled' in r)) {
          set({ update: { ...get().update, installError: { error: r.error, manual: r.manual } } })
        }
      },

      cancelUpdate() {
        void api.update.cancel()
      },

      dismissUpdated() {
        if (get().update.updatedTo) set({ update: { ...get().update, updatedTo: null } })
      },

      // ---- ui ------------------------------------------------------------------

      setView(view) {
        set({ view, modal: null, accountsMode: 'list' })
      },

      setAccountsMode(mode) {
        set({ view: 'accounts', accountsMode: mode, modal: null })
      },

      openModal(modal) {
        set({ modal })
      },

      closeModal() {
        set({ modal: null })
      },

      toggleSidebar() {
        get().updateSettings({ sidebarCollapsed: !get().config.settings.sidebarCollapsed })
      },

      showUpdates() {
        set({ view: 'settings', modal: null, accountsMode: 'list', settingsAnchor: 'updates' })
      },

      clearSettingsAnchor() {
        set({ settingsAnchor: null })
      }
    }
  })

  // Rebound shortcuts apply at once, to the key handlers and to every hint drawn after.
  store.subscribe((s, prev) => {
    if (s.config.settings.shortcuts !== prev.config.settings.shortcuts)
      setShortcutBindings(s.config.settings.shortcuts)
  })

  // Persist every config change; main validates and writes it debounced (300 ms).
  store.subscribe((s, prev) => {
    if (s.ready && s.config !== prev.config) {
      void api.config.set(s.config).then((r) => {
        if (!r.ok) console.warn('[wraithgrid] config was rejected:', r.error)
      })
    }
  })

  return store
}
