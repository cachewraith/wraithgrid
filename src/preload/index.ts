import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PtyDataEvent, PtyExitEvent, UpdateProgress, WraithApi } from '@shared/ipc-contract'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// A fixed, typed surface: the renderer never sees ipcRenderer itself.
const api: WraithApi = {
  pty: {
    create: (args) => ipcRenderer.invoke(IPC.ptyCreate, args),
    write: (paneId, data) => ipcRenderer.send(IPC.ptyWrite, { paneId, data }),
    resize: (paneId, cols, rows) => ipcRenderer.send(IPC.ptyResize, { paneId, cols, rows }),
    kill: (paneId) => ipcRenderer.send(IPC.ptyKill, { paneId }),
    onData: (cb) => subscribe<PtyDataEvent>(IPC.ptyData, cb),
    onExit: (cb) => subscribe<PtyExitEvent>(IPC.ptyExit, cb)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (config) => ipcRenderer.invoke(IPC.configSet, config)
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickFolder, { defaultPath }),
    pickFile: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickFile, { defaultPath })
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose)
  },
  claude: {
    detect: (override) => ipcRenderer.invoke(IPC.claudeDetect, { override })
  },
  account: {
    createDir: (slug) => ipcRenderer.invoke(IPC.accountCreateDir, { slug }),
    deleteDir: (dir) => ipcRenderer.invoke(IPC.accountDeleteDir, { dir, confirm: true })
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, { url })
  },
  shared: {
    apply: (mode) => ipcRenderer.invoke(IPC.sharedApply, { mode })
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  update: {
    check: (reason) => ipcRenderer.invoke(IPC.updateCheck, { reason }),
    install: () => ipcRenderer.invoke(IPC.updateInstall, {}),
    onProgress: (cb) => subscribe<UpdateProgress>(IPC.updateProgress, cb),
    onShow: (cb) => subscribe<void>(IPC.updateShow, () => cb())
  },
  git: {
    status: (paneId) => ipcRenderer.invoke(IPC.gitStatus, { paneId }),
    diff: (paneId) => ipcRenderer.invoke(IPC.gitDiff, { paneId }),
    addWorktree: (cwd, branch) => ipcRenderer.invoke(IPC.gitWorktreeAdd, { cwd, branch })
  },
  notify: {
    pane: (paneId, title, body) => ipcRenderer.send(IPC.notifyPane, { paneId, title, body }),
    onReveal: (cb) => subscribe<string>(IPC.paneReveal, cb)
  }
}

contextBridge.exposeInMainWorld('wraith', api)
