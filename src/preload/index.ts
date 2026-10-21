import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  CliAction,
  PtyDataEvent,
  PtyExitEvent,
  UpdateProgress,
  WraithApi
} from '@shared/ipc-contract'
import type { CloseMode } from '@shared/types'

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
    close: () => ipcRenderer.send(IPC.windowClose),
    onCloseMode: (cb) => subscribe<CloseMode>(IPC.windowCloseMode, cb)
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
    addWorktree: (cwd, branch) => ipcRenderer.invoke(IPC.gitWorktreeAdd, { cwd, branch }),
    branches: (paneId) => ipcRenderer.invoke(IPC.gitBranches, { paneId }),
    switchBranch: (paneId, kind, name) => ipcRenderer.invoke(IPC.gitSwitch, { paneId, kind, name }),
    commit: (paneId, message) => ipcRenderer.invoke(IPC.gitCommit, { paneId, message }),
    push: (paneId) => ipcRenderer.invoke(IPC.gitPush, { paneId }),
    openPullRequest: (paneId) => ipcRenderer.invoke(IPC.gitOpenPr, { paneId }),
    checkWorktree: (cwd) => ipcRenderer.invoke(IPC.gitWorktreeCheck, { cwd }),
    removeWorktree: (cwd, force) => ipcRenderer.invoke(IPC.gitWorktreeRemove, { cwd, force })
  },
  shells: {
    list: () => ipcRenderer.invoke(IPC.shellList, {})
  },
  clipboard: {
    image: (paneId) => ipcRenderer.invoke(IPC.clipboardImage, { paneId })
  },
  mods: {
    list: () => ipcRenderer.invoke(IPC.modsList, {}),
    setEnabled: (accountId, mod, enabled) =>
      ipcRenderer.invoke(IPC.modsSetEnabled, {
        accountId,
        id: mod.id,
        scope: mod.scope,
        projectPath: mod.projectPath,
        enabled
      }),
    catalog: () => ipcRenderer.invoke(IPC.modsCatalog, {}),
    community: () => ipcRenderer.invoke(IPC.modsCommunity, {}),
    install: (id) => ipcRenderer.invoke(IPC.modsInstall, { id }),
    change: (id, change) => ipcRenderer.invoke(IPC.modsChange, { id, change }),
    clone: (id) => ipcRenderer.invoke(IPC.modsClone, { id }),
    pull: (name) => ipcRenderer.invoke(IPC.modsPull, { name }),
    marketplaces: () => ipcRenderer.invoke(IPC.modsMarketplaces, {}),
    addMarketplace: (source) => ipcRenderer.invoke(IPC.modsMarketplaceAdd, { source }),
    removeMarketplace: (name) => ipcRenderer.invoke(IPC.modsMarketplaceRemove, { name })
  },
  notify: {
    pane: (paneId, title, body) => ipcRenderer.send(IPC.notifyPane, { paneId, title, body }),
    onReveal: (cb) => subscribe<string>(IPC.paneReveal, cb)
  },
  machines: {
    sshHosts: () => ipcRenderer.invoke(IPC.machineSshHosts),
    test: (name, sshHost) => ipcRenderer.invoke(IPC.machineTest, { name, sshHost })
  },
  cli: {
    onAction: (cb) =>
      subscribe<{ id: number; action: CliAction }>(IPC.cliAction, (m) => cb(m.id, m.action)),
    reply: (id, result) => ipcRenderer.send(IPC.cliResult, { id, result })
  }
}

contextBridge.exposeInMainWorld('wraith', api)
