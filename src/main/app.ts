import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  session,
  shell,
  Tray
} from 'electron'
import { autoUpdater, type ProgressInfo } from 'electron-updater'
import trayIconPath from '../../build/icon.png?asset'
import { IPC } from '@shared/ipc-channels'
import type { PtyDataEvent, PtyExitEvent, UpdateProgress } from '@shared/ipc-contract'
import type { ChatEventMessage } from '@shared/chat'
import { ChatSessions } from './chat/sessions'
import { forceKillTree, spawnChatChild } from './chat/spawn'
import type { GitRunner } from './git'
import { resolveTheme, type CloseMode, type Machine, type ThemeName } from '@shared/types'
import { ConfigStore } from './config-store'
import { machineOfPane, registerIpc, type IpcHandle } from './ipc'
import { PaneRouter } from './pane-router'
import { openSshLink, sshArgs, type SshLink } from './ssh'
import { configFilePath, userDataDir } from './paths'
import {
  detectDesktop,
  extraBinDirs,
  loginShellPath,
  MAC_TRAFFIC_LIGHTS,
  mergePath,
  minimumWindowSize,
  titleBarOverlayFor
} from './platform'
import { hostPaths } from '../host/paths'
import { connectSocket, startHostProcess } from './host-start'
import { PaneHost, type MismatchChoice } from './pane-host'
import { CommunityCatalog } from './mod-community'
import { UpdateChecker } from './update-check'
import { UpdateInstaller } from './update-install'
import { notifyIfNew, type UpdateNotice } from './update-notify'

app.setPath('userData', userDataDir(app.getPath('appData'), process.env))

// Windows only shows toasts for an app with an AppUserModelID (matches electron-builder appId).
if (process.platform === 'win32') app.setAppUserModelId('dev.cachewraith.wraithgrid')

/** While the app stays open, look for a new release this often (GitHub allows 60/h). */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000

// Two instances would overwrite each other's config; focus the first one instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

const homeDir = os.homedir()
const store = new ConfigStore(configFilePath(app.getPath('userData')))
const desktop = detectDesktop(process.platform, process.env)
let mainWindow: BrowserWindow | null = null

// A launcher-started session (Hyprland exec, a .desktop file, the Start menu) often lacks
// the PATH a login shell sets up, so claude and the tools it runs would not be found.
// Started from a terminal (TERM set), PATH is already right and this is skipped.
const envReady: Promise<void> = (async () => {
  const shellPath =
    process.platform !== 'win32' && !process.env.TERM ? await loginShellPath(process.env) : null
  process.env.PATH = mergePath(
    path.delimiter,
    shellPath ?? undefined,
    process.env.PATH,
    extraBinDirs(process.platform, homeDir, process.env).join(path.delimiter)
  )
})()

function send(
  channel: string,
  payload?: PtyDataEvent | PtyExitEvent | UpdateProgress | ChatEventMessage | string
): void {
  const wc = mainWindow?.webContents
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

// Chat panes' headless CLIs (ADR 0002) run here, not in the host: they stop on quit.
const chats = new ChatSessions({
  spawn: spawnChatChild,
  emit: (paneId, event) => send(IPC.chatEvent, { paneId, event }),
  forceKill: forceKillTree
})

// ---- Background pty host (ADR 0001): panes live there, so they can outlive this process.

const uid = process.getuid?.() ?? -1
const hostFiles = hostPaths({
  platform: process.platform,
  env: process.env,
  userData: app.getPath('userData'),
  tmpDir: os.tmpdir(),
  uid,
  userName: os.userInfo().username
})

/** Starts the host detached, with this same Electron binary running as plain Node. */
async function startHost(): Promise<void> {
  await envReady
  await startHostProcess({
    paths: hostFiles,
    appVersion: app.getVersion(),
    execPath: process.execPath,
    outDir: __dirname,
    cwd: homeDir,
    env: process.env,
    uid
  })
}

/** A host from another Wraithgrid version still runs agents: restart them, or leave them. */
async function askMismatch(info: { appVersion: string; live: number }): Promise<MismatchChoice> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: `${info.live} agent${info.live === 1 ? ' is' : 's are'} running in an older background host`,
    detail: `They were started by Wraithgrid ${info.appVersion}. Restart them now to see them here (panes that had a conversation continue it), or keep them running and quit this window.`,
    buttons: ['Restart them now', 'Keep them running'],
    defaultId: 0,
    cancelId: 1
  })
  return response === 0 ? 'restart' : 'keep'
}

let ipcHandle: IpcHandle | null = null
const ptys = new PaneHost({
  connect: () => connectSocket(hostFiles.socket),
  start: startHost,
  readToken: async () => (await readFile(hostFiles.token, 'utf8')).trim(),
  appVersion: app.getVersion(),
  onData: (paneId, data, replay) => send(IPC.ptyData, { paneId, data, replay }),
  onExit: (e) => send(IPC.ptyExit, e),
  onMismatch: askMismatch,
  onGuiAction: (action) =>
    ipcHandle
      ? ipcHandle.runCliAction(action)
      : Promise.resolve({ ok: false, error: 'Wraithgrid is still starting.' }),
  log: (msg) => console.warn(`[wraithgrid] host: ${msg}`)
})

/** A machine's host, over `ssh … wraithgrid host-stdio` (H5). WRAITHGRID_SSH: tests' stand-in. */
function remoteHost(m: Machine): PaneHost {
  let link: SshLink | null = null
  return new PaneHost({
    connect: async () => {
      link = await openSshLink(process.env.WRAITHGRID_SSH || 'ssh', sshArgs(m.sshHost))
      return link.stream
    },
    // Nothing to start from here: the remote end starts its own host.
    start: () => {
      const why = link?.stderr()
      return Promise.reject(
        new Error(
          `Could not reach ${m.name} (${m.sshHost})${why ? `: ${why}` : ''}. It needs ssh with a key or agent, and Wraithgrid installed there with wraithgrid on PATH.`
        )
      )
    },
    readToken: async () => '', // host-stdio puts in the remote host's token
    appVersion: app.getVersion(),
    onData: (paneId, data, replay) => send(IPC.ptyData, { paneId, data, replay }),
    onExit: (e) => send(IPC.ptyExit, e),
    onMismatch: askMismatch,
    lostMessage: `Disconnected from ${m.name}. Restart to reconnect; the agent may still be running there.`,
    helloTimeoutMs: 30_000,
    log: (msg) => console.warn(`[wraithgrid] ${m.name}: ${msg}`)
  })
}

const router = new PaneRouter({
  local: ptys,
  remote: remoteHost,
  machine: (id) => store.get().machines.find((m) => m.id === id),
  machineOf: (paneId) => machineOfPane(store.get(), paneId)
})

/** The theme being drawn right now; `system` follows the OS. */
const currentTheme = (): ThemeName =>
  resolveTheme(store.get().settings.theme, nativeTheme.shouldUseDarkColors)

function createWindow(): void {
  const theme = currentTheme()
  const min = minimumWindowSize(desktop.chrome)
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: min.width,
    minHeight: min.height,
    // Windows keeps its native caption buttons (and snap layouts) over our title bar;
    // macOS keeps its traffic lights, inset into it.
    ...(desktop.chrome === 'overlay'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlayFor(theme) }
      : desktop.chrome === 'mac'
        ? { titleBarStyle: 'hidden' as const, trafficLightPosition: MAC_TRAFFIC_LIGHTS }
        : { frame: false }),
    show: false,
    title: 'Wraithgrid',
    backgroundColor: theme === 'light' ? '#ffffff' : '#1c1c1c',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // A crashed renderer only loses its screens: the panes live in the host, and the reloaded
  // window reattaches them with their screens.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (cleaning || details.reason === 'clean-exit') return
    console.warn(`[wraithgrid] renderer gone (${details.reason}); reattaching panes`)
    if (!win.isDestroyed()) win.webContents.reload()
  })

  // Close button, window manager close, Alt+F4: the user decides what happens to agents.
  win.on('close', (e) => {
    if (quitIntent || hidingToTray) return
    e.preventDefault()
    void chooseOnClose().then((choice) => {
      if (choice === 'cancel') return
      if (choice === 'keep') keepInTray(win)
      else {
        quitIntent = 'stop'
        app.quit()
      }
    })
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  if (!app.isPackaged) {
    // Surface renderer errors (CSP violations, exceptions) in the dev terminal.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning')
        console.warn(`[renderer:${e.level}] ${e.message}`)
    })
    if (process.platform !== 'darwin') win.setIcon(path.join(__dirname, '../../build/icon.png'))
  }
  if (process.env.WRAITHGRID_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
}

function hardenSessions(): void {
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(allowed.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_e, contents) => {
    // The app never navigates; links open in the system browser (http/https only).
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

// ---- Shutdown: agents stop, unless the user chose to keep them -----------------------

type QuitIntent = 'stop' | 'keep'
/** Set once a quit is decided; a quit from code without one follows the setting. */
let quitIntent: QuitIntent | null = null
let cleanedUp = false
let cleaning: Promise<void> | null = null
let hidingToTray = false
let tray: Tray | null = null
let trayTimer: NodeJS.Timeout | null = null

const closeMode = (): CloseMode => store.get().settings.onWindowClose
/** Quits nobody was asked about (code, signals, tests) never keep agents unless set to. */
const silentIntent = (): QuitIntent => (closeMode() === 'keep' ? 'keep' : 'stop')

function cleanup(intent: QuitIntent): Promise<void> {
  cleaning ??= Promise.allSettled([
    intent === 'keep' ? ptys.detach() : ptys.stopAll(),
    chats.stopAll(),
    router.detachRemotes(),
    store.flush()
  ]).then(() => {
    cleanedUp = true
  })
  return cleaning
}

/** Asks what to do with running agents, unless there are none or the choice is saved. */
async function chooseOnClose(): Promise<QuitIntent | 'cancel'> {
  const live = await ptys.liveCount()
  if (live === 0) return 'stop'
  const mode = closeMode()
  if (mode !== 'ask') return mode
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const opts = {
    type: 'question' as const,
    message: `${live} agent${live === 1 ? ' is' : 's are'} running`,
    detail:
      'Keep them running in the background, and Wraithgrid shows them again, screen and all, next time it opens. Or stop them now.',
    buttons: ['Keep running', 'Stop agents and quit', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: 'Remember my choice (Settings → When the window closes)'
  }
  const { response, checkboxChecked } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response === 2) return 'cancel'
  const choice: QuitIntent = response === 0 ? 'keep' : 'stop'
  if (checkboxChecked) {
    const cfg = store.get()
    store.set({ ...cfg, settings: { ...cfg.settings, onWindowClose: choice } })
    send(IPC.windowCloseMode, choice)
  }
  return choice
}

/** UI quits (macOS Quit item, tray) ask like the close button does. */
async function requestQuit(): Promise<void> {
  const choice = await chooseOnClose()
  if (choice === 'cancel') return
  quitIntent = choice
  app.quit()
}

/** Closes the window but keeps this process (and its tray icon) while agents run. */
function keepInTray(win: BrowserWindow): void {
  hidingToTray = true
  win.destroy()
  hidingToTray = false
  if (!tray) {
    const size = process.platform === 'darwin' ? 18 : 22
    tray = new Tray(nativeImage.createFromPath(trayIconPath).resize({ width: size, height: size }))
    tray.setToolTip('Wraithgrid: agents running')
    tray.on('click', reopenWindow)
  }
  void refreshTray()
  trayTimer ??= setInterval(() => void refreshTray(), 5000)
}

async function refreshTray(): Promise<void> {
  if (!tray) return
  const live = await ptys.liveCount()
  if (live === 0 && !mainWindow) {
    // Nothing left to keep running: leave quietly.
    quitIntent = 'stop'
    app.quit()
    return
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${live} agent${live === 1 ? '' : 's'} running`, enabled: false },
      { type: 'separator' },
      { label: 'Open Wraithgrid', click: reopenWindow },
      {
        label: 'Stop all agents and quit',
        click: () => {
          quitIntent = 'stop'
          app.quit()
        }
      },
      {
        label: 'Quit, keep agents running',
        click: () => {
          quitIntent = 'keep'
          app.quit()
        }
      }
    ])
  )
}

function reopenWindow(): void {
  if (trayTimer) clearInterval(trayTimer)
  trayTimer = null
  tray?.destroy()
  tray = null
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else createWindow()
}

app.on('before-quit', (e) => {
  if (cleanedUp) return
  e.preventDefault()
  quitIntent ??= silentIntent()
  void cleanup(quitIntent).then(() => app.quit())
})

app.on('window-all-closed', () => {
  if (tray) return
  quitIntent ??= silentIntent()
  void cleanup(quitIntent).then(() => app.quit())
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void cleanup(quitIntent ?? silentIntent()).then(() => app.exit(0))
  })
}

app.on('second-instance', reopenWindow)

/** A native notification; clicking it brings the window back at Settings → Updates. */
function showUpdateNotice(notice: UpdateNotice): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: notice.title,
    body: notice.body,
    icon: path.join(__dirname, '../../build/icon.png')
  })
  n.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void shell.openExternal(notice.url)
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    send(IPC.updateShow)
  })
  n.show()
}

/** A pane finished or wants approval; clicking brings the window back at that pane. */
function showPaneNotice(paneId: string, title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: path.join(__dirname, '../../build/icon.png') })
  n.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    send(IPC.paneReveal, paneId)
  })
  n.show()
}

/**
 * git without a shell. Optional locks off: status polling must never take index.lock
 * while claude is committing in the same repo. No prompts: a credential ask would hang.
 */
const runGit: GitRunner = (args, cwd, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: opts?.slow ? 180_000 : 15_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
      },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr: String(stderr) }))
        else resolve(String(stdout))
      }
    )
  })

/**
 * macOS only works with an application menu: without one, Cmd+Q, Cmd+H and Cmd+C/V in text
 * fields do nothing. Kept minimal; there is no Cmd+W item, since that would close the
 * window and every pane with it.
 */
function macMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `Quit ${app.name}`, accelerator: 'Command+Q', click: () => void requestQuit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
        { role: 'front' }
      ]
    }
  ])
}

/** In-app updates through electron-updater, which picks the installer for this package type. */
function createInstaller(): UpdateInstaller {
  // Downloads start only from the Settings button, and nothing installs on a plain quit:
  // on Linux that would raise a password prompt out of nowhere.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null
  // An 'error' event with no listener throws; the promises below already carry each error.
  autoUpdater.on('error', () => {})
  return new UpdateInstaller({
    currentVersion: app.getVersion(),
    // macOS builds are ad-hoc signed; Squirrel.Mac only installs updates signed by the same
    // Developer ID, so there the release page is offered instead (null = manual).
    check: async () =>
      process.platform === 'darwin'
        ? null
        : ((await autoUpdater.checkForUpdates())?.updateInfo.version ?? null),
    download: async (onPercent) => {
      const listener = (p: ProgressInfo): void => onPercent(p.percent)
      autoUpdater.on('download-progress', listener)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.off('download-progress', listener)
      }
    },
    // Linux installs synchronously here (pkexec pacman/apt/dnf) and reports failure as an
    // 'error' event, e.g. a cancelled password prompt; on success the app quits and relaunches.
    install: async () => {
      // The new version cannot replace a binary the host still runs (Windows), and a new
      // GUI could not talk to an old host anyway: updating stops the agents, after asking.
      const live = await ptys.liveCount()
      if (live > 0) {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          message: `Updating stops ${live} running agent${live === 1 ? '' : 's'}`,
          detail: 'Panes that had a conversation continue it after the update.',
          buttons: ['Stop and update', 'Cancel'],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 1) return 'Update cancelled; agents are still running.'
      }
      quitIntent = 'stop'
      await ptys.stopAll()
      let failed: string | null = null
      const onError = (e: Error): void => {
        failed = e.message
      }
      autoUpdater.on('error', onError)
      try {
        autoUpdater.quitAndInstall(true, true)
      } finally {
        autoUpdater.off('error', onError)
      }
      if (failed) quitIntent = null
      return failed
    },
    report: (p) => send(IPC.updateProgress, p),
    log: (msg) => console.warn(`[wraithgrid] ${msg}`)
  })
}

void app.whenReady().then(() => {
  store.load()
  const updates = new UpdateChecker({
    currentVersion: app.getVersion(),
    fetch: (url, init) => net.fetch(url, init)
  })
  const notifyDeps = {
    stateFile: path.join(app.getPath('userData'), 'update-notified.json'),
    show: showUpdateNotice
  }
  const notify = (r: Parameters<typeof notifyIfNew>[0]): void =>
    void notifyIfNew(r, notifyDeps).catch(() => {})
  if (app.isPackaged) {
    setInterval(() => {
      if (!store.get().settings.checkUpdatesOnLaunch) return
      void updates.check().then(notify)
    }, UPDATE_RECHECK_MS).unref()
  }
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null)
  hardenSessions()
  ipcHandle = registerIpc({
    getWindow: () => mainWindow,
    store,
    ptys: router,
    homeDir,
    desktop,
    envReady,
    updates,
    community: new CommunityCatalog((url, init) => net.fetch(url, init)),
    installer: createInstaller(),
    onLaunchUpdateCheck: notify,
    isPackaged: app.isPackaged,
    git: runGit,
    notifyPane: showPaneNotice,
    chats,
    chatDir: path.join(app.getPath('userData'), 'chats'),
    onConfigChanged: (prev, next) => {
      if (prev.settings.cliAccess !== next.settings.cliAccess) {
        ptys.setCliAccess(next.settings.cliAccess)
        if (next.settings.cliAccess) void ptys.connect()
      }
      const dark = nativeTheme.shouldUseDarkColors
      const theme = resolveTheme(next.settings.theme, dark)
      if (desktop.chrome === 'overlay' && resolveTheme(prev.settings.theme, dark) !== theme) {
        mainWindow?.setTitleBarOverlay(titleBarOverlayFor(theme))
      }
    }
  })
  // The OS switched light/dark: the caption buttons follow when the theme is `system`.
  nativeTheme.on('updated', () => {
    if (desktop.chrome === 'overlay' && store.get().settings.theme === 'system') {
      mainWindow?.setTitleBarOverlay(titleBarOverlayFor(currentTheme()))
    }
  })
  ptys.setCliAccess(store.get().settings.cliAccess)
  if (store.get().settings.cliAccess) void ptys.connect()
  createWindow()
})
