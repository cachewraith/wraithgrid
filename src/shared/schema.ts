import { z } from 'zod'
import {
  ACCENTS,
  ACCOUNT_COLORS,
  CONFIG_VERSION,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SHARED_MODES,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TERMINAL_FONTS,
  TERMINAL_PALETTES,
  type Config,
  type LayoutNode
} from './types'
import { ICON_MAX } from './icons'

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)

const pathSchema = z.string().min(1).max(4096)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** An icon tint; '' means neutral. Cosmetic, so a bad value resets instead of failing the file. */
const tintSchema = z.union([z.literal(''), colorSchema]).catch('')
/**
 * An icon id ("material:rocket-launch") or an emoji; rendered as text or looked up in the
 * bundled sets, never as HTML. Cosmetic, so a bad value resets to the letter.
 */
const iconSchema = z.string().max(ICON_MAX).catch('')

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
  title: z.string().max(128).default('')
})

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(64),
  icon: iconSchema,
  color: tintSchema,
  panes: z.array(paneSchema).max(64),
  layout: layoutNodeSchema.nullable()
})

export const settingsSchema = z.object({
  fontFamily: z.enum(TERMINAL_FONTS).default('JetBrains Mono'),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(FONT_SIZE_DEFAULT),
  theme: z.enum(['system', 'dark', 'light']).default('dark'),
  accent: z.enum(ACCENTS).default('violet'),
  terminalPalette: z.enum(TERMINAL_PALETTES).default('match'),
  defaultAccountId: idSchema.nullable().default(null),
  defaultCwd: pathSchema.default('~'),
  sidebarCollapsed: z.boolean().default(false),
  sidebarWidth: z
    .number()
    .int()
    .min(SIDEBAR_WIDTH_MIN)
    .max(SIDEBAR_WIDTH_MAX)
    .default(SIDEBAR_WIDTH_DEFAULT)
    .catch(SIDEBAR_WIDTH_DEFAULT),
  sharedMode: z.enum(SHARED_MODES).default('overall'),
  checkUpdatesOnLaunch: z.boolean().default(true),
  notifyPanes: z.boolean().default(true),
  shellPath: z.string().max(4096).default(''),
  shellArgs: z
    .array(
      z
        .string()
        .max(1000)
        .refine((s) => !s.includes('\0'))
    )
    .max(32)
    .default([])
})

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  claudePath: z.string().max(4096).default(''),
  accounts: z.array(accountSchema).max(64),
  accountFolders: z.array(accountFolderSchema).max(32).default([]),
  workspaces: z.array(workspaceSchema).min(1).max(32),
  activeWorkspace: idSchema,
  recentFolders: z.array(pathSchema).max(20).default([]),
  settings: settingsSchema.default(() => settingsSchema.parse({}))
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
      { id: 'ws-default', name: 'default', icon: '', color: '', panes: [], layout: null }
    ],
    activeWorkspace: 'ws-default',
    recentFolders: [],
    settings: settingsSchema.parse({})
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
  const workspaces = cfg.workspaces.map((w) => ({
    ...w,
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
