import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, net, Notification, session, shell } from 'electron'
import { spawn } from 'node-pty'
import { autoUpdater, type ProgressInfo } from 'electron-updater'
import { IPC } from '@shared/ipc-channels'
import type { PtyDataEvent, PtyExitEvent, UpdateProgress } from '@shared/ipc-contract'
import type { GitRunner } from './git'
import { resolveTheme, type ThemeName } from '@shared/types'
import { ConfigStore } from './config-store'
import { registerIpc } from './ipc'
import { configFilePath } from './paths'
import {
  detectDesktop,
  extraBinDirs,
  loginShellPath,
  mergePath,
  minimumWindowSize,
  titleBarOverlayFor
} from './platform'
import { PtyManager } from './pty-manager'
import { UpdateChecker } from './update-check'
import { UpdateInstaller } from './update-install'
import { notifyIfNew, type UpdateNotice } from './update-notify'

// Requirements §9 names ~/.config/wraithgrid; Electron would default to the productName.
// WRAITHGRID_USER_DATA_DIR lets tests run against a throwaway config dir.
app.setPath(
  'userData',
  process.env.WRAITHGRID_USER_DATA_DIR || path.join(app.getPath('appData'), 'wraithgrid')
)

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
  payload?: PtyDataEvent | PtyExitEvent | UpdateProgress | string
): void {
  const wc = mainWindow?.webContents
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

const ptys = new PtyManager({
  spawn,
  onData: (paneId, data) => send(IPC.ptyData, { paneId, data }),
  onExit: (e) => send(IPC.ptyExit, e)
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
    // Windows keeps its native caption buttons (and snap layouts) over our title bar.
    ...(desktop.chrome === 'overlay'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlayFor(theme) }
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

  // A crashed renderer takes its terminals with it; kill the processes and reload
  // so panes restart cleanly instead of leaving orphans.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (cleaning || details.reason === 'clean-exit') return
    console.warn(`[wraithgrid] renderer gone (${details.reason}); restarting panes`)
    void ptys.killAll().then(() => {
      if (!win.isDestroyed()) win.webContents.reload()
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

// ---- Shutdown: no orphan processes -------------------------------------------------

let cleanedUp = false
let cleaning: Promise<void> | null = null

function cleanup(): Promise<void> {
  cleaning ??= Promise.allSettled([ptys.killAll(), store.flush()]).then(() => {
    cleanedUp = true
  })
  return cleaning
}

app.on('before-quit', (e) => {
  if (cleanedUp) return
  e.preventDefault()
  void cleanup().then(() => app.quit())
})

app.on('window-all-closed', () => {
  void cleanup().then(() => app.quit())
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void cleanup().then(() => app.exit(0))
  })
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

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
const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 15_000,
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
    check: async () => (await autoUpdater.checkForUpdates())?.updateInfo.version ?? null,
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
    install: () => {
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
      return Promise.resolve(failed)
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
  Menu.setApplicationMenu(null)
  hardenSessions()
  registerIpc({
    getWindow: () => mainWindow,
    store,
    ptys,
    homeDir,
    desktop,
    envReady,
    updates,
    installer: createInstaller(),
    onLaunchUpdateCheck: notify,
    isPackaged: app.isPackaged,
    git: runGit,
    notifyPane: showPaneNotice,
    onConfigChanged: (prev, next) => {
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
  createWindow()
})
