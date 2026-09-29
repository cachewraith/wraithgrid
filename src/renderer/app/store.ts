import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  AppInfo,
  ClaudeDetectResult,
  PtyExitEvent,
  SharedReportEntry,
  UpdateCheckResult,
  WraithApi
} from '@shared/ipc-contract'
import { baseName, slugify } from '@shared/paths'
import { defaultConfig } from '@shared/schema'
import {
  ACCOUNT_COLORS,
  type Account,
  type Config,
  type LayoutNode,
  type Pane,
  type PaneStatus,
  resolveTheme,
  type Settings,
  type ThemeName,
  type Workspace
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
import { newId } from '../lib/ids'
import type { PtyBus } from '../lib/pty-bus'
import type { RectRegistry } from '../lib/scheduling'
import { StaggeredQueue } from '../lib/scheduling'
import { deriveStatus, lastErrorLine } from '../lib/status'

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
}

export type View = 'grid' | 'accounts' | 'settings'
export type AccountsMode = 'list' | 'add' | 'import'
export type Modal =
  | { kind: 'newPane'; slotId: string | null }
  | { kind: 'shortcuts' }
  | { kind: 'workspaces' }
  | { kind: 'removeAccount'; accountId: string }

export interface NewPaneInput {
  accountId: string | null
  cwd: string
  args: string[]
  shell: boolean
  slotId: string | null
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
  update: { checking: boolean; result: UpdateCheckResult | null }
  /** A Settings section to scroll to once, then cleared. */
  settingsAnchor: 'updates' | null

  init(): Promise<void>
  updateConfig(fn: (c: Config) => Config): void

  // panes
  requestStart(paneId: string): void
  createPane(input: NewPaneInput): string
  closePane(paneId: string, force?: boolean): void
  cancelClose(): void
  restartPane(paneId: string): void
  focusPane(paneId: string | null): void
  focusDirection(dir: Direction): void
  toggleZoom(paneId?: string): void
  runLogin(paneId: string): void

  // layout
  applyPreset(id: PresetId): void
  showAllPanes(): void
  swap(a: string, b: string): void
  setSplitSizes(path: Path, sizes: number[]): void

  // workspaces
  switchWorkspace(id: string): void
  switchWorkspaceIndex(index: number): void
  createWorkspace(name: string): void
  renameWorkspace(id: string, name: string): void
  deleteWorkspace(id: string): void

  // accounts
  addAccount(name: string, color: string): Promise<string | null>
  importAccount(dir: string): string | null
  renameAccount(id: string, name: string): void
  removeAccount(id: string, deleteDir: boolean): Promise<string | null>
  markSignedIn(id: string): void
  /** Shares this account's CLAUDE.md and skills with all others (null: each keeps its own). */
  setSharedSource(id: string | null): Promise<string | null>
  loginAccount(id: string): void

  // settings
  updateSettings(patch: Partial<Settings>): void
  setClaudePath(path: string): void
  detectClaude(): Promise<void>
  setSystemTheme(theme: ThemeName): void
  checkForUpdates(reason: 'launch' | 'manual'): Promise<void>

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
  rects: RectRegistry
  now?: () => number
}

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

export function accountById(config: Config, id: string | null): Account | undefined {
  return id ? config.accounts.find((a) => a.id === id) : undefined
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

const RESTART_MARK = (t: Date): string =>
  `\r\n\x1b[2m— restarted ${t.toTimeString().slice(0, 5)} —\x1b[0m\r\n`

// ---- Store -------------------------------------------------------------------------

export function createAppStore({
  api,
  bus,
  rects,
  now = () => Date.now()
}: StoreDeps): StoreApi<AppState> {
  const startQueue = new StaggeredQueue(150, now)

  const store = createStore<AppState>()((set, get) => {
    const patchRuntime = (paneId: string, patch: Partial<PaneRuntime>): void => {
      const cur = get().runtime[paneId]
      if (!cur) return
      set({ runtime: { ...get().runtime, [paneId]: { ...cur, ...patch } } })
    }

    const spawn = async (paneId: string): Promise<void> => {
      const found = findPane(get().config, paneId)
      if (!found) return
      const { pane } = found
      const { cols, rows } = bus.size(paneId)
      const res = await api.pty.create({
        paneId,
        accountId: pane.shell ? null : pane.accountId,
        cwd: pane.cwd,
        args: pane.args,
        shell: pane.shell,
        cols,
        rows
      })
      // The pane may have been closed while the process was starting.
      if (!get().runtime[paneId]) {
        if (res.ok) api.pty.kill(paneId)
        return
      }
      if (res.ok) patchRuntime(paneId, { started: true, pid: res.pid, exit: null })
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
      const pane: Pane = {
        id,
        accountId: input.shell ? null : input.accountId,
        cwd: input.cwd,
        args: input.shell ? [] : input.args,
        shell: input.shell,
        title: input.shell ? 'shell' : baseName(input.cwd) === '~' ? 'home' : baseName(input.cwd)
      }
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

    const dropPane = (paneId: string): void => {
      api.pty.kill(paneId)
      bus.forget(paneId)
      const s = get()
      const found = findPane(s.config, paneId)
      const runtime = { ...s.runtime }
      delete runtime[paneId]
      let config = s.config
      if (found) {
        config = withWorkspace(config, found.ws.id, (w) => ({
          ...w,
          panes: w.panes.filter((p) => p.id !== paneId),
          layout: removePane(w.layout, paneId)
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

    const refreshStatuses = (): void => {
      const s = get()
      const t = now()
      let changed = false
      const runtime: Record<string, PaneRuntime> = {}
      for (const [paneId, rt] of Object.entries(s.runtime)) {
        const found = findPane(s.config, paneId)
        const account = found ? accountById(s.config, found.pane.accountId) : undefined
        const status = rt.exit
          ? 'exited'
          : deriveStatus({
              started: rt.started,
              exited: false,
              loginNeeded: !!found && !found.pane.shell && !!account && !account.signedIn,
              activity: bus.activity(paneId),
              now: t
            })
        runtime[paneId] = status === rt.status ? rt : { ...rt, status }
        if (status !== rt.status) changed = true
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
      update: { checking: false, result: null },
      settingsAnchor: null,

      async init() {
        const [raw, info] = await Promise.all([api.config.get(), api.app.info()])
        const config = normalizeWorkspaces(raw)
        const ws = activeWorkspace({ config })
        bus.start()
        bus.onExit(onExit)
        bus.onLoginDetected((paneId) => {
          const found = findPane(get().config, paneId)
          const account = found && accountById(get().config, found.pane.accountId)
          if (account && !account.signedIn) get().markSignedIn(account.id)
        })
        setInterval(refreshStatuses, 500)
        set({
          config,
          info,
          ready: true,
          activated: { [ws.id]: true },
          focusedPaneId: paneIds(ws.layout)[0] ?? null
        })
        void get().detectClaude()
        if (config.settings.checkUpdatesOnLaunch) void get().checkForUpdates('launch')
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
        if (!force && rt && (rt.status === 'running' || rt.status === 'approval')) {
          set({ closingPaneId: paneId, focusedPaneId: paneId })
          return
        }
        dropPane(paneId)
      },

      cancelClose() {
        set({ closingPaneId: null })
      },

      restartPane(paneId) {
        if (!get().runtime[paneId]) return
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

      createWorkspace(name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return
        const ws: Workspace = { id: newId('ws'), name: trimmed, panes: [], layout: null }
        const s = get()
        set({ config: { ...s.config, workspaces: [...s.config.workspaces, ws] } })
        get().switchWorkspace(ws.id)
      },

      renameWorkspace(id, name) {
        const trimmed = name.trim().slice(0, 64)
        if (!trimmed) return
        set({ config: withWorkspace(get().config, id, (w) => ({ ...w, name: trimmed })) })
      },

      deleteWorkspace(id) {
        const s = get()
        if (s.config.workspaces.length <= 1) return
        const ws = s.config.workspaces.find((w) => w.id === id)
        if (!ws) return
        ws.panes.forEach((p) => dropPane(p.id))
        const after = get()
        const workspaces = after.config.workspaces.filter((w) => w.id !== id)
        const activated = { ...after.activated }
        delete activated[id]
        set({ config: { ...after.config, workspaces }, activated })
        if (after.config.activeWorkspace === id) get().switchWorkspace(workspaces[0]!.id)
      },

      // ---- accounts ------------------------------------------------------------

      async addAccount(name, color) {
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
          configDir: res.dir,
          color,
          signedIn: false,
          imported: false
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
          configDir: trimmed,
          color: nextFreeColor(s.config.accounts),
          signedIn: true,
          imported: true
        }
        get().updateConfig((c) => ({
          ...c,
          accounts: [...c.accounts, account],
          settings: { ...c.settings, defaultAccountId: c.settings.defaultAccountId ?? account.id }
        }))
        return null
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
        // The other accounts must not keep links into a dir that is going away.
        if (s.config.settings.sharedSourceAccountId === id) {
          const err = await get().setSharedSource(null)
          if (err) return err
        }
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
          settings: {
            ...c.settings,
            defaultAccountId:
              c.settings.defaultAccountId === id ? null : c.settings.defaultAccountId
          }
        }))
        return null
      },

      async setSharedSource(id) {
        const res = await api.shared.apply(id)
        if (!res.ok) return res.error
        get().updateSettings({ sharedSourceAccountId: id })
        set({ sharedReport: res.report })
        return null
      },

      markSignedIn(id) {
        get().updateConfig((c) => ({
          ...c,
          accounts: c.accounts.map((a) => (a.id === id ? { ...a, signedIn: true } : a))
        }))
      },

      loginAccount(id) {
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
            checking: false,
            result: result.status === 'skipped' ? get().update.result : result
          }
        })
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
