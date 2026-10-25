import { z } from 'zod'
import { CHAT_EFFORTS, CHAT_MODES, CHAT_MODEL_PATTERN, chatSessionIdSchema } from './chat'
import { LOCAL_DATETIME_PATTERN, SCHEDULE_RUNS_MAX, SCHEDULES_MAX, TIME_PATTERN } from './schedule'
import {
  ACCENTS,
  ACCOUNT_COLORS,
  AGENT_CLIS,
  SHORTCUT_IDS,
  TEAM_MAX,
  CONFIG_VERSION,
  DIFF_WIDTH_DEFAULT,
  DIFF_WIDTH_MAX,
  DIFF_WIDTH_MIN,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MOD_DIRS_MAX,
  SHARED_MODES,
  CLOSE_MODES,
  PANE_VIEWS,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TERMINAL_FONTS,
  TERMINAL_PALETTES,
  type Config,
  type LayoutNode
} from './types'

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)

const pathSchema = z.string().min(1).max(4096)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** An icon tint; '' means neutral. Cosmetic, so a bad value resets instead of failing the file. */
const tintSchema = z.union([z.literal(''), colorSchema]).catch('')
/** Projects draw it again as `set:name` (#80); accounts and folders keep it unused. */
const iconSchema = z.string().max(64).catch('')

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('pane'), paneId: idSchema }),
    z.object({ type: z.literal('empty'), slotId: idSchema }),
    z
      .object({
        type: z.literal('split'),
        dir: z.enum(['row', 'col']),
        sizes: z.array(z.number().min(0).max(100)),
        children: z.array(layoutNodeSchema).min(1).max(16)
      })
      .refine((n) => n.sizes.length === n.children.length, 'sizes must match children')
  ])
)

export const accountSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(64),
  cli: z.enum(AGENT_CLIS).catch('claude'),
  configDir: pathSchema,
  color: colorSchema,
  signedIn: z.boolean().default(false),
  imported: z.boolean().default(false),
  icon: iconSchema,
  folderId: idSchema.nullable().default(null)
})

export const accountFolderSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(64),
  collapsed: z.boolean().default(false),
  icon: iconSchema,
  color: tintSchema
})

export const paneSchema = z.object({
  id: idSchema,
  accountId: idSchema.nullable(),
  cwd: pathSchema,
  args: z.array(z.string().max(1000)).max(32).default([]),
  shell: z.boolean().default(false),
  title: z.string().max(128).default(''),
  resume: z.boolean().default(true),
  hasConversation: z.boolean().default(false),
  // Panes saved before chat views existed stay terminals (their agent may still run).
  view: z.enum(PANE_VIEWS).default('terminal').catch('terminal'),
  chatSessionId: chatSessionIdSchema.nullable().default(null).catch(null),
  model: z.string().regex(CHAT_MODEL_PATTERN).nullable().default(null).catch(null),
  effort: z.enum(CHAT_EFFORTS).nullable().default(null).catch(null),
  chatMode: z.enum(CHAT_MODES).nullable().default(null).catch(null),
  teamAgentId: idSchema.nullable().default(null).catch(null)
})

export const teamAgentSchema = z.object({
  id: idSchema,
  role: z.string().trim().min(1).max(40),
  accountId: idSchema.nullable(),
  model: z.string().regex(CHAT_MODEL_PATTERN).nullable().default(null).catch(null),
  effort: z.enum(CHAT_EFFORTS).nullable().default(null).catch(null),
  chatMode: z.enum(CHAT_MODES).nullable().default(null).catch(null),
  prompt: z.string().max(4000).default(''),
  folder: z.enum(['worktree', 'shared']).default('worktree').catch('worktree')
})

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(64),
  icon: iconSchema,
  color: tintSchema,
  panes: z.array(paneSchema).max(64),
  layout: layoutNodeSchema.nullable(),
  machineId: idSchema.nullable().default(null),
  folder: z.string().max(4096).default(''),
  accountId: idSchema.nullable().default(null),
  history: z
    .array(z.object({ pane: paneSchema, closedAt: z.number().int().nonnegative() }))
    .max(200)
    .default([])
    .catch([]),
  team: z.array(teamAgentSchema).max(TEAM_MAX).default([]).catch([])
})

/** Never starts with `-` (it would be read as an ssh option) and has no spaces or quotes. */
export const sshHostSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.@%:[\]][A-Za-z0-9_.@%:[\]-]*$/)

export const machineSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(64),
  sshHost: sshHostSchema
})

export const settingsSchema = z.object({
  fontFamily: z.enum(TERMINAL_FONTS).default('JetBrains Mono'),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(FONT_SIZE_DEFAULT),
  uiZoom: z.number().min(0.67).max(2).default(1).catch(1),
  theme: z.enum(['system', 'dark', 'light']).default('dark'),
  themeDark: idSchema.default('wraith').catch('wraith'),
  themeLight: idSchema.default('daylight').catch('daylight'),
  accent: z.enum(['theme', ...ACCENTS]).default('theme'),
  terminalPalette: z.enum(TERMINAL_PALETTES).default('match'),
  defaultAccountId: idSchema.nullable().default(null),
  defaultCwd: pathSchema.default('~'),
  /** Folders pinned at the top of the New chat folder picker. */
  pinnedFolders: z.array(pathSchema).max(20).default([]).catch([]),
  sidebarCollapsed: z.boolean().default(false),
  sidebarOpenProjects: z.array(idSchema).max(500).default([]).catch([]),
  sidebarWidth: z
    .number()
    .int()
    .min(SIDEBAR_WIDTH_MIN)
    .max(SIDEBAR_WIDTH_MAX)
    .default(SIDEBAR_WIDTH_DEFAULT)
    .catch(SIDEBAR_WIDTH_DEFAULT),
  diffWidth: z
    .number()
    .int()
    .min(DIFF_WIDTH_MIN)
    .max(DIFF_WIDTH_MAX)
    .default(DIFF_WIDTH_DEFAULT)
    .catch(DIFF_WIDTH_DEFAULT),
  sharedMode: z.enum(SHARED_MODES).default('overall'),
  checkUpdatesOnLaunch: z.boolean().default(true),
  notifyPanes: z.boolean().default(true),
  autoSwitchAtLimit: z.boolean().default(true),
  autoSwitchAt: z.number().int().min(50).max(100).default(95).catch(95),
  shellPath: z.string().max(4096).default(''),
  shellArgs: z
    .array(
      z
        .string()
        .max(1000)
        .refine((s) => !s.includes('\0'))
    )
    .max(32)
    .default([]),
  modDirs: z
    .array(pathSchema.refine((s) => !s.includes('\0')))
    .max(MOD_DIRS_MAX)
    .default([]),
  gpuTerminal: z.boolean().default(false),
  onWindowClose: z.enum(CLOSE_MODES).default('ask').catch('ask'),
  cliAccess: z.boolean().default(false),
  newPaneView: z.enum(PANE_VIEWS).default('chat').catch('chat'),
  chatModel: z.string().regex(CHAT_MODEL_PATTERN).nullable().default(null).catch(null),
  chatEffort: z.enum(CHAT_EFFORTS).nullable().default(null).catch(null),
  chatMode: z.enum(CHAT_MODES).nullable().default(null).catch(null),
  cliPaths: z
    .partialRecord(
      z.enum(AGENT_CLIS),
      z
        .string()
        .max(4096)
        .refine((s) => !s.includes('\0'))
    )
    .default({})
    .catch({}),
  shortcuts: z
    .partialRecord(
      z.enum(SHORTCUT_IDS),
      z.string().regex(/^(?:mod\+)(?:shift\+)?(?:alt\+)?[A-Za-z0-9]{1,24}$/)
    )
    .default({})
    .catch({})
})

const scheduleWhenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().regex(LOCAL_DATETIME_PATTERN) }),
  z.object({
    kind: z.literal('weekly'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string().regex(TIME_PATTERN)
  }),
  z.object({
    kind: z.literal('hours'),
    every: z.number().int().min(1).max(24),
    from: z.string().regex(TIME_PATTERN)
  }),
  z.object({ kind: z.literal('reset'), window: z.enum(['fiveHour', 'sevenDay']) })
])

export const scheduledJobSchema = z.object({
  id: idSchema,
  wsId: idSchema,
  accountId: idSchema,
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().regex(CHAT_MODEL_PATTERN).nullable().default(null).catch(null),
  effort: z.enum(CHAT_EFFORTS).nullable().default(null).catch(null),
  chatMode: z.enum(CHAT_MODES).nullable().default(null).catch(null),
  when: scheduleWhenSchema,
  target: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('new') }),
      z.object({ kind: z.literal('chat'), paneId: idSchema })
    ])
    .default({ kind: 'new' })
    .catch({ kind: 'new' }),
  atLimit: z.enum(['wait', 'switch']).default('wait').catch('wait'),
  enabled: z.boolean().default(true),
  nextAt: z.number().int().nonnegative().nullable().default(null).catch(null),
  runs: z
    .array(
      z.object({
        at: z.number().int().nonnegative(),
        result: z.enum(['running', 'done', 'failed', 'missed', 'skipped', 'waiting']),
        paneId: idSchema.nullable(),
        note: z.string().max(300).default('')
      })
    )
    .max(SCHEDULE_RUNS_MAX)
    .default([])
    .catch([])
})

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  claudePath: z.string().max(4096).default(''),
  accounts: z.array(accountSchema).max(64),
  accountFolders: z.array(accountFolderSchema).max(32).default([]),
  workspaces: z.array(workspaceSchema).min(1).max(32),
  machines: z.array(machineSchema).max(32).default([]),
  activeWorkspace: idSchema,
  recentFolders: z.array(pathSchema).max(20).default([]),
  settings: settingsSchema.default(() => settingsSchema.parse({})),
  // A bad job drops alone, not the whole list or the config.
  schedules: z
    .array(z.unknown())
    .max(SCHEDULES_MAX)
    .default([])
    .catch([])
    .transform((list) =>
      list.flatMap((j) => {
        const r = scheduledJobSchema.safeParse(j)
        return r.success ? [r.data] : []
      })
    )
})

// Compile-time check that the zod schema and the hand-written Config type agree.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const schemaMatchesType: Equals<z.infer<typeof configSchema>, Config> = true
void schemaMatchesType

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    claudePath: '',
    accounts: [],
    accountFolders: [],
    workspaces: [
      {
        id: 'ws-default',
        name: 'default',
        icon: '',
        color: '',
        panes: [],
        layout: null,
        machineId: null,
        folder: '',
        accountId: null,
        history: [],
        team: []
      }
    ],
    machines: [],
    activeWorkspace: 'ws-default',
    recentFolders: [],
    settings: settingsSchema.parse({}),
    schedules: []
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Upgrades an older on-disk shape to the current version. Unversioned files are the
 * requirements §9 shape (v0). Returns the input untouched when it is already current.
 */
export function migrateConfig(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  if (raw.version === CONFIG_VERSION) return raw
  if (raw.version !== undefined) return raw // unknown future/past version: let validation fail
  // Only something that looks like the §9 file is migrated; anything else fails validation.
  if (!Array.isArray(raw.workspaces) && !Array.isArray(raw.accounts)) return raw

  const accounts = Array.isArray(raw.accounts) ? raw.accounts : []
  const workspaces = Array.isArray(raw.workspaces) ? raw.workspaces : []
  const settings = isRecord(raw.settings) ? raw.settings : {}

  const migratedWorkspaces = workspaces.filter(isRecord).map((w, i) => ({
    id: typeof w.id === 'string' ? w.id : `ws-${i + 1}`,
    name: typeof w.name === 'string' && w.name ? w.name : `workspace ${i + 1}`,
    panes: (Array.isArray(w.panes) ? w.panes : []).filter(isRecord).map((p) => ({
      ...p,
      accountId: p.accountId ?? null,
      title: typeof p.title === 'string' ? p.title : basename(String(p.cwd ?? ''))
    })),
    // A v0 layout was an opaque object; the renderer auto-arranges a null layout.
    layout: null
  }))

  return {
    version: CONFIG_VERSION,
    claudePath:
      typeof raw.claudePath === 'string' && raw.claudePath !== 'claude' ? raw.claudePath : '',
    accounts: accounts.filter(isRecord).map((a, i) => ({
      ...a,
      color:
        typeof a.color === 'string' ? a.color : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]!.value,
      // Accounts configured before v1 were set up by hand and already used.
      signedIn: typeof a.signedIn === 'boolean' ? a.signedIn : true,
      imported: typeof a.imported === 'boolean' ? a.imported : false
    })),
    accountFolders: [],
    workspaces: migratedWorkspaces.length ? migratedWorkspaces : defaultConfig().workspaces,
    activeWorkspace: migratedWorkspaces[0]?.id ?? 'ws-default',
    recentFolders: [],
    settings
  }
}

/** Repairs cross-references that zod cannot express. Never throws. */
export function sanitizeConfig(cfg: Config): Config {
  const folderIds = new Set(cfg.accountFolders.map((f) => f.id))
  const accounts = cfg.accounts.map((a) =>
    a.folderId && !folderIds.has(a.folderId) ? { ...a, folderId: null } : a
  )
  const accountIds = new Set(cfg.accounts.map((a) => a.id))
  const machineIds = new Set(cfg.machines.map((m) => m.id))
  const workspaces = cfg.workspaces.map((w) => ({
    ...w,
    machineId: w.machineId && machineIds.has(w.machineId) ? w.machineId : null,
    accountId: w.accountId && accountIds.has(w.accountId) ? w.accountId : null,
    panes: w.panes.map((p) =>
      p.accountId && !accountIds.has(p.accountId) ? { ...p, accountId: null } : p
    )
  }))
  const activeWorkspace = workspaces.some((w) => w.id === cfg.activeWorkspace)
    ? cfg.activeWorkspace
    : workspaces[0]!.id
  const defaultAccountId =
    cfg.settings.defaultAccountId && accountIds.has(cfg.settings.defaultAccountId)
      ? cfg.settings.defaultAccountId
      : null
  return {
    ...cfg,
    accounts,
    workspaces,
    activeWorkspace,
    settings: { ...cfg.settings, defaultAccountId }
  }
}

export type ParseResult = { ok: true; config: Config } | { ok: false; error: string }

/**
 * Validates and sanitizes untrusted config input. Only files read from disk are
 * migrated; input arriving over IPC must already be the current version.
 */
export function parseConfig(raw: unknown, opts: { migrate?: boolean } = {}): ParseResult {
  const result = configSchema.safeParse(opts.migrate === false ? raw : migrateConfig(raw))
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) }
  return { ok: true, config: sanitizeConfig(result.data) }
}
