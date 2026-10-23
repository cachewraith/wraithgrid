/**
 * Everything Wraithgrid knows about each agent CLI, in one table, so supporting a new CLI is
 * one entry here instead of `cli === 'x'` branches across main and renderer.
 */

/** The agent CLI an account's panes run. */
export const AGENT_CLIS = [
  'claude',
  'gemini',
  'agy',
  'codex',
  'opencode',
  'cursor',
  'copilot'
] as const
export type AgentCli = (typeof AGENT_CLIS)[number]

/**
 * Where an account's sign-in lives:
 * - `dir`: in the config dir, so every account signs in on its own (checked for this CLI)
 * - `dir-unchecked`: the config dir moves the CLI's files, but its docs don't say the sign-in
 *   stays there (it may use the system keyring), so accounts may share one login
 * - `shared`: no per-account dir at all; every account of this CLI uses the same login
 */
export type SignInIsolation = 'dir' | 'dir-unchecked' | 'shared'

export interface AgentCliSpec {
  label: string
  /** The command it is found by on PATH. */
  bin: string
  /** The variable that points it at an account's config dir, or null when it has none. */
  configDirVar: string | null
  signIn: SignInIsolation
  /** How a pasted image file is typed in: a plain path, or an `@path` file reference. */
  imagePaste: 'path' | 'at-path'
  /** Bytes Shift+Enter sends for "new line", or null to leave the key alone. */
  newLine: string | null
  /** Args that continue the folder's last conversation, or null when the CLI has none. */
  resumeArgs: string[] | null
  /** Output that means "waiting for the user to approve something". */
  approval: RegExp
  /** Has a chat-view adapter (src/main/chat/); without one its panes are terminals only. */
  chat: boolean
  /** Its chats report plan limits (Usage, the pill); chats without them report tokens only. */
  reportsLimits: boolean
  /** Accounts screen hint shown when adding an account. */
  note: string
}

// claude's prompts; the others are what their docs and screenshots show, until fixtures from
// real output replace them.
const CLAUDE_APPROVAL = /Do you want to (?:proceed|make this edit|create|allow|run)[^\n]{0,160}\?/i
const GEMINI_APPROVAL =
  /(?:Allow execution|Apply this change|Do you want to proceed|Allow (?:once|always))[^\n]{0,160}\?/i
const CODEX_APPROVAL =
  /(?:Would you like to (?:run|make|apply)|Allow command|Approve)[^\n]{0,160}\?|\[y\/N\]|Yes, proceed/i
const GENERIC_APPROVAL =
  /(?:Do you want to (?:proceed|run|allow|apply)|Allow (?:this|command|execution)|Run this command)[^\n]{0,160}\?|\[y\/N\]/i

export const AGENT_CLI_SPECS: Record<AgentCli, AgentCliSpec> = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    configDirVar: 'CLAUDE_CONFIG_DIR',
    signIn: 'dir',
    imagePaste: 'path',
    // claude's only "new line" key is ESC CR (what /terminal-setup configures elsewhere).
    newLine: '\x1b\r',
    resumeArgs: ['--continue'],
    approval: CLAUDE_APPROVAL,
    chat: true,
    reportsLimits: true,
    note: 'After saving, use Login to open a pane running claude under this account and run /login there.'
  },
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    configDirVar: 'GEMINI_CLI_HOME',
    signIn: 'dir',
    imagePaste: 'at-path',
    newLine: null,
    resumeArgs: ['--resume', 'latest'],
    approval: GEMINI_APPROVAL,
    chat: false,
    reportsLimits: false,
    note: 'Panes run gemini with GEMINI_CLI_HOME set to this config dir; it asks you to sign in on first launch.'
  },
  agy: {
    label: 'Antigravity CLI',
    bin: 'agy',
    configDirVar: null,
    signIn: 'shared',
    imagePaste: 'at-path',
    newLine: null,
    resumeArgs: ['--continue'],
    approval: GEMINI_APPROVAL,
    chat: true,
    reportsLimits: false,
    note: 'Panes run agy. It keeps its sign-in in the system keyring, so every Antigravity account on this machine uses the same Google login; it asks on first launch.'
  },
  codex: {
    label: 'Codex CLI',
    bin: 'codex',
    configDirVar: 'CODEX_HOME',
    signIn: 'dir-unchecked',
    imagePaste: 'path',
    newLine: null,
    resumeArgs: ['resume', '--last'],
    approval: CODEX_APPROVAL,
    chat: true,
    reportsLimits: true,
    note: 'Panes run codex with CODEX_HOME set to this config dir. Its sign-in stays separate per account only while codex stores credentials in a file (cli_auth_credentials_store = "file"); with the keyring, accounts share one login.'
  },
  opencode: {
    label: 'opencode',
    bin: 'opencode',
    // OPENCODE_CONFIG_DIR adds agents and commands but not auth.json, which lives in the
    // XDG data dir; moving that would move every tool the agent runs too.
    configDirVar: null,
    signIn: 'shared',
    imagePaste: 'at-path',
    newLine: null,
    resumeArgs: ['--continue'],
    approval: GENERIC_APPROVAL,
    chat: false,
    reportsLimits: false,
    note: 'Panes run opencode. It keeps provider keys in one place for your user (~/.local/share/opencode), so every opencode account on this machine shares them.'
  },
  cursor: {
    label: 'Cursor Agent',
    bin: 'cursor-agent',
    configDirVar: 'CURSOR_CONFIG_DIR',
    signIn: 'dir-unchecked',
    imagePaste: 'at-path',
    newLine: null,
    resumeArgs: ['--continue'],
    approval: GENERIC_APPROVAL,
    chat: false,
    reportsLimits: false,
    note: 'Panes run cursor-agent with CURSOR_CONFIG_DIR set to this config dir. Cursor does not document where it keeps the sign-in, so accounts may share one login; run cursor-agent login in a pane to check.'
  },
  copilot: {
    label: 'Copilot CLI',
    bin: 'copilot',
    configDirVar: 'COPILOT_HOME',
    signIn: 'dir-unchecked',
    imagePaste: 'at-path',
    newLine: null,
    resumeArgs: ['--continue'],
    approval: GENERIC_APPROVAL,
    chat: false,
    reportsLimits: false,
    note: 'Panes run copilot with COPILOT_HOME set to this config dir. Copilot may keep its GitHub token in the system keychain, so accounts may share one login; use /login in a pane to check.'
  }
}

export const AGENT_CLI_LABEL = Object.fromEntries(
  AGENT_CLIS.map((c) => [c, AGENT_CLI_SPECS[c].label])
) as Record<AgentCli, string>

/** The command each CLI is found by on PATH. */
export const AGENT_CLI_BIN = Object.fromEntries(
  AGENT_CLIS.map((c) => [c, AGENT_CLI_SPECS[c].bin])
) as Record<AgentCli, string>

/** Every config-dir variable any CLI reads; an agent pane gets only its own one. */
export const CONFIG_DIR_VARS = [
  ...new Set(AGENT_CLIS.map((c) => AGENT_CLI_SPECS[c].configDirVar).filter((v) => v !== null))
]

/** Prepends the CLI's resume args to a pane's args, unless the pane already resumes. */
export function withResumeArgs(cli: AgentCli, args: string[]): string[] {
  const resume = AGENT_CLI_SPECS[cli].resumeArgs
  if (!resume) return args
  // A pane started with its own resume/continue flag or subcommand is left as it is.
  if (args.some((a) => /^(?:-c|-r|--continue|--resume|resume)$/.test(a))) return args
  return [...resume, ...args]
}

/** CLIs whose Login opens the sign-in dialog (src/main/login.ts); the rest sign in in a terminal. */
export const DIALOG_LOGIN_CLIS: readonly AgentCli[] = ['claude', 'codex']

/**
 * CLIs whose chats can carry on as another account of the same CLI (#29, #60): their
 * conversation is a file in the account's config dir that Wraithgrid can copy over.
 */
export const CONTINUE_AS_CLIS: readonly AgentCli[] = ['claude', 'codex']
