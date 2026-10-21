import { readFile, stat, mkdir, realpath, rm } from 'node:fs/promises'
import { writeFileAtomic } from './config-store'
import path from 'node:path'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import type { z } from 'zod'
import { marketplaceOf } from '@shared/mods'
import { contractHome } from '@shared/paths'
import {
  IPC,
  chatApproveArgs,
  chatPaneArgs,
  chatSaveArgs,
  chatSendArgs,
  chatSetModelArgs,
  chatStartArgs,
  chatStopArgs,
  type ChatStartResult,
  accountCreateDirArgs,
  accountDeleteDirArgs,
  claudeDetectArgs,
  openExternalArgs,
  sharedApplyArgs,
  updateCheckArgs,
  updateInstallArgs,
  gitPaneArgs,
  gitWorktreeAddArgs,
  gitWorktreeArgs,
  gitWorktreeRemoveArgs,
  gitCommitArgs,
  gitSwitchArgs,
  type GitBranchesResult,
  modsCatalogArgs,
  modsCommunityArgs,
  modsInstallArgs,
  modsChangeArgs,
  modsMarketplacesArgs,
  modsPullArgs,
  modsMarketplaceAddArgs,
  modsMarketplaceRemoveArgs,
  modsListArgs,
  modsSetEnabledArgs,
  notifyPaneArgs,
  pickPathArgs,
  shellListArgs,
  clipboardImageArgs,
  cliActionSchema,
  cliResultArgs,
  machineTestArgs,
  type CliActionResult,
  ptyCreateArgs,
  ptyKillArgs,
  ptyResizeArgs,
  ptyWriteArgs,
  type AccountMods,
  type AppInfo,
  type CreateDirResult,
  type GitDiffResult,
  type GitStatus,
  type GitWorktreeResult,
  type GitActionResult,
  type ModCatalogResult,
  type ModCloneResult,
  type ModPullResult,
  type MarketplaceInfo,
  type MarketplacesResult,
  type CatalogMod,
  type ModInstallResult,
  type ModInfo,
  type PtyCreateResult,
  type SharedApplyResult,
  type SharedReportEntry,
  type ShellOption,
  type SimpleResult,
  type UpdateCheckResult,
  type UpdateInstallResult
} from '@shared/ipc-contract'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import {
  imagePasteText,
  pickImageMime,
  readClipboardImage,
  saveClipboardImage
} from './clipboard-image'
import { detectClaude, findOnPath, resolveClaudePath } from './claude-detect'
import type { AgentCli } from '@shared/agent-clis'
import type { Config } from '@shared/types'
import type { ConfigStore } from './config-store'
import {
  GITHUB_REPO,
  INSTALL_TIMEOUT_MS,
  MARKETPLACE_NAME,
  claudeRunner,
  lastLine,
  listMarketplaces,
  listModCatalog,
  listMods,
  marketplaceAddArgs,
  marketplaceRemoveArgs,
  mergeCatalogs,
  modChangeArgs,
  modInstallArgs,
  modToggleArgs,
  withModLinks,
  type Marketplace
} from './mods'
import type { CommunityCatalog, CommunityMods } from './mod-community'
import { buildPaneEnv } from './pane-env'
import {
  addWorktree,
  checkWorktree,
  commitAll,
  gitDiff,
  gitStatus,
  listBranches,
  pullRequestLink,
  pushBranch,
  removeWorktree,
  switchBranch,
  type GitRunner
} from './git'
import { accountsRoot, isStrictlyInside, resolveUserPath, worktreesRoot } from './paths'
import { listShells, type DesktopInfo } from './platform'
import {
  ensureSource,
  linkShared,
  overallSourceDir,
  unlinkShared,
  type ItemResult
} from './shared-config'
import type { PaneRouter } from './pane-router'
import { sshConfigHosts } from './ssh'
import type { SpawnSpec } from './spawn-resolve'
import { resolveSpawn } from './spawn-resolve'
import { chatAdapterFor } from './chat/adapter'
import type { ChatSessions } from './chat/sessions'
import type { UpdateChecker } from './update-check'
import type { UpdateInstaller } from './update-install'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  store: ConfigStore
  ptys: Pick<PaneRouter, 'create' | 'spawnOn' | 'attach' | 'write' | 'resize' | 'kill' | 'probe'>
  homeDir: string
  desktop: DesktopInfo
  /** Resolves once PATH from the login shell is merged in (launcher-started sessions). */
  envReady: Promise<void>
  updates: UpdateChecker
  /** The claudemod.com mod list; read only when the user opens it. */
  community: CommunityCatalog
  installer: UpdateInstaller
  /** Launch-time update checks only run in packaged builds. */
  isPackaged: boolean
  /** Sees every launch-time check result (e.g. to raise an OS notification). */
  onLaunchUpdateCheck?: (result: UpdateCheckResult) => void
  /** Called after a valid config replaced the old one. */
  onConfigChanged?: (prev: Config, next: Config) => void
  git: GitRunner
  /** Shows an OS notification about a pane; a click should bring that pane forward. */
  notifyPane: (paneId: string, title: string, body: string) => void
  /** Chat panes' headless CLI processes (ADR 0002). */
  chats: ChatSessions
  /** Where each chat pane's conversation view is saved (`<paneId>.json`). */
  chatDir: string
}

const log = (msg: string): void => console.warn(`[wraithgrid] ${msg}`)

/** The machine a pane's workspace runs on (H5); null: this computer. */
export function machineOfPane(cfg: Config, paneId: string): string | null {
  return cfg.workspaces.find((w) => w.panes.some((p) => p.id === paneId))?.machineId ?? null
}
const fileExists = (f: string): Promise<boolean> =>
  access(f).then(
    () => true,
    () => false
  )

export interface IpcHandle {
  /** Carries out a `wraithgrid new|split` command in the window (relayed by the host). */
  runCliAction(action: Record<string, unknown>): Promise<CliActionResult>
}

export function registerIpc(deps: IpcDeps): IpcHandle {
  const { store, ptys, homeDir } = deps

  /** Only our own window may call in; anything else (e.g. a navigated frame) is refused. */
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const win = deps.getWindow()
    return (
      !!win &&
      !win.isDestroyed() &&
      e.sender === win.webContents &&
      e.senderFrame === win.webContents.mainFrame
    )
  }

  function handle<S extends z.ZodType, R>(
    channel: string,
    schema: S,
    fn: (args: z.infer<S>) => Promise<R> | R,
    rejected: R
  ): void {
    ipcMain.handle(channel, async (e, raw: unknown) => {
      if (!trusted(e)) {
        log(`refused ${channel} from an untrusted sender`)
        return rejected
      }
      const parsed = schema.safeParse(raw ?? {})
      if (!parsed.success) {
        log(`refused ${channel}: invalid arguments`)
        return rejected
      }
      try {
        return await fn(parsed.data)
      } catch (err) {
        log(`${channel} failed: ${(err as Error).message}`)
        return rejected
      }
    })
  }

  function listen<S extends z.ZodType>(
    channel: string,
    schema: S,
    fn: (args: z.infer<S>) => void
  ): void {
    ipcMain.on(channel, (e, raw: unknown) => {
      if (!trusted(e)) return
      const parsed = schema.safeParse(raw)
      if (parsed.success) fn(parsed.data)
    })
  }

  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
  const dirOf = (acc: { configDir: string }): string => resolveUserPath(acc.configDir, homeDir)

  const sharedSource = overallSourceDir(homeDir)

  /** Links the machine's CLAUDE.md, settings, skills and plugins into one account, if sharing is overall. */
  const syncShared = async (accountId: string): Promise<void> => {
    const cfg = store.get()
    const account = cfg.accounts.find((x) => x.id === accountId)
    if (cfg.settings.sharedMode !== 'overall' || !account) return
    try {
      await ensureSource(sharedSource)
      const failed = (await linkShared(sharedSource, dirOf(account))).filter(
        (r) => r.outcome === 'failed'
      )
      failed.forEach((r) => log(`could not link shared ${r.item} for ${account.name}: ${r.error}`))
    } catch (err) {
      log(`could not share CLAUDE.md and skills with ${account.name}: ${(err as Error).message}`)
    }
  }

  // ---- PTY -------------------------------------------------------------------------

  handle(
    IPC.ptyCreate,
    ptyCreateArgs,
    async (a): Promise<PtyCreateResult> => {
      if (a.attach) {
        const kept = await ptys.attach(a.paneId, a.cols, a.rows)
        if (kept) return { ok: true, pid: kept.pid, exit: kept.exit }
      }
      const cfg = store.get()
      let configDir: string | null = null
      let cli: AgentCli = 'claude'
      if (!a.shell) {
        const account = cfg.accounts.find((x) => x.id === a.accountId)
        if (!account) return fail('This pane has no account. Pick one in the New pane dialog.')
        configDir = account.configDir
        cli = account.cli
      }
      const spec: SpawnSpec = {
        paneId: a.paneId,
        cli,
        shell: a.shell,
        configDir,
        cwd: a.cwd,
        args: a.args,
        resume: a.resume,
        cols: a.cols,
        rows: a.rows
      }
      // A remote workspace's panes are resolved and started on that machine (H5).
      const machine = machineOfPane(cfg, a.paneId)
      if (machine) return ptys.spawnOn(machine, spec)

      await deps.envReady
      if (!a.shell && cli === 'claude' && a.accountId) await syncShared(a.accountId)
      const resolved = await resolveSpawn(spec, {
        platform: process.platform,
        env: process.env,
        homeDir,
        claudePath: cfg.claudePath,
        cliPaths: cfg.settings.cliPaths,
        shellPath: cfg.settings.shellPath,
        shellArgs: cfg.settings.shellArgs,
        modDirs: cfg.settings.modDirs
      })
      if (!resolved.ok) return fail(resolved.error)
      return ptys.create(resolved.req)
    },
    fail('Invalid request')
  )

  // ---- Chat panes (ADR 0002) -------------------------------------------------------

  const { chats } = deps
  handle(
    IPC.chatStart,
    chatStartArgs,
    async (a): Promise<ChatStartResult> => {
      // The window reloaded (renderer crash): its process kept running.
      if (chats.has(a.paneId)) return { ok: true, pid: null, attached: true }
      const cfg = store.get()
      if (machineOfPane(cfg, a.paneId))
        return fail('Chat runs on this computer only. Switch this pane to Terminal.')
      const account = cfg.accounts.find((x) => x.id === a.accountId)
      if (!account) return fail('This pane has no account. Pick one in the New pane dialog.')
      const adapter = chatAdapterFor(account.cli)
      if (!adapter)
        return fail(`${account.cli} has no chat view yet. Switch this pane to Terminal.`)
      await deps.envReady
      if (account.cli === 'claude') await syncShared(account.id)
      const resolved = await resolveSpawn(
        {
          paneId: a.paneId,
          cli: account.cli,
          shell: false,
          configDir: account.configDir,
          cwd: a.cwd,
          args: [
            ...a.args,
            ...adapter.args({
              sessionId: a.sessionId,
              continueLast: a.continueLast,
              model: a.model,
              effort: a.effort
            })
          ],
          resume: false,
          cols: 80,
          rows: 24
        },
        {
          platform: process.platform,
          env: process.env,
          homeDir,
          claudePath: cfg.claudePath,
          cliPaths: cfg.settings.cliPaths,
          shellPath: cfg.settings.shellPath,
          shellArgs: cfg.settings.shellArgs,
          modDirs: cfg.settings.modDirs
        }
      )
      if (!resolved.ok) return fail(resolved.error)
      const { file, args, cwd, env } = resolved.req
      const { pid } = chats.start(a.paneId, { file, args, cwd, env }, adapter)
      return { ok: true, pid, attached: false }
    },
    fail('Invalid request')
  )
  listen(IPC.chatSend, chatSendArgs, (a) => chats.send(a.paneId, a.text, a.images))
  listen(IPC.chatApprove, chatApproveArgs, (a) => chats.approve(a.paneId, a.reqId, a.decision))
  listen(IPC.chatInterrupt, chatPaneArgs, (a) => chats.interrupt(a.paneId))
  listen(IPC.chatSetModel, chatSetModelArgs, (a) => chats.setModel(a.paneId, a.model))
  const chatFile = (paneId: string): string => path.join(deps.chatDir, `${paneId}.json`)
  listen(IPC.chatStop, chatStopArgs, (a) => {
    void chats.stop(a.paneId)
    if (a.forget) void rm(chatFile(a.paneId), { force: true }).catch(() => {})
  })
  handle(
    IPC.chatLoad,
    chatPaneArgs,
    (a) => readFile(chatFile(a.paneId), 'utf8').catch(() => null),
    null
  )
  listen(IPC.chatSave, chatSaveArgs, (a) => {
    void mkdir(deps.chatDir, { recursive: true, mode: 0o700 })
      .then(() => writeFileAtomic(chatFile(a.paneId), a.data))
      .catch((err: Error) => log(`could not save chat ${a.paneId}: ${err.message}`))
  })

  listen(IPC.ptyWrite, ptyWriteArgs, (a) => ptys.write(a.paneId, a.data))
  listen(IPC.ptyResize, ptyResizeArgs, (a) => ptys.resize(a.paneId, a.cols, a.rows))
  listen(IPC.ptyKill, ptyKillArgs, (a) => ptys.kill(a.paneId))

  // ---- Config ----------------------------------------------------------------------

  ipcMain.handle(IPC.configGet, (e) => (trusted(e) ? store.get() : null))
  ipcMain.handle(IPC.configSet, (e, raw: unknown): SimpleResult => {
    if (!trusted(e)) return fail('Refused')
    const prev = store.get()
    const result = store.set(raw)
    if (!result.ok) log('refused config:set: validation failed')
    else deps.onConfigChanged?.(prev, store.get())
    return result
  })

  // ---- Dialogs ---------------------------------------------------------------------

  const pick = async (
    kind: 'openDirectory' | 'openFile',
    defaultPath?: string
  ): Promise<string | null> => {
    const win = deps.getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: kind === 'openDirectory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
      defaultPath: defaultPath ? resolveUserPath(defaultPath, homeDir) : homeDir
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  }
  handle(IPC.dialogPickFolder, pickPathArgs, (a) => pick('openDirectory', a.defaultPath), null)
  handle(IPC.dialogPickFile, pickPathArgs, (a) => pick('openFile', a.defaultPath), null)

  // ---- Window ----------------------------------------------------------------------

  ipcMain.on(IPC.windowMinimize, (e) => {
    if (trusted(e)) deps.getWindow()?.minimize()
  })
  ipcMain.on(IPC.windowMaximize, (e) => {
    const win = deps.getWindow()
    if (!trusted(e) || !win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => {
    if (trusted(e)) deps.getWindow()?.close()
  })

  // ---- claude binary ---------------------------------------------------------------

  handle(
    IPC.claudeDetect,
    claudeDetectArgs,
    async (a) => {
      await deps.envReady
      return detectClaude(a.override ?? store.get().claudePath, homeDir)
    },
    { path: null, source: null, version: null, ok: false, error: 'Detection failed' }
  )

  // ---- Account dirs ----------------------------------------------------------------

  handle(
    IPC.accountCreateDir,
    accountCreateDirArgs,
    async (a): Promise<CreateDirResult> => {
      const dir = path.join(accountsRoot(homeDir), a.slug)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      return { ok: true, dir: contractHome(dir, homeDir) }
    },
    fail('Could not create the config dir')
  )

  handle(
    IPC.accountDeleteDir,
    accountDeleteDirArgs,
    async (a): Promise<SimpleResult> => {
      const target = resolveUserPath(a.dir, homeDir)
      // Only a dir that a current account points at, and only inside the home dir.
      const owned = store
        .get()
        .accounts.some((acc) => resolveUserPath(acc.configDir, homeDir) === target)
      if (!owned) return fail('That folder does not belong to an account')
      if (!isStrictlyInside(target, homeDir))
        return fail('Refusing to delete a folder outside your home directory')
      let real: string
      try {
        real = await realpath(target)
      } catch {
        return { ok: true } // Already gone.
      }
      const realHome = await realpath(homeDir)
      if (!isStrictlyInside(real, realHome))
        return fail('Refusing to delete a folder outside your home directory')
      // Drop the links to ~/.claude first so a recursive delete can never reach through them.
      await unlinkShared(sharedSource, real)
      await rm(real, { recursive: true, force: true })
      log(`deleted account config dir ${contractHome(target, homeDir)} at the user's request`)
      return { ok: true }
    },
    fail('Could not delete the config dir')
  )

  // ---- Shared CLAUDE.md and skills ---------------------------------------------------

  handle(
    IPC.sharedApply,
    sharedApplyArgs,
    async (a): Promise<SharedApplyResult> => {
      const cfg = store.get()
      const report: SharedReportEntry[] = []
      const add = (account: string, results: ItemResult[]): void => {
        results.forEach((r) => report.push({ account, ...r }))
      }
      if (a.mode === 'overall') {
        await ensureSource(sharedSource)
        for (const acc of cfg.accounts) add(acc.name, await linkShared(sharedSource, dirOf(acc)))
      } else {
        // Take the links out, restoring what they replaced.
        for (const acc of cfg.accounts) add(acc.name, await unlinkShared(sharedSource, dirOf(acc)))
      }
      log(
        a.mode === 'overall'
          ? `sharing ~/.claude with ${cfg.accounts.length} accounts`
          : 'stopped sharing ~/.claude'
      )
      return { ok: true, report }
    },
    fail('Could not update the shared CLAUDE.md and skills')
  )

  // ---- External links --------------------------------------------------------------

  handle(
    IPC.shellOpenExternal,
    openExternalArgs,
    async (a): Promise<SimpleResult> => {
      let url: URL
      try {
        url = new URL(a.url)
      } catch {
        return fail('Invalid URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return fail('Only http and https links open')
      await shell.openExternal(url.href)
      return { ok: true }
    },
    fail('Could not open the link')
  )

  // ---- Updates ---------------------------------------------------------------------

  handle(
    IPC.updateCheck,
    updateCheckArgs,
    async (a): Promise<UpdateCheckResult> => {
      if (a.reason === 'launch' && !deps.isPackaged) {
        return { status: 'skipped', current: app.getVersion() }
      }
      const r = await deps.updates.check()
      if (r.status === 'error') log(`update check failed: ${r.error}`)
      if (a.reason === 'launch') deps.onLaunchUpdateCheck?.(r)
      return r
    },
    {
      status: 'error',
      current: app.getVersion(),
      error: 'The update check failed.',
      checkedAt: Date.now()
    }
  )

  handle(
    IPC.updateInstall,
    updateInstallArgs,
    (): Promise<UpdateInstallResult> => deps.installer.install(),
    { ok: false, error: 'The update could not be installed.', manual: false }
  )

  // ---- Git -------------------------------------------------------------------------

  /** The pane's folder from main's own config copy. */
  const paneCwd = (paneId: string): string | null => {
    for (const ws of store.get().workspaces) {
      const pane = ws.panes.find((p) => p.id === paneId)
      if (pane) return resolveUserPath(pane.cwd, homeDir)
    }
    return null
  }
  const noRepo: GitStatus = { repo: false, branch: null, ahead: 0, behind: 0, changed: 0 }

  handle(
    IPC.gitStatus,
    gitPaneArgs,
    async (a): Promise<GitStatus> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return noRepo
      await deps.envReady
      return gitStatus(deps.git, cwd)
    },
    noRepo
  )

  handle(
    IPC.gitDiff,
    gitPaneArgs,
    async (a): Promise<GitDiffResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      await deps.envReady
      return gitDiff(deps.git, cwd)
    },
    fail('Could not read the diff')
  )

  handle(
    IPC.gitWorktreeAdd,
    gitWorktreeAddArgs,
    async (a): Promise<GitWorktreeResult> => {
      const cwd = resolveUserPath(a.cwd, homeDir)
      try {
        if (!(await stat(cwd)).isDirectory()) return fail(`Not a folder: ${a.cwd}`)
      } catch {
        return fail(`Folder not found: ${a.cwd}`)
      }
      await deps.envReady
      const r = await addWorktree(deps.git, cwd, a.branch, worktreesRoot(homeDir))
      if (!r.ok) return r
      log(`created worktree ${contractHome(r.dir, homeDir)} on branch ${a.branch}`)
      return { ok: true, dir: contractHome(r.dir, homeDir) }
    },
    fail('Could not create the worktree')
  )

  /** A Wraithgrid worktree folder (real path under ~/.wraithgrid/worktrees), or null. */
  const ownWorktree = async (cwd: string): Promise<string | null> => {
    try {
      const dir = await realpath(resolveUserPath(cwd, homeDir))
      const root = await realpath(worktreesRoot(homeDir))
      return isStrictlyInside(dir, root) ? dir : null
    } catch {
      return null
    }
  }

  handle(
    IPC.gitWorktreeCheck,
    gitWorktreeArgs,
    async (a) => {
      const dir = await ownWorktree(a.cwd)
      if (!dir) return fail('Not a Wraithgrid worktree.')
      await deps.envReady
      const r = await checkWorktree(deps.git, dir)
      return r.ok ? { ok: true as const, branch: r.branch, changed: r.changed } : r
    },
    fail('Could not check the worktree')
  )

  handle(
    IPC.gitWorktreeRemove,
    gitWorktreeRemoveArgs,
    async (a): Promise<GitActionResult> => {
      const dir = await ownWorktree(a.cwd)
      if (!dir) return fail('Not a Wraithgrid worktree.')
      await deps.envReady
      const r = await removeWorktree(deps.git, dir, a.force)
      if (r.ok) log(`removed worktree ${contractHome(dir, homeDir)}${a.force ? ' (forced)' : ''}`)
      return r
    },
    fail('Could not remove the worktree')
  )

  /** Git runs here: a pane on another machine has its folder there (H5). */
  const remoteFail = (paneId: string): { ok: false; error: string } | null =>
    machineOfPane(store.get(), paneId)
      ? fail('Branches of panes on another machine can’t be switched from here yet.')
      : null

  handle(
    IPC.gitBranches,
    gitPaneArgs,
    async (a): Promise<GitBranchesResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      const remote = remoteFail(a.paneId)
      if (remote) return remote
      await deps.envReady
      return listBranches(deps.git, cwd)
    },
    fail('Invalid request')
  )

  handle(
    IPC.gitSwitch,
    gitSwitchArgs,
    async (a): Promise<GitActionResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      const remote = remoteFail(a.paneId)
      if (remote) return remote
      await deps.envReady
      return switchBranch(deps.git, cwd, { kind: a.kind, name: a.name })
    },
    fail('Invalid request')
  )

  handle(
    IPC.gitCommit,
    gitCommitArgs,
    async (a): Promise<GitActionResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      await deps.envReady
      return commitAll(deps.git, cwd, a.message)
    },
    fail('Could not commit')
  )

  handle(
    IPC.gitPush,
    gitPaneArgs,
    async (a): Promise<GitActionResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      await deps.envReady
      return pushBranch(deps.git, cwd)
    },
    fail('Could not push')
  )

  handle(
    IPC.gitOpenPr,
    gitPaneArgs,
    async (a): Promise<GitActionResult> => {
      const cwd = paneCwd(a.paneId)
      if (!cwd) return fail('That pane is gone.')
      await deps.envReady
      const r = await pullRequestLink(deps.git, cwd)
      if (!r.ok) return r
      await shell.openExternal(r.url)
      return { ok: true, detail: 'Opened in your browser' }
    },
    fail('Could not open the pull request page')
  )

  // ---- Shells ----------------------------------------------------------------------

  handle(
    IPC.shellList,
    shellListArgs,
    async (): Promise<ShellOption[]> => {
      await deps.envReady
      return listShells(process.platform, process.env, findOnPath, fileExists, (f) =>
        readFile(f, 'utf8').catch(() => null)
      )
    },
    []
  )

  // ---- Clipboard images ------------------------------------------------------------

  handle(
    IPC.clipboardImage,
    clipboardImageArgs,
    async (a): Promise<string | null> => {
      const cfg = store.get()
      const pane = cfg.workspaces.flatMap((w) => w.panes).find((p) => p.id === a.paneId)
      const account = pane && !pane.shell && cfg.accounts.find((x) => x.id === pane.accountId)
      if (!account) return null
      const image = await readClipboardImage({
        readNative: async () => {
          for (const item of await clipboard.read()) {
            const picked = pickImageMime(item.types)
            if (!picked) continue
            const blob = await item.getType(picked[0])
            if (blob instanceof Blob)
              return { data: Buffer.from(await blob.arrayBuffer()), ext: picked[1] }
          }
          return null
        },
        run: (file, args) =>
          new Promise((resolve) =>
            execFile(
              file,
              args,
              { encoding: 'buffer', timeout: 3000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
              (err, stdout) => resolve(err ? null : stdout)
            )
          ),
        wayland: deps.desktop.wayland
      })
      if (!image) return null
      const file = await saveClipboardImage(
        image,
        path.join(app.getPath('temp'), 'wraithgrid-paste')
      )
      return imagePasteText(account.cli, file)
    },
    null
  )

  // ---- Mods ------------------------------------------------------------------------

  /** What each account's claude last listed; a toggle must name a row from here. */
  const listedMods = new Map<string, ModInfo[]>()
  /** The marketplaces each account's claude last listed: mod links, and what an install adds. */
  const marketplaces = new Map<string, Marketplace[]>()
  const MODS_PARALLEL = 4

  /** The claude binary as a runner, or the reason there is none. */
  const modRunner = async (): Promise<
    { ok: true; run: ReturnType<typeof claudeRunner> } | { ok: false; error: string }
  > => {
    await deps.envReady
    const resolved = await resolveClaudePath(store.get().claudePath, homeDir)
    if (!resolved.path) return fail('claude was not found on PATH. Set its path in Settings.')
    return { ok: true, run: claudeRunner(resolved.path) }
  }
  const accountEnv = (configDir: string): Record<string, string> =>
    buildPaneEnv({ baseEnv: process.env, shell: false, cli: 'claude', configDir, homeDir })
  /** Links are an extra: an account whose claude cannot list marketplaces still lists its mods. */
  const readMarketplaces = async (
    run: ReturnType<typeof claudeRunner>,
    acc: Config['accounts'][number]
  ): Promise<Marketplace[]> => {
    const found = await listMarketplaces(run, accountEnv(acc.configDir), homeDir).catch(() => [])
    marketplaces.set(acc.id, found)
    return found
  }

  handle(
    IPC.modsList,
    modsListArgs,
    async (): Promise<AccountMods[]> => {
      const accounts = store.get().accounts.filter((x) => x.cli === 'claude')
      const runner = await modRunner()
      if (!runner.ok) return accounts.map((x) => ({ accountId: x.id, ...runner }))
      const out: AccountMods[] = []
      for (let i = 0; i < accounts.length; i += MODS_PARALLEL) {
        const batch = accounts
          .slice(i, i + MODS_PARALLEL)
          .map(async (acc): Promise<AccountMods> => {
            try {
              const env = accountEnv(acc.configDir)
              const [markets, plain] = await Promise.all([
                readMarketplaces(runner.run, acc),
                listMods(runner.run, env, homeDir)
              ])
              const mods = withModLinks(plain, markets)
              listedMods.set(acc.id, mods)
              return { accountId: acc.id, ok: true, mods }
            } catch (err) {
              listedMods.delete(acc.id)
              return { accountId: acc.id, ok: false, error: (err as Error).message }
            }
          })
        out.push(...(await Promise.all(batch)))
      }
      return out
    },
    []
  )

  handle(
    IPC.modsSetEnabled,
    modsSetEnabledArgs,
    async (a): Promise<SimpleResult> => {
      const account = store.get().accounts.find((x) => x.id === a.accountId && x.cli === 'claude')
      const mod = listedMods
        .get(a.accountId)
        ?.find((m) => m.id === a.id && m.scope === a.scope && m.projectPath === a.projectPath)
      if (!account || !mod) return fail('That mod is no longer listed. Refresh the list.')
      const args = modToggleArgs(mod, a.enabled)
      if (!args) return fail('That mod cannot be changed from here.')
      const runner = await modRunner()
      if (!runner.ok) return runner
      // A project-scoped mod is switched from its own project folder, as claude lists it.
      let cwd = homeDir
      if (mod.projectPath) {
        try {
          if ((await stat(mod.projectPath)).isDirectory()) cwd = mod.projectPath
        } catch {
          return fail(`Project folder not found: ${contractHome(mod.projectPath, homeDir)}`)
        }
      }
      try {
        await runner.run(args, { env: accountEnv(account.configDir), cwd })
      } catch (err) {
        return fail((err as Error).message)
      }
      log(`${a.enabled ? 'enabled' : 'disabled'} mod ${mod.id} for ${account.name}`)
      return { ok: true }
    },
    fail('Could not change the mod')
  )

  /** The ids the last catalog offered; an install must name one of them or a listed mod. */
  let offeredMods = new Set<string>()
  /** The same for the community list, with the repository each mod's marketplace comes from. */
  let community: CommunityMods = { mods: [], marketplaces: [] }
  const claudeAccounts = (): Config['accounts'] =>
    store.get().accounts.filter((x) => x.cli === 'claude')

  handle(
    IPC.modsCatalog,
    modsCatalogArgs,
    async (): Promise<ModCatalogResult> => {
      const accounts = claudeAccounts()
      if (accounts.length === 0) return fail('No claude account yet.')
      const runner = await modRunner()
      if (!runner.ok) return runner
      // Every account's marketplaces, merged: an install adds the marketplace where missing.
      const lists: CatalogMod[][] = []
      let error = ''
      for (let i = 0; i < accounts.length; i += MODS_PARALLEL) {
        const batch = accounts.slice(i, i + MODS_PARALLEL).map(async (account) => {
          try {
            const markets = await readMarketplaces(runner.run, account)
            return await listModCatalog(runner.run, accountEnv(account.configDir), homeDir, markets)
          } catch (err) {
            error ||= (err as Error).message
            return null
          }
        })
        for (const list of await Promise.all(batch)) if (list) lists.push(list)
      }
      if (lists.length === 0) return fail(error)
      const mods = mergeCatalogs(lists)
      offeredMods = new Set(mods.map((m) => m.id))
      return { ok: true, mods }
    },
    fail('Could not read the mod catalog')
  )

  handle(
    IPC.modsCommunity,
    modsCommunityArgs,
    async (): Promise<ModCatalogResult> => {
      try {
        community = await deps.community.read()
        return { ok: true, mods: community.mods }
      } catch (err) {
        return fail((err as Error).message)
      }
    },
    fail('Could not read claudemod.com')
  )

  handle(
    IPC.modsInstall,
    modsInstallArgs,
    async (a): Promise<ModInstallResult> => {
      const args = modInstallArgs(a.id)
      const has = (accountId: string): boolean =>
        listedMods.get(accountId)?.some((m) => m.id === a.id && m.scope === 'user') ?? false
      const accounts = claudeAccounts()
      const offered = offeredMods.has(a.id) || community.mods.some((m) => m.id === a.id && !m.clone)
      if (!args || !(offered || accounts.some((x) => has(x.id))))
        return fail('That mod is no longer offered. Refresh the list.')
      const runner = await modRunner()
      if (!runner.ok) return runner
      const market = marketplaceOf(a.id)
      // A marketplace an account already has wins over the community list's one of that name.
      const source = [...[...marketplaces.values()].flat(), ...community.marketplaces].find(
        (m) => m.name === market && m.add
      )
      const addArgs = source?.add ? marketplaceAddArgs(source.add) : null
      const failed: { account: string; error: string }[] = []
      // One account at a time: accounts that share ~/.claude write the same plugin files.
      for (const account of accounts.filter((x) => !has(x.id))) {
        const opts = {
          env: accountEnv(account.configDir),
          cwd: homeDir,
          timeoutMs: INSTALL_TIMEOUT_MS
        }
        try {
          const known = marketplaces.get(account.id)
          if (addArgs && known && !known.some((m) => m.name === market)) {
            await runner.run(addArgs, opts)
            marketplaces.set(account.id, [...known, source!])
            log(`added marketplace ${market} for ${account.name}`)
          }
          await runner.run(args, opts)
          log(`installed mod ${a.id} for ${account.name}`)
        } catch (err) {
          failed.push({ account: account.name, error: (err as Error).message })
        }
      }
      return { ok: true, failed }
    },
    fail('Could not install the mod')
  )

  /** Runs `args` for each account in turn, collecting the ones claude refused. */
  const forEachAccount = async (
    accounts: Config['accounts'],
    argsFor: (account: Config['accounts'][number]) => { args: string[]; cwd?: string } | null,
    what: string
  ): Promise<ModInstallResult> => {
    const runner = await modRunner()
    if (!runner.ok) return runner
    const failed: { account: string; error: string }[] = []
    // One account at a time: accounts that share ~/.claude write the same plugin files.
    for (const account of accounts) {
      const step = argsFor(account)
      if (!step) continue
      try {
        await runner.run(step.args, {
          env: accountEnv(account.configDir),
          cwd: step.cwd ?? homeDir,
          timeoutMs: INSTALL_TIMEOUT_MS
        })
        log(`${what} for ${account.name}`)
      } catch (err) {
        failed.push({ account: account.name, error: (err as Error).message })
      }
    }
    return { ok: true, failed }
  }

  handle(
    IPC.modsChange,
    modsChangeArgs,
    async (a): Promise<ModInstallResult> => {
      // Only rows the last list showed: a project-scoped mod changes from its own folder.
      const rowFor = (accountId: string): ModInfo | undefined =>
        listedMods.get(accountId)?.find((m) => m.id === a.id)
      const accounts = claudeAccounts().filter((x) => rowFor(x.id))
      if (accounts.length === 0) return fail('That mod is no longer listed. Refresh the list.')
      return forEachAccount(
        accounts,
        (account) => {
          const row = rowFor(account.id)!
          const args = modChangeArgs(row, a.change)
          return args ? { args, cwd: row.projectPath ?? homeDir } : null
        },
        `${a.change === 'uninstall' ? 'uninstalled' : 'updated'} mod ${a.id}`
      )
    },
    fail('Could not change the mod')
  )

  handle(
    IPC.modsMarketplaces,
    modsMarketplacesArgs,
    async (): Promise<MarketplacesResult> => {
      const accounts = claudeAccounts()
      const runner = await modRunner()
      if (!runner.ok) return runner
      const lists = await Promise.all(accounts.map((acc) => readMarketplaces(runner.run, acc)))
      const merged = new Map<string, MarketplaceInfo>()
      for (const m of lists.flat()) {
        const had = merged.get(m.name)
        merged.set(m.name, {
          name: m.name,
          url: had?.url ?? m.url,
          accounts: (had?.accounts ?? 0) + 1
        })
      }
      return { ok: true, marketplaces: [...merged.values()], total: accounts.length }
    },
    fail('Could not list the marketplaces')
  )

  handle(
    IPC.modsMarketplaceAdd,
    modsMarketplaceAddArgs,
    async (a): Promise<ModInstallResult> => {
      const source = a.source.trim()
      const args = marketplaceAddArgs(source)
      if (!args) return fail('Give a GitHub repository (owner/repo) or an https address.')
      return forEachAccount(claudeAccounts(), () => ({ args }), `added marketplace ${source}`)
    },
    fail('Could not add the marketplace')
  )

  handle(
    IPC.modsMarketplaceRemove,
    modsMarketplaceRemoveArgs,
    async (a): Promise<ModInstallResult> => {
      const args = marketplaceRemoveArgs(a.name)
      if (!args) return fail('Not a marketplace name.')
      const has = (id: string): boolean =>
        marketplaces.get(id)?.some((m) => m.name === a.name) ?? false
      const accounts = claudeAccounts().filter((x) => has(x.id))
      if (accounts.length === 0) return fail('No account has that marketplace. Refresh the list.')
      const r = await forEachAccount(accounts, () => ({ args }), `removed marketplace ${a.name}`)
      for (const x of accounts)
        marketplaces.set(
          x.id,
          (marketplaces.get(x.id) ?? []).filter((m) => m.name !== a.name)
        )
      return r
    },
    fail('Could not remove the marketplace')
  )

  handle(
    IPC.modsClone,
    modsInstallArgs,
    async (a): Promise<ModCloneResult> => {
      // Only a repository the last community list offered, into a folder named by its mod.
      const mod = community.mods.find((m) => m.id === a.id && m.clone)
      if (!mod?.clone || !GITHUB_REPO.test(mod.clone) || !MARKETPLACE_NAME.test(mod.name))
        return fail('That mod is no longer offered. Refresh the list.')
      const root = path.join(homeDir, '.wraithgrid', 'mods')
      const dir = path.join(root, mod.name)
      if (!isStrictlyInside(dir, root)) return fail('Not a safe folder name.')
      try {
        await stat(dir)
        return fail(`${contractHome(dir, homeDir)} already exists.`)
      } catch {
        // Not there yet: clone it.
      }
      await mkdir(root, { recursive: true })
      await deps.envReady
      try {
        await deps.git(
          ['clone', '--depth', '1', '--', `https://github.com/${mod.clone}.git`, dir],
          root,
          { slow: true }
        )
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return fail(lastLine(e.stderr || e.message || '') ?? 'git clone failed')
      }
      log(`downloaded mod ${mod.name} from ${mod.clone}`)
      return { ok: true, dir: contractHome(dir, homeDir) }
    },
    fail('Could not download the mod')
  )

  handle(
    IPC.modsPull,
    modsPullArgs,
    async (a): Promise<ModPullResult> => {
      // Only a clone Download made: a folder of the user's own is theirs to update.
      if (!MARKETPLACE_NAME.test(a.name)) return fail('Not a mod name.')
      const root = path.join(homeDir, '.wraithgrid', 'mods')
      const dir = path.join(root, a.name)
      if (!isStrictlyInside(dir, root)) return fail('Not a safe folder name.')
      try {
        await stat(path.join(dir, '.git'))
      } catch {
        return fail(`${contractHome(dir, homeDir)} is not a downloaded mod.`)
      }
      await deps.envReady
      try {
        const before = await deps.git(['rev-parse', 'HEAD'], dir)
        await deps.git(['pull', '--ff-only'], dir, { slow: true })
        const after = await deps.git(['rev-parse', 'HEAD'], dir)
        if (before.trim() !== after.trim()) log(`updated mod ${a.name}`)
        return { ok: true, changed: before.trim() !== after.trim() }
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return fail(lastLine(e.stderr || e.message || '') ?? 'git pull failed')
      }
    },
    fail('Could not update the mod')
  )

  // ---- Pane notifications ----------------------------------------------------------

  listen(IPC.notifyPane, notifyPaneArgs, (a) => {
    if (paneCwd(a.paneId)) deps.notifyPane(a.paneId, a.title, a.body)
  })

  // ---- App info --------------------------------------------------------------------

  ipcMain.handle(IPC.appInfo, (e): AppInfo | null =>
    trusted(e)
      ? {
          homeDir,
          platform: process.platform,
          configPath: contractHome(store.file, homeDir),
          version: app.getVersion(),
          chrome: deps.desktop.chrome,
          desktop: deps.desktop.desktop
        }
      : null
  )

  // ---- Machines (H5) -----------------------------------------------------------------

  ipcMain.handle(IPC.machineSshHosts, async (e): Promise<string[]> => {
    if (!trusted(e)) return []
    try {
      return sshConfigHosts(await readFile(path.join(homeDir, '.ssh', 'config'), 'utf8'))
    } catch {
      return []
    }
  })
  handle(
    IPC.machineTest,
    machineTestArgs,
    (a) => ptys.probe({ id: 'probe', name: a.name, sshHost: a.sshHost }),
    fail('Invalid machine')
  )

  // ---- wraithgrid new|split (H6): the host relays them; the window owns the layout --

  const pendingCli = new Map<number, (r: CliActionResult) => void>()
  let nextCliId = 1
  listen(IPC.cliResult, cliResultArgs, (a) => {
    const done = pendingCli.get(a.id)
    pendingCli.delete(a.id)
    done?.(a.result)
  })

  return {
    async runCliAction(raw) {
      const parsed = cliActionSchema.safeParse(raw)
      if (!parsed.success) return fail('Invalid command')
      const action = parsed.data
      if (action.cwd) {
        try {
          if (!(await stat(resolveUserPath(action.cwd, homeDir))).isDirectory())
            return fail(`Not a folder: ${action.cwd}`)
        } catch {
          return fail(`Folder not found: ${action.cwd}`)
        }
      }
      const win = deps.getWindow()
      if (!win || win.isDestroyed())
        return fail('The Wraithgrid window is closed. Open it to add panes.')
      const id = nextCliId++
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingCli.delete(id)
          resolve(fail('The Wraithgrid window did not answer.'))
        }, 20_000)
        pendingCli.set(id, (r) => {
          clearTimeout(timer)
          resolve(r)
        })
        win.webContents.send(IPC.cliAction, { id, action })
      })
    }
  }
}
