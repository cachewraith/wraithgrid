import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, net, session, shell } from 'electron'
import { spawn } from 'node-pty'
import { IPC } from '@shared/ipc-channels'
import type { PtyDataEvent, PtyExitEvent } from '@shared/ipc-contract'
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

// Requirements §9 names ~/.config/wraithgrid; Electron would default to the productName.
// WRAITHGRID_USER_DATA_DIR lets tests run against a throwaway config dir.
app.setPath(
  'userData',
  process.env.WRAITHGRID_USER_DATA_DIR || path.join(app.getPath('appData'), 'wraithgrid')
)

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

function send(channel: string, payload: PtyDataEvent | PtyExitEvent): void {
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
    backgroundColor: theme === 'light' ? '#f5f4fa' : '#0a0a12',
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

void app.whenReady().then(() => {
  store.load()
  Menu.setApplicationMenu(null)
  hardenSessions()
  registerIpc({
    getWindow: () => mainWindow,
    store,
    ptys,
    homeDir,
    desktop,
    envReady,
    updates: new UpdateChecker({
      currentVersion: app.getVersion(),
      fetch: (url, init) => net.fetch(url, init)
    }),
    isPackaged: app.isPackaged,
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
