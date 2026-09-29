import { stat, mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import type { z } from 'zod'
import { contractHome } from '@shared/paths'
import {
  IPC,
  accountCreateDirArgs,
  accountDeleteDirArgs,
  claudeDetectArgs,
  openExternalArgs,
  sharedApplyArgs,
  pickPathArgs,
  ptyCreateArgs,
  ptyKillArgs,
  ptyResizeArgs,
  ptyWriteArgs,
  type AppInfo,
  type CreateDirResult,
  type PtyCreateResult,
  type SharedApplyResult,
  type SharedReportEntry,
  type SimpleResult
} from '@shared/ipc-contract'
import { access } from 'node:fs/promises'
import { detectClaude, findOnPath, resolveClaudePath } from './claude-detect'
import type { Config } from '@shared/types'
import type { ConfigStore } from './config-store'
import { buildPaneEnv } from './pane-env'
import { accountsRoot, isStrictlyInside, resolveUserPath } from './paths'
import { resolveDefaultShell, spawnCommandFor, type DesktopInfo } from './platform'
import { ensureSource, linkShared, unlinkShared, type ItemResult } from './shared-config'
import type { PtyManager } from './pty-manager'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  store: ConfigStore
  ptys: PtyManager
  homeDir: string
  desktop: DesktopInfo
  /** Resolves once PATH from the login shell is merged in (launcher-started sessions). */
  envReady: Promise<void>
  /** Called after a valid config replaced the old one. */
  onConfigChanged?: (prev: Config, next: Config) => void
}

const log = (msg: string): void => console.warn(`[wraithgrid] ${msg}`)

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

  /** Links the shared CLAUDE.md and skills into one account, if sharing is on. */
  const syncShared = async (accountId: string): Promise<void> => {
    const cfg = store.get()
    const source = cfg.accounts.find((x) => x.id === cfg.settings.sharedSourceAccountId)
    const account = cfg.accounts.find((x) => x.id === accountId)
    if (!source || !account || source.id === account.id) return
    try {
      await ensureSource(dirOf(source))
      const failed = (await linkShared(dirOf(source), dirOf(account))).filter(
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
      if (!a.shell) {
        const account = cfg.accounts.find((x) => x.id === a.accountId)
        if (!account) return fail('This pane has no account. Pick one in the New pane dialog.')
        configDir = account.configDir
      }

      const cwd = resolveUserPath(a.cwd, homeDir)
      try {
        if (!(await stat(cwd)).isDirectory()) return fail(`Not a folder: ${a.cwd}`)
      } catch {
        return fail(`Folder not found: ${a.cwd}`)
      }

      await deps.envReady
      if (!a.shell && a.accountId) await syncShared(a.accountId)
      let file: string
      if (a.shell) {
        file = await resolveDefaultShell(
          process.platform,
          process.env,
          (name) => findOnPath(name),
          (f) =>
            access(f).then(
              () => true,
              () => false
            )
        )
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

      const cmd = spawnCommandFor(
        process.platform,
        file,
        a.shell ? [] : a.args,
        process.env.ComSpec
      )
      if (!cmd.ok) return fail(cmd.error)
      const env = buildPaneEnv({ baseEnv: process.env, shell: a.shell, configDir, homeDir })
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
      const next = a.sourceAccountId
        ? cfg.accounts.find((x) => x.id === a.sourceAccountId)
        : undefined
      if (a.sourceAccountId && !next) return fail('That account no longer exists')
      const prev = cfg.accounts.find((x) => x.id === cfg.settings.sharedSourceAccountId)
      const report: SharedReportEntry[] = []
      const add = (account: string, results: ItemResult[]): void => {
        results.forEach((r) => report.push({ account, ...r }))
      }
      // Switching or stopping: take the old links out first, restoring what they replaced.
      if (prev && prev.id !== next?.id) {
        for (const acc of cfg.accounts) add(acc.name, await unlinkShared(dirOf(prev), dirOf(acc)))
      }
      if (next) {
        await ensureSource(dirOf(next))
        for (const acc of cfg.accounts) {
          if (acc.id !== next.id) add(acc.name, await linkShared(dirOf(next), dirOf(acc)))
        }
      }
      log(
        next
          ? `sharing CLAUDE.md and skills from ${next.name} with ${cfg.accounts.length - 1} accounts`
          : 'stopped sharing CLAUDE.md and skills'
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
