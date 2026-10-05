import { z } from 'zod'
import { idSchema } from './schema'
import { SHARED_MODES, type Config, type SharedMode } from './types'

export { IPC } from './ipc-channels'

const dim = z.number().int().min(1).max(1000)

export const ptyCreateArgs = z.object({
  paneId: idSchema,
  /** The account is resolved in main from its own config copy, never from a renderer path. */
  accountId: idSchema.nullable(),
  cwd: z.string().min(1).max(4096),
  args: z
    .array(
      z
        .string()
        .max(1000)
        .refine((s) => !s.includes('\0'))
    )
    .max(32),
  shell: z.boolean(),
  cols: dim,
  rows: dim
})
export type PtyCreateArgs = z.infer<typeof ptyCreateArgs>

export const ptyWriteArgs = z.object({ paneId: idSchema, data: z.string().max(1_000_000) })
export const ptyResizeArgs = z.object({ paneId: idSchema, cols: dim, rows: dim })
export const ptyKillArgs = z.object({ paneId: idSchema })
export const pickPathArgs = z.object({ defaultPath: z.string().max(4096).optional() })
export const claudeDetectArgs = z.object({ override: z.string().max(4096).optional() })
export const accountCreateDirArgs = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/)
})
export const accountDeleteDirArgs = z.object({
  dir: z.string().min(1).max(4096),
  confirm: z.literal(true)
})
export const openExternalArgs = z.object({ url: z.string().max(8192) })
export const sharedApplyArgs = z.object({ mode: z.enum(SHARED_MODES) })
/** `launch` checks are skipped in unpackaged (dev and test) builds; `manual` always runs. */
export const updateCheckArgs = z.object({ reason: z.enum(['launch', 'manual']) })
export const updateInstallArgs = z.object({})
/** git runs in the pane's folder as main has it in its own config, never a renderer path. */
export const shellListArgs = z.object({})
export const gitPaneArgs = z.object({ paneId: idSchema })
export const gitWorktreeAddArgs = z.object({
  cwd: z.string().min(1).max(4096),
  branch: z.string().min(1).max(100)
})
export const notifyPaneArgs = z.object({
  paneId: idSchema,
  title: z.string().min(1).max(120),
  body: z.string().max(300)
})

export interface SharedReportEntry {
  account: string
  item: string
  outcome: 'linked' | 'already-linked' | 'unlinked' | 'restored' | 'failed'
  /** Where an existing file was moved to (linking) or restored from (unlinking). */
  backup?: string
  error?: string
}
export type SharedApplyResult =
  { ok: true; report: SharedReportEntry[] } | { ok: false; error: string }

export type PtyCreateResult = { ok: true; pid: number } | { ok: false; error: string }

export interface PtyDataEvent {
  paneId: string
  data: string
}

export interface PtyExitEvent {
  paneId: string
  exitCode: number
  signal: number | null
  /** Set when the process never started (bad path, missing cwd). */
  error?: string
}

export interface ClaudeDetectResult {
  /** The binary that will be spawned, or null when nothing usable was found. */
  path: string | null
  source: 'override' | 'path' | null
  version: string | null
  ok: boolean
  error?: string
}

export interface AppInfo {
  homeDir: string
  platform: string
  configPath: string
  version: string
  /**
   * custom: our title bar; overlay: Windows caption buttons; tiling: tiling compositor;
   * mac: macOS traffic lights inset at the left.
   */
  chrome: 'custom' | 'overlay' | 'tiling' | 'mac'
  desktop: string | null
}

export interface ReleaseInfo {
  /** Without the leading `v`, e.g. "1.2.0". */
  version: string
  /** The release page on GitHub, built by main from the tag, never taken from the response. */
  url: string
  /** Release notes as plain text (Markdown source), trimmed. */
  notes: string
  publishedAt: string | null
}

export type UpdateCheckResult =
  | { status: 'available'; current: string; latest: ReleaseInfo; checkedAt: number }
  | { status: 'current'; current: string; latest: ReleaseInfo; checkedAt: number }
  | { status: 'skipped'; current: string }
  | { status: 'error'; current: string; error: string; checkedAt: number }

/** Where an in-app update is; sent from main while it downloads and installs. */
export type UpdateProgress =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'installing'; version: string }

export type UpdateInstallResult =
  | { ok: true }
  /** `manual`: this build can't update itself (e.g. a tarball); offer the release page. */
  | { ok: false; error: string; manual: boolean }

export interface GitStatus {
  /** False when the folder is not inside a git work tree (or git is missing). */
  repo: boolean
  /** null on a detached HEAD. */
  branch: string | null
  ahead: number
  behind: number
  /** Changed, staged and untracked paths. */
  changed: number
}

export type GitDiffResult =
  | { ok: true; patch: string; truncated: boolean; untracked: string[] }
  | { ok: false; error: string }

export type GitWorktreeResult = { ok: true; dir: string } | { ok: false; error: string }

/** An installed shell offered in Settings; `args` are the ones it needs (Git Bash: login). */
export interface ShellOption {
  name: string
  path: string
  args: string[]
}

export type SimpleResult = { ok: true } | { ok: false; error: string }
export type CreateDirResult = { ok: true; dir: string } | { ok: false; error: string }

/** Shape of `window.wraith`, exposed by the preload script. */
export interface WraithApi {
  pty: {
    create(args: PtyCreateArgs): Promise<PtyCreateResult>
    write(paneId: string, data: string): void
    resize(paneId: string, cols: number, rows: number): void
    kill(paneId: string): void
    onData(cb: (e: PtyDataEvent) => void): () => void
    onExit(cb: (e: PtyExitEvent) => void): () => void
  }
  config: {
    get(): Promise<Config>
    set(config: Config): Promise<SimpleResult>
  }
  dialog: {
    pickFolder(defaultPath?: string): Promise<string | null>
    pickFile(defaultPath?: string): Promise<string | null>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  claude: {
    detect(override?: string): Promise<ClaudeDetectResult>
  }
  account: {
    createDir(slug: string): Promise<CreateDirResult>
    deleteDir(dir: string): Promise<SimpleResult>
  }
  shell: {
    openExternal(url: string): Promise<SimpleResult>
  }
  shared: {
    /** Points every other account at this account's CLAUDE.md and skills (null: stop sharing). */
    apply(mode: SharedMode): Promise<SharedApplyResult>
  }
  app: {
    info(): Promise<AppInfo>
  }
  update: {
    /** Asks GitHub Releases whether a newer version than this one is published. */
    check(reason: 'launch' | 'manual'): Promise<UpdateCheckResult>
    /** Downloads the newest release, installs it over this one and restarts the app. */
    install(): Promise<UpdateInstallResult>
    onProgress(cb: (p: UpdateProgress) => void): () => void
    /** The user clicked the new-release notification: show the updates section. */
    onShow(cb: () => void): () => void
  }
  git: {
    status(paneId: string): Promise<GitStatus>
    diff(paneId: string): Promise<GitDiffResult>
    /** Creates a worktree on a new branch for `cwd`'s repo; returns its folder. */
    addWorktree(cwd: string, branch: string): Promise<GitWorktreeResult>
  }
  shells: {
    /** Shells installed on this machine, for the Settings picker. */
    list(): Promise<ShellOption[]>
  }
  notify: {
    /** An OS notification about a pane; clicking it brings the window back to that pane. */
    pane(paneId: string, title: string, body: string): void
    onReveal(cb: (paneId: string) => void): () => void
  }
}
