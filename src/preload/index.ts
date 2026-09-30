import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PtyDataEvent, PtyExitEvent, WraithApi } from '@shared/ipc-contract'

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
    check: (reason) => ipcRenderer.invoke(IPC.updateCheck, { reason })
  }
}

contextBridge.exposeInMainWorld('wraith', api)
