import { readFile, stat, mkdir, realpath, rm } from 'node:fs/promises'
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
import { contractHome, expandHome } from '@shared/paths'
import {
  IPC,
  accountCreateDirArgs,
  accountDeleteDirArgs,
  claudeDetectArgs,
  openExternalArgs,
  sharedApplyArgs,
  updateCheckArgs,
  updateInstallArgs,
  gitPaneArgs,
  gitWorktreeAddArgs,
  modsCatalogArgs,
  modsCommunityArgs,
  modsInstallArgs,
  modsListArgs,
  modsSetEnabledArgs,
  notifyPaneArgs,
  pickPathArgs,
  shellListArgs,
  clipboardImageArgs,
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
  type ModCatalogResult,
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
import { AGENT_CLI_BIN, AGENT_CLI_LABEL, type AgentCli, type Config } from '@shared/types'
import type { ConfigStore } from './config-store'
import {
  INSTALL_TIMEOUT_MS,
  claudeRunner,
  listMarketplaces,
  listModCatalog,
  listMods,
  marketplaceAddArgs,
  modInstallArgs,
  modToggleArgs,
  withModLinks,
  type Marketplace
} from './mods'
import type { CommunityCatalog, CommunityMods } from './mod-community'
import { buildPaneEnv } from './pane-env'
import { addWorktree, gitDiff, gitStatus, type GitRunner } from './git'
import { accountsRoot, isStrictlyInside, resolveUserPath, worktreesRoot } from './paths'
import { listShells, resolvePaneShell, spawnCommandFor, type DesktopInfo } from './platform'
import {
  ensureSource,
  linkShared,
  overallSourceDir,
  unlinkShared,
  type ItemResult
} from './shared-config'
import type { PtyManager } from './pty-manager'
import type { UpdateChecker } from './update-check'
import type { UpdateInstaller } from './update-install'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  store: ConfigStore
  ptys: PtyManager
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
}

const log = (msg: string): void => console.warn(`[wraithgrid] ${msg}`)
const fileExists = (f: string): Promise<boolean> =>
  access(f).then(
    () => true,
    () => false
  )

export function registerIpc(deps: IpcDeps): void {
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
      const cfg = store.get()
      let configDir: string | null = null
      let cli: AgentCli = 'claude'
      if (!a.shell) {
        const account = cfg.accounts.find((x) => x.id === a.accountId)
        if (!account) return fail('This pane has no account. Pick one in the New pane dialog.')
        configDir = account.configDir
        cli = account.cli
      }

      const cwd = resolveUserPath(a.cwd, homeDir)
      try {
        if (!(await stat(cwd)).isDirectory()) return fail(`Not a folder: ${a.cwd}`)
      } catch {
        return fail(`Folder not found: ${a.cwd}`)
      }

      await deps.envReady
      if (!a.shell && cli === 'claude' && a.accountId) await syncShared(a.accountId)
      let file: string
      let args = a.args
      if (a.shell) {
        const picked = await resolvePaneShell(
          process.platform,
          process.env,
          findOnPath,
          fileExists,
          {
            // A bare name stays bare: it is looked up on PATH.
            path: expandHome(cfg.settings.shellPath.trim(), homeDir),
            args: cfg.settings.shellArgs
          }
        )
        if (!picked.ok) return fail(picked.error)
        file = picked.shell.file
        args = picked.shell.args
      } else if (cli !== 'claude') {
        const bin = AGENT_CLI_BIN[cli]
        const found = await findOnPath(bin)
        if (!found) return fail(`${bin} (${AGENT_CLI_LABEL[cli]}) was not found on PATH.`)
        file = found
      } else {
        const resolved = await resolveClaudePath(cfg.claudePath, homeDir)
        if (!resolved.path) return fail('claude was not found on PATH. Set its path in Settings.')
        try {
          if (!(await stat(resolved.path)).isFile()) return fail(`Not a file: ${resolved.path}`)
        } catch {
          return fail(`claude binary not found: ${resolved.path}`)
        }
        file = resolved.path
      }

      const cmd = spawnCommandFor(process.platform, file, args, process.env.ComSpec)
      if (!cmd.ok) return fail(cmd.error)
      const env = buildPaneEnv({
        baseEnv: process.env,
        shell: a.shell,
        cli,
        configDir,
        homeDir,
        modDirs: cfg.settings.modDirs
      })
      return ptys.create({
        paneId: a.paneId,
        file: cmd.file,
        args: cmd.args,
        cwd,
        env,
        cols: a.cols,
        rows: a.rows
      })
    },
    fail('Invalid request')
  )

  listen(IPC.ptyWrite, ptyWriteArgs, (a) => ptys.write(a.paneId, a.data))
  listen(IPC.ptyResize, ptyResizeArgs, (a) => ptys.resize(a.paneId, a.cols, a.rows))
  listen(IPC.ptyKill, ptyKillArgs, (a) => void ptys.kill(a.paneId))

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
      // One catalog serves every account: an install adds the marketplace where it is missing.
      let error = ''
      for (const account of accounts) {
        try {
          const markets = await readMarketplaces(runner.run, account)
          const mods = await listModCatalog(
            runner.run,
            accountEnv(account.configDir),
            homeDir,
            markets
          )
          offeredMods = new Set(mods.map((m) => m.id))
          return { ok: true, mods }
        } catch (err) {
          error ||= (err as Error).message
        }
      }
      return fail(error)
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
      const offered = offeredMods.has(a.id) || community.mods.some((m) => m.id === a.id)
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
}
