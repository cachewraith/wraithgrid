import { z } from 'zod'
import {
  CHAT_IMAGE_MAX,
  CHAT_IMAGE_TYPES,
  CHAT_IMAGES_MAX,
  CHAT_EFFORTS,
  CHAT_MODES,
  CHAT_MODEL_PATTERN,
  CHAT_SAVE_MAX,
  CHAT_TEXT_MAX,
  chatSessionIdSchema,
  type ApprovalDecision,
  type ChatAnswers,
  type ChatMode,
  type ChatEventMessage,
  type ChatImage,
  type ChatPickResult
} from './chat'
import { idSchema, sshHostSchema } from './schema'
import { themeFileSchema, type AppTheme, type ThemeFile } from './themes'
import type { PreviewEvent, PreviewRequestFailure } from './preview'
import type { UsageData } from './usage'
import type { ReleaseNote } from './whats-new'
import { SHARED_MODES, type CloseMode, type Config, type SharedMode } from './types'

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
  /** Start the CLI with its "continue the last conversation" args (a restored pane). */
  resume: z.boolean().default(false),
  /** First start after launch: reattach if the background host still runs this pane. */
  attach: z.boolean().default(false),
  cols: dim,
  rows: dim
})
export type PtyCreateArgs = z.infer<typeof ptyCreateArgs>

/** A chat pane's CLI (ADR 0002); the account is resolved in main, as for pty:create. */
export const chatStartArgs = z.object({
  paneId: idSchema,
  accountId: idSchema,
  cwd: z.string().min(1).max(4096),
  args: ptyCreateArgs.shape.args,
  /** The conversation to resume; null starts one (or continues the folder's last). */
  sessionId: chatSessionIdSchema.nullable(),
  continueLast: z.boolean().default(false),
  model: z.string().regex(CHAT_MODEL_PATTERN).nullable().default(null),
  effort: z.enum(CHAT_EFFORTS).nullable().default(null),
  mode: z.enum(CHAT_MODES).nullable().default(null)
})
export type ChatStartArgs = z.infer<typeof chatStartArgs>
/** Copies a chat's conversation into another claude account's dir before it resumes there. */
export const chatMoveAccountArgs = z.object({
  paneId: idSchema,
  toAccountId: idSchema,
  sessionId: chatSessionIdSchema
})
export const chatSendArgs = z.object({
  paneId: idSchema,
  text: z.string().max(CHAT_TEXT_MAX),
  images: z
    .array(
      z.object({
        mediaType: z.enum(CHAT_IMAGE_TYPES),
        data: z
          .string()
          .max(CHAT_IMAGE_MAX)
          .regex(/^[A-Za-z0-9+/=]*$/)
      })
    )
    .max(CHAT_IMAGES_MAX)
})
export const chatApproveArgs = z.object({
  paneId: idSchema,
  reqId: z.string().min(1).max(200),
  decision: z.enum(['allow', 'always', 'deny']),
  answers: z.record(z.string().max(2000), z.string().max(4000)).optional()
})
export const chatPaneArgs = z.object({ paneId: idSchema })
export const chatSetModelArgs = z.object({
  paneId: idSchema,
  model: z.string().regex(CHAT_MODEL_PATTERN)
})
export const chatSetModeArgs = z.object({ paneId: idSchema, mode: z.enum(CHAT_MODES) })
export const chatStopArgs = z.object({ paneId: idSchema, forget: z.boolean() })
export const chatSaveArgs = z.object({ paneId: idSchema, data: z.string().max(CHAT_SAVE_MAX) })

export const ptyWriteArgs = z.object({ paneId: idSchema, data: z.string().max(1_000_000) })
export const ptyResizeArgs = z.object({ paneId: idSchema, cols: dim, rows: dim })
export const ptyKillArgs = z.object({ paneId: idSchema })
export const pickPathArgs = z.object({ defaultPath: z.string().max(4096).optional() })
export const claudeDetectArgs = z.object({ override: z.string().max(4096).optional() })
export const accountCreateDirArgs = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/)
})
export const loginAccountArgs = z.object({ accountId: idSchema })
/** The code a sign-in page shows: printable, no spaces or line breaks (it is typed into claude). */
export const loginCodeArgs = z.object({
  accountId: idSchema,
  code: z.string().regex(/^[\x21-\x7e]{1,2048}$/)
})
/** `claude auth login` in a dialog: the sign-in link, then how it ended. */
export type LoginEvent =
  /** `deviceCode`: the one-time code to type on the page (codex device sign-in). */
  | { accountId: string; state: 'url'; url: string; deviceCode?: string }
  | {
      accountId: string
      state: 'done'
      ok: boolean
      email: string | null
      plan: string | null
      error: string | null
    }

export const accountDeleteDirArgs = z.object({
  dir: z.string().min(1).max(4096),
  confirm: z.literal(true)
})
export const openExternalArgs = z.object({ url: z.string().max(8192) })
/** A folder the picker browses or reveals: `~`, absolute, or relative to home; main resolves it. */
export const folderPathArgs = z.object({ path: z.string().max(4096) })
export const sharedApplyArgs = z.object({ mode: z.enum(SHARED_MODES) })
/** `launch` checks are skipped in unpackaged (dev and test) builds; `manual` always runs. */
export const updateCheckArgs = z.object({ reason: z.enum(['launch', 'manual']) })
export const updateInstallArgs = z.object({})
export const updateNotesArgs = z.object({})
/** git runs in the pane's folder as main has it in its own config, never a renderer path. */
export const shellListArgs = z.object({})
export const clipboardImageArgs = z.object({ paneId: idSchema })
export const gitPaneArgs = z.object({ paneId: idSchema })
export const projectIconArgs = z.object({ wsId: idSchema })
export const gitLogArgs = z.object({ paneId: idSchema, skip: z.number().int().min(0).max(100_000) })
export const gitShowArgs = z.object({ paneId: idSchema, sha: z.string().regex(/^[0-9a-f]{7,40}$/) })
export const gitWorktreeAddArgs = z.object({
  cwd: z.string().min(1).max(4096),
  branch: z.string().min(1).max(100),
  /** A team agent's branch (#79): use its folder or branch again if it is already there. */
  reuse: z.boolean().default(false)
})
export const gitCommitArgs = z.object({
  paneId: idSchema,
  message: z.string().min(1).max(5000)
})
/** A worktree folder under ~/.wraithgrid/worktrees; main checks that before touching it. */
export const gitWorktreeArgs = z.object({ cwd: z.string().min(1).max(4096) })
export const gitWorktreeRemoveArgs = gitWorktreeArgs.extend({ force: z.boolean() })
export const modsListArgs = z.object({})
/** Names one row of the last list; main checks it against its own copy before acting. */
export const modsSetEnabledArgs = z.object({
  accountId: idSchema,
  id: z.string().min(1).max(200),
  scope: z.string().min(1).max(32),
  projectPath: z.string().max(4096).nullable(),
  enabled: z.boolean()
})
export const modsCatalogArgs = z.object({})
/** Names a mod of the last catalog or list; main checks it against its own copy before installing. */
export const modsCommunityArgs = z.object({})
export const modsInstallArgs = z.object({ id: z.string().min(1).max(200) })
export const modsChangeArgs = z.object({
  id: z.string().min(1).max(200),
  change: z.enum(['uninstall', 'update'])
})
/** A downloaded mod's folder name under ~/.wraithgrid/mods; main resolves the folder. */
export const modsPullArgs = z.object({ name: z.string().min(1).max(120) })
export const modsMarketplacesArgs = z.object({})
export const modsMarketplaceAddArgs = z.object({ source: z.string().min(1).max(500) })
export const modsMarketplaceRemoveArgs = z.object({ name: z.string().min(1).max(120) })
export const themesNoArgs = z.object({})
/** A theme file's id (its name in ~/.wraithgrid/themes); main builds the path. */
export const themesDeleteArgs = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) })
export const themesExportArgs = z.object({ theme: themeFileSchema })
/** The editor's theme; main checks it again with parseThemeFile before writing. */
export const themesSaveArgs = z.object({ theme: z.unknown() })
const cliArgs = z
  .array(
    z
      .string()
      .max(1000)
      .refine((s) => !s.includes('\0'))
  )
  .max(32)
const cliPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes('\0'))

/** A `wraithgrid new|split` command, relayed by the host to the window (H6). */
export const cliActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new'),
    /** Account id or name; default: the focused pane's account, else the first one. */
    account: z.string().max(200).optional(),
    cwd: cliPath.optional(),
    shell: z.boolean().default(false),
    args: cliArgs.default([]),
    /** Workspace id or name; default: the active one. */
    workspace: z.string().max(200).optional()
  }),
  z.object({
    kind: z.literal('split'),
    /** Pane id; the new pane opens beside it with its account and folder unless given. */
    paneId: idSchema,
    account: z.string().max(200).optional(),
    cwd: cliPath.optional(),
    shell: z.boolean().optional(),
    args: cliArgs.optional()
  })
])
export type CliAction = z.infer<typeof cliActionSchema>
export type CliActionResult = { ok: true; paneId: string } | { ok: false; error: string }
export const cliResultArgs = z.object({
  id: z.number().int().nonnegative(),
  result: z.union([
    z.object({ ok: z.literal(true), paneId: idSchema }),
    z.object({ ok: z.literal(false), error: z.string().max(500) })
  ])
})

export const machineTestArgs = z.object({
  name: z.string().min(1).max(64),
  sshHost: sshHostSchema
})
export type MachineTestResult =
  { ok: true; appVersion: string; live: number } | { ok: false; error: string }

export const previewPaneArgs = z.object({ paneId: idSchema })
export const previewCaptureArgs = z.object({ webContentsId: z.number().int().positive() })

export interface PreviewEventMessage {
  paneId: string
  event: PreviewEvent
}

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

export type PtyCreateResult =
  | {
      ok: true
      pid: number
      /** Reattached to a pane the background host kept; set if it ended while detached. */
      exit?: { exitCode: number; signal: number | null } | null
    }
  | { ok: false; error: string }

export interface PtyDataEvent {
  paneId: string
  data: string
  /** A reattached pane's screen: drawn, but not counted as new output. */
  replay?: boolean
}

export interface PtyExitEvent {
  paneId: string
  exitCode: number
  signal: number | null
  /** Set when the process never started (bad path, missing cwd). */
  error?: string
  /** The connection to its machine dropped; the process may still run there (H5). */
  disconnected?: boolean
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
  /** Bytes are null until the download reports them. */
  | {
      phase: 'downloading'
      version: string
      percent: number
      transferred: number | null
      total: number | null
    }
  /** Downloaded and checked; installs when the user picks Restart now. */
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }

export type UpdateInstallResult =
  | { ok: true }
  /** `manual`: this build can't update itself (e.g. a tarball); offer the release page. */
  | { ok: false; error: string; manual: boolean }
  /** The user cancelled the download: back to "available", nothing to report. */
  | { ok: false; cancelled: true }

/** About's notes: the installed version's (bundled or saved) and earlier ones, newest first. */
export interface ReleaseNotesView {
  current: string
  /** The version that ran before an update, for one "Updated to …" notice; else null. */
  updatedFrom: string | null
  installed: ReleaseNote | null
  earlier: ReleaseNote[]
}

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

/** A commit, push or worktree removal; `detail` is a short line for the user. */
/** One folder's subfolders for the New chat picker; paths are shown with `~`. */
export type FolderListResult =
  | {
      ok: true
      path: string
      /** null at the root. */
      parent: string | null
      entries: { name: string; hidden: boolean; git: boolean }[]
      /** More folders than the cap: only the first ones are listed. */
      truncated: boolean
      /** The folder's own git branch, when it is a repository. */
      branch: string | null
    }
  | { ok: false; path: string; parent: string | null; error: string }

export type GitActionResult = { ok: true; detail: string } | { ok: false; error: string }

/** One commit in the history graph; `refs` as git decorates it (`HEAD -> main`, `tag: v1`). */
export interface GitCommit {
  sha: string
  parents: string[]
  author: string
  /** Committer time in ms. */
  time: number
  refs: string[]
  subject: string
}
export type GitLogResult =
  { ok: true; commits: GitCommit[]; more: boolean } | { ok: false; error: string }
export type GitShowResult =
  { ok: true; patch: string; truncated: boolean } | { ok: false; error: string }

/** A folder's branches, newest commit first; `remote` lists only ones not checked out locally. */
export interface GitBranches {
  current: string | null
  local: { name: string; when: string; upstream: string | null }[]
  remote: { name: string; when: string }[]
}
export type GitBranchesResult = ({ ok: true } & GitBranches) | { ok: false; error: string }
export const gitSwitchArgs = z.object({
  paneId: idSchema,
  kind: z.enum(['local', 'remote', 'create']),
  name: z.string().min(1).max(255)
})

export type GitWorktreeCheck =
  | { ok: true; branch: string | null; changed: number; mainRoot: string }
  | { ok: false; error: string }

/** An installed shell offered in Settings; `args` are the ones it needs (Git Bash: login). */
export interface ShellOption {
  name: string
  path: string
  args: string[]
}

/** One installed mod (a claude plugin), as the account's own `claude plugin list` reports it. */
export interface ModInfo {
  /** `name@marketplace`. */
  id: string
  version: string
  /** user, project, local, synced… as claude names it. */
  scope: string
  enabled: boolean
  /** Set for project and local scopes: the project it is installed for. */
  projectPath: string | null
  /** The page of the marketplace it came from, when that has one. */
  url: string | null
  /** claude's own remarks, e.g. that another mod of the same name takes precedence. */
  notes: string[]
}

/** A mod offered by a marketplace, as an account's `claude plugin list --available` reports it. */
export interface CatalogMod {
  /** `name@marketplace`: what `claude plugin install` takes. */
  id: string
  name: string
  description: string
  marketplace: string
  version: string | null
  /** How many installs the marketplace counts, where it says. */
  installs: number | null
  /** Its repository's GitHub stars, for a mod from the community list. */
  stars: number | null
  /** The mod's https source page, when it has one. */
  url: string | null
  /**
   * `owner/repo` of a community mod that is a bare plugin (no marketplace file): it is not
   * installed but downloaded into a mod folder. Null for everything `plugin install` takes.
   */
  clone: string | null
}

/** A marketplace merged over the claude accounts: how many of them have it. */
export interface MarketplaceInfo {
  name: string
  url: string | null
  accounts: number
}

export type MarketplacesResult =
  { ok: true; marketplaces: MarketplaceInfo[]; total: number } | { ok: false; error: string }

export type ModCloneResult = { ok: true; dir: string } | { ok: false; error: string }

/** `changed` is false when the mod was already up to date. */
export type ModPullResult = { ok: true; changed: boolean } | { ok: false; error: string }

export type ModCatalogResult = { ok: true; mods: CatalogMod[] } | { ok: false; error: string }

/** An install covers every claude account; `failed` names the ones claude refused it for. */
export type ModInstallResult =
  { ok: true; failed: { account: string; error: string }[] } | { ok: false; error: string }

export type AccountMods =
  { accountId: string; ok: true; mods: ModInfo[] } | { accountId: string; ok: false; error: string }

export type ChatStartResult =
  { ok: true; pid: number | null; attached: boolean } | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export interface ThemeListResult {
  themes: AppTheme[]
  /** Files in the themes folder that could not be loaded, and why. */
  problems: { file: string; error: string }[]
}
export type ThemeImportResult = { ok: true; id: string } | { ok: false; error: string }

/** One theme in the community gallery (#24), from its repository's manifest. */
export interface CommunityTheme {
  /** `owner/repo` on GitHub. */
  repo: string
  name: string
  author: string
  version: string
  minAppVersion: string | null
  description: string
  modes: ('dark' | 'light')[]
  /** Installed as this theme id, at this version; null when not installed. */
  installedId: string | null
  installedVersion: string | null
  update: boolean
  /** Needs a newer Wraithgrid than this one. */
  tooNew: boolean
}
export interface CommunityThemeList {
  themes: CommunityTheme[]
}
export type CommunityThemesResult =
  ({ ok: true } & CommunityThemeList) | { ok: false; error: string }
export const communityRepoArgs = z.object({ repo: z.string().min(3).max(300) })
export const communityIdArgs = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) })
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
  /** Chat panes (ADR 0002): the CLI runs headless and speaks ChatEvents. */
  chat: {
    start(args: ChatStartArgs): Promise<ChatStartResult>
    /** Copies the conversation to another claude account's dir (the chat must be stopped). */
    moveAccount(paneId: string, toAccountId: string, sessionId: string): Promise<SimpleResult>
    send(paneId: string, text: string, images: ChatImage[]): void
    approve(paneId: string, reqId: string, decision: ApprovalDecision, answers?: ChatAnswers): void
    interrupt(paneId: string): void
    /** Switches the running chat's model at once (the next turn uses it). */
    setModel(paneId: string, model: string): void
    /** Switches the running chat's permission mode at once. */
    setMode(paneId: string, mode: ChatMode): void
    /** Stops the process; `forget` also deletes the saved conversation view. */
    stop(paneId: string, forget: boolean): void
    onEvent(cb: (m: ChatEventMessage) => void): () => void
    /** The conversation view saved for this pane, as `save` got it. */
    load(paneId: string): Promise<string | null>
    save(paneId: string, data: string): void
    /** The native file picker in the pane's folder; null when cancelled. */
    pickFiles(paneId: string): Promise<ChatPickResult | null>
    /** A dropped file's path on disk ('' when it has none). */
    filePath(file: File): string
  }
  config: {
    get(): Promise<Config>
    set(config: Config): Promise<SimpleResult>
  }
  dialog: {
    pickFolder(defaultPath?: string): Promise<string | null>
    pickFile(defaultPath?: string): Promise<string | null>
  }
  fs: {
    /** A folder's subfolders (names and kind only), resolved and read in main. */
    listFolder(path: string): Promise<FolderListResult>
    /** Opens the folder in the system file manager. */
    reveal(path: string): Promise<SimpleResult>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
    /** Main saved a "remember my choice" from the close dialog. */
    onCloseMode(cb: (mode: CloseMode) => void): () => void
  }
  claude: {
    detect(override?: string): Promise<ClaudeDetectResult>
  }
  account: {
    createDir(slug: string): Promise<CreateDirResult>
    deleteDir(dir: string): Promise<SimpleResult>
  }
  /** Signs a claude account in from a dialog (`claude auth login` over pipes in main). */
  login: {
    start(accountId: string): Promise<SimpleResult>
    code(accountId: string, code: string): void
    cancel(accountId: string): void
    onEvent(cb: (e: LoginEvent) => void): () => void
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
    /** Zooms the whole page (Chromium page zoom, so terminal mouse input stays exact). */
    setZoom(factor: number): void
  }
  update: {
    /** Asks GitHub Releases whether a newer version than this one is published. */
    check(reason: 'launch' | 'manual'): Promise<UpdateCheckResult>
    /** Downloads the newest release and checks it; then it waits for restart(). */
    download(): Promise<UpdateInstallResult>
    /** Installs the downloaded release over this one and restarts the app. */
    restart(): Promise<UpdateInstallResult>
    /** Stops a download in progress. */
    cancel(): Promise<void>
    /** Release notes for About, kept across updates. */
    notes(): Promise<ReleaseNotesView>
    onProgress(cb: (p: UpdateProgress) => void): () => void
    /** The user clicked the new-release notification: show the updates section. */
    onShow(cb: () => void): () => void
  }
  project: {
    /**
     * Icons that fit a project, read from its folder's marker files (#80); [] when remote,
     * null while main doesn't know the project yet (just created, config not saved).
     */
    suggestIcons(wsId: string): Promise<string[] | null>
  }
  git: {
    status(paneId: string): Promise<GitStatus>
    diff(paneId: string): Promise<GitDiffResult>
    /** Creates a worktree on a new branch for `cwd`'s repo; returns its folder. */
    addWorktree(cwd: string, branch: string, reuse?: boolean): Promise<GitWorktreeResult>
    /** Local and remote branches of the pane's folder. */
    branches(paneId: string): Promise<GitBranchesResult>
    /** Checks out a branch in the pane's folder (every pane on that folder sees it). */
    switchBranch(
      paneId: string,
      kind: 'local' | 'remote' | 'create',
      name: string
    ): Promise<GitActionResult>
    /** Stages everything in the pane's folder and commits it. */
    commit(paneId: string, message: string): Promise<GitActionResult>
    /** Pushes the pane's branch (sets the upstream on the first push). */
    push(paneId: string): Promise<GitActionResult>
    /** Fetches and pulls the pane's branch from its upstream (git's own merge/rebase setting). */
    pull(paneId: string): Promise<GitActionResult>
    /** A page of the history (all branches and tags), newest first. */
    log(paneId: string, skip: number): Promise<GitLogResult>
    /** One commit's patch. */
    show(paneId: string, sha: string): Promise<GitShowResult>
    /** Opens the pull-request page for the pane's branch in the browser. */
    openPullRequest(paneId: string): Promise<GitActionResult>
    /** Branch and uncommitted count of a Wraithgrid worktree, before removing it. */
    checkWorktree(
      cwd: string
    ): Promise<{ ok: true; branch: string | null; changed: number } | { ok: false; error: string }>
    removeWorktree(cwd: string, force: boolean): Promise<GitActionResult>
  }
  shells: {
    /** Shells installed on this machine, for the Settings picker. */
    list(): Promise<ShellOption[]>
  }
  clipboard: {
    /**
     * Saves the clipboard's image to a temp file and returns the text to paste for it into
     * this agent pane (its path, or `@path` for gemini/agy); null when there is no image.
     */
    image(paneId: string): Promise<string | null>
  }
  /** Chat-turn cost and tokens (90 days) and plan limits, recorded in main. */
  usage: {
    get(): Promise<UsageData>
  }
  /** Theme files in ~/.wraithgrid/themes. Import and export ask for a file; null = canceled. */
  themes: {
    list(): Promise<ThemeListResult>
    import(): Promise<ThemeImportResult | null>
    delete(id: string): Promise<SimpleResult>
    export(theme: ThemeFile): Promise<SimpleResult | null>
    /** The community gallery; its screenshots one at a time (data URLs). */
    community(): Promise<CommunityThemesResult>
    communityShot(repo: string): Promise<string | null>
    /** Installs or updates a theme from `owner/repo` or a github.com URL. */
    communityInstall(repo: string): Promise<ThemeImportResult>
    communityRemove(id: string): Promise<SimpleResult>
    /** Saves the editor's theme as a new file in the themes folder. */
    save(theme: ThemeFile): Promise<ThemeImportResult>
    openFolder(): Promise<SimpleResult>
  }
  mods: {
    /** Asks each claude account's CLI for its installed mods. */
    list(): Promise<AccountMods[]>
    /** Enables or disables one listed mod through the account's CLI. */
    setEnabled(
      accountId: string,
      mod: Pick<ModInfo, 'id' | 'scope' | 'projectPath'>,
      enabled: boolean
    ): Promise<SimpleResult>
    /** Every mod the marketplaces of all claude accounts offer, merged by id. */
    catalog(): Promise<ModCatalogResult>
    /** The mods claudemod.com lists that can be installed; contacts that site and GitHub. */
    community(): Promise<ModCatalogResult>
    /** Installs a mod for every claude account that lacks it (user scope), each through its CLI. */
    install(id: string): Promise<ModInstallResult>
    /** Uninstalls or updates a listed mod in every claude account that has it. */
    change(id: string, change: 'uninstall' | 'update'): Promise<ModInstallResult>
    /** Downloads a community bare-plugin mod into ~/.wraithgrid/mods; returns its folder. */
    clone(id: string): Promise<ModCloneResult>
    /** Pulls the newest commit of a downloaded mod (`~/.wraithgrid/mods/<name>`). */
    pull(name: string): Promise<ModPullResult>
    /** The marketplaces of all claude accounts, merged by name. */
    marketplaces(): Promise<MarketplacesResult>
    /** Adds a marketplace (`owner/repo` or an https address) to every account that lacks it. */
    addMarketplace(source: string): Promise<ModInstallResult>
    /** Removes a marketplace from every account that has it. */
    removeMarketplace(name: string): Promise<ModInstallResult>
  }
  /** Web preview (#74): the dev server of a preview pane, in its project's folder. */
  preview: {
    /** The command found in the pane's folder (package.json, lockfile, artisan), or null. */
    detect(paneId: string): Promise<{ command: string; source: string } | null>
    /** Runs the project's saved command; output and exit arrive as events. */
    start(paneId: string): Promise<SimpleResult>
    stop(paneId: string): void
    onEvent(cb: (m: PreviewEventMessage) => void): () => void
    /** A screenshot of a preview's page (by its webview's web contents id). */
    capture(
      webContentsId: number
    ): Promise<
      { ok: true; image: ChatImage; width: number; height: number } | { ok: false; error: string }
    >
    /** Requests from any preview page that failed; each view keeps its own by id. */
    onRequestFailed(cb: (f: PreviewRequestFailure) => void): () => void
  }
  notify: {
    /** An OS notification about a pane; clicking it brings the window back to that pane. */
    pane(paneId: string, title: string, body: string): void
    onReveal(cb: (paneId: string) => void): () => void
  }
  machines: {
    /** Host names from ~/.ssh/config, for the Add machine field. */
    sshHosts(): Promise<string[]>
    /** Connects over ssh once and says which Wraithgrid answered. */
    test(name: string, sshHost: string): Promise<MachineTestResult>
  }
  cli: {
    /** A `wraithgrid new|split` command to carry out; answer it with `reply`. */
    onAction(cb: (id: number, action: CliAction) => void): () => void
    reply(id: number, result: CliActionResult): void
  }
}
