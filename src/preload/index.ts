import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  CliAction,
  LoginEvent,
  PtyDataEvent,
  PtyExitEvent,
  UpdateProgress,
  WraithApi
} from '@shared/ipc-contract'
import type { ChatEventMessage } from '@shared/chat'
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
  chat: {
    start: (args) => ipcRenderer.invoke(IPC.chatStart, args),
    moveAccount: (paneId, toAccountId, sessionId) =>
      ipcRenderer.invoke(IPC.chatMoveAccount, { paneId, toAccountId, sessionId }),
    send: (paneId, text, images) => ipcRenderer.send(IPC.chatSend, { paneId, text, images }),
    approve: (paneId, reqId, decision, answers) =>
      ipcRenderer.send(IPC.chatApprove, { paneId, reqId, decision, answers }),
    interrupt: (paneId) => ipcRenderer.send(IPC.chatInterrupt, { paneId }),
    setModel: (paneId, model) => ipcRenderer.send(IPC.chatSetModel, { paneId, model }),
    setMode: (paneId, mode) => ipcRenderer.send(IPC.chatSetMode, { paneId, mode }),
    stop: (paneId, forget) => ipcRenderer.send(IPC.chatStop, { paneId, forget }),
    onEvent: (cb) => subscribe<ChatEventMessage>(IPC.chatEvent, cb),
    load: (paneId) => ipcRenderer.invoke(IPC.chatLoad, { paneId }),
    save: (paneId, data) => ipcRenderer.send(IPC.chatSave, { paneId, data }),
    pickFiles: (paneId) => ipcRenderer.invoke(IPC.chatPickFiles, { paneId }),
    filePath: (file) => webUtils.getPathForFile(file)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (config) => ipcRenderer.invoke(IPC.configSet, config)
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickFolder, { defaultPath }),
    pickFile: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickFile, { defaultPath })
  },
  fs: {
    listFolder: (path) => ipcRenderer.invoke(IPC.fsListFolder, { path }),
    reveal: (path) => ipcRenderer.invoke(IPC.fsReveal, { path })
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
  login: {
    start: (accountId) => ipcRenderer.invoke(IPC.loginStart, { accountId }),
    code: (accountId, code) => ipcRenderer.send(IPC.loginCode, { accountId, code }),
    cancel: (accountId) => ipcRenderer.send(IPC.loginCancel, { accountId }),
    onEvent: (cb) => subscribe<LoginEvent>(IPC.loginEvent, cb)
  },
  shared: {
    apply: (mode) => ipcRenderer.invoke(IPC.sharedApply, { mode })
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    setZoom: (factor) => {
      if (Number.isFinite(factor)) webFrame.setZoomFactor(Math.min(2, Math.max(0.67, factor)))
    }
  },
  update: {
    check: (reason) => ipcRenderer.invoke(IPC.updateCheck, { reason }),
    download: () => ipcRenderer.invoke(IPC.updateDownload, {}),
    restart: () => ipcRenderer.invoke(IPC.updateRestart, {}),
    cancel: () => ipcRenderer.invoke(IPC.updateCancel, {}),
    notes: () => ipcRenderer.invoke(IPC.updateNotes, {}),
    onProgress: (cb) => subscribe<UpdateProgress>(IPC.updateProgress, cb),
    onShow: (cb) => subscribe<void>(IPC.updateShow, () => cb())
  },
  project: {
    suggestIcons: (wsId) => ipcRenderer.invoke(IPC.projectSuggestIcons, { wsId })
  },
  git: {
    status: (paneId) => ipcRenderer.invoke(IPC.gitStatus, { paneId }),
    diff: (paneId) => ipcRenderer.invoke(IPC.gitDiff, { paneId }),
    addWorktree: (cwd, branch, reuse = false) =>
      ipcRenderer.invoke(IPC.gitWorktreeAdd, { cwd, branch, reuse }),
    branches: (paneId) => ipcRenderer.invoke(IPC.gitBranches, { paneId }),
    switchBranch: (paneId, kind, name) => ipcRenderer.invoke(IPC.gitSwitch, { paneId, kind, name }),
    commit: (paneId, message) => ipcRenderer.invoke(IPC.gitCommit, { paneId, message }),
    push: (paneId) => ipcRenderer.invoke(IPC.gitPush, { paneId }),
    pull: (paneId) => ipcRenderer.invoke(IPC.gitPull, { paneId }),
    log: (paneId, skip) => ipcRenderer.invoke(IPC.gitLog, { paneId, skip }),
    show: (paneId, sha) => ipcRenderer.invoke(IPC.gitShow, { paneId, sha }),
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
  usage: {
    get: () => ipcRenderer.invoke(IPC.usageGet, {})
  },
  themes: {
    list: () => ipcRenderer.invoke(IPC.themesList, {}),
    import: () => ipcRenderer.invoke(IPC.themesImport, {}),
    delete: (id) => ipcRenderer.invoke(IPC.themesDelete, { id }),
    export: (theme) => ipcRenderer.invoke(IPC.themesExport, { theme }),
    save: (theme) => ipcRenderer.invoke(IPC.themesSave, { theme }),
    community: () => ipcRenderer.invoke(IPC.themesCommunity, {}),
    communityShot: (repo) => ipcRenderer.invoke(IPC.themesCommunityShot, { repo }),
    communityInstall: (repo) => ipcRenderer.invoke(IPC.themesCommunityInstall, { repo }),
    communityRemove: (id) => ipcRenderer.invoke(IPC.themesCommunityRemove, { id }),
    openFolder: () => ipcRenderer.invoke(IPC.themesOpenFolder, {})
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
