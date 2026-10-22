// The chat view's own language (ADR 0002). Every agent CLI that can run headless is
// translated into these events by its adapter in main (src/main/chat/), so the chat UI
// never knows which CLI it is talking to.
import { z } from 'zod'
import type { AccountLimits, TurnUsage } from './usage'

/** How a tool call is drawn: a shell command, a file edit, a read, a search, … */
export const TOOL_KINDS = [
  'shell',
  'edit',
  'read',
  'search',
  'web',
  'agent',
  'todo',
  'other'
] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

export type ToolPreview =
  | { type: 'code'; text: string }
  | { type: 'diff'; path: string; before: string; after: string }
  | { type: 'todos'; items: { text: string; status: 'pending' | 'active' | 'done' }[] }

export type ApprovalDecision = 'allow' | 'always' | 'deny'

/** A model the CLI offers, as its own list names it. */
export interface ChatModel {
  /** What is passed back to choose it (an alias like `sonnet`). */
  value: string
  label: string
  description: string
  /** Effort levels it takes; empty when it has no effort setting. */
  efforts: string[]
  /** It can run in auto mode (claude: `supportsAutoMode`). */
  autoMode?: boolean
}

/** A slash command or skill the CLI offers (claude: the `initialize` answer's `commands`). */
export interface ChatCommand {
  name: string
  description: string
  /** What goes after the name, e.g. `<topic or idea>`; '' when it takes nothing. */
  argumentHint: string
  aliases: string[]
  /** Part of the CLI itself rather than a plugin, skill or the user's own file. */
  builtin: boolean
}

export interface ChatAccountInfo {
  email: string | null
  /** The plan, e.g. "Claude Pro"; null when the CLI does not say. */
  plan: string | null
}

/**
 * How much the agent may do without asking (claude's permission modes, as `set_permission_mode`
 * takes them; checked against claude 2.1.306).
 */
export const CHAT_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions'
] as const
export type ChatMode = (typeof CHAT_MODES)[number]

export const CHAT_MODE_LABEL: Record<ChatMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions'
}

export const CHAT_MODE_HINT: Record<ChatMode, string> = {
  default: 'Asks before it edits files or runs commands',
  acceptEdits: 'Edits files on its own; still asks before commands',
  plan: 'Reads and plans only; changes nothing',
  auto: 'Decides on its own what is safe to run',
  dontAsk: 'Refuses anything that is not already allowed',
  bypassPermissions: 'Runs everything without asking'
}

/** The modes Shift+Tab steps through, as in Claude Code (auto only where the model has it). */
export function cycleModes(autoMode: boolean): ChatMode[] {
  return autoMode ? ['default', 'acceptEdits', 'plan', 'auto'] : ['default', 'acceptEdits', 'plan']
}

/** Effort levels a chat can ask for (`--effort`); the model's own list narrows them. */
export const CHAT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ChatEffort = (typeof CHAT_EFFORTS)[number]
export const EFFORT_LABEL: Record<ChatEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}
/** A model alias passed as an argument: a plain token. */
export const CHAT_MODEL_PATTERN = /^[A-Za-z0-9._[\]-]{1,100}$/

/** Work the agent started in the background that outlives its turn (a command, an agent). */
export interface ChatBackgroundTask {
  id: string
  kind: 'shell' | 'agent' | 'other'
  /** What it is doing, as the CLI describes it (or the command). */
  label: string
  /** When it was first seen running (ms). */
  since: number
}

/** One thing the agent did, as main tells the renderer about it. */
export type ChatEvent =
  /** The CLI's conversation id, used to resume it later; `model` when it says. */
  | {
      t: 'session'
      id: string
      model: string | null
      /** Commands that only work in the CLI's own screen (claude: `terminal_slash_commands`). */
      terminalOnly?: string[]
    }
  /** What the CLI said it offers once it started: models to pick from, and whose plan. */
  | {
      t: 'capabilities'
      models: ChatModel[]
      account: ChatAccountInfo | null
      commands?: ChatCommand[]
    }
  /** The permission mode now in force (after a switch, or when the agent changed it). */
  | { t: 'mode'; mode: ChatMode }
  /** A turn started or ended. */
  | { t: 'busy'; busy: boolean }
  /**
   * The background work still running, as a whole list (empty when all of it ended). A turn
   * can end while this is not empty: the chat is then waiting on it, not stopped (#39).
   */
  | { t: 'background'; tasks: ChatBackgroundTask[] }
  /** Streamed answer text for the text block `id`. */
  | { t: 'text'; id: string; delta: string }
  /** Streamed reasoning for block `id`; the delta may be empty (hidden reasoning). */
  | { t: 'thinking'; id: string; delta: string }
  | {
      t: 'tool'
      id: string
      name: string
      kind: ToolKind
      /** One line: the command, the file, the pattern. */
      subtitle: string
      preview: ToolPreview | null
    }
  | { t: 'toolResult'; id: string; output: string; isError: boolean }
  /** The CLI asks before running a tool; `toolId` is the tool call it belongs to. */
  | {
      t: 'approval'
      reqId: string
      toolId: string | null
      name: string
      subtitle: string
      preview: ToolPreview | null
      canAlways: boolean
    }
  | { t: 'approvalDone'; reqId: string; decision: ApprovalDecision }
  | {
      t: 'turnEnd'
      costUsd: number | null
      durationMs: number | null
      error: string | null
      /** Tokens and cost for usage; null when the CLI does not report them. */
      usage?: TurnUsage | null
    }
  /** The account's plan limits as the CLI reports them (claude: `rate_limit_event`). */
  | { t: 'limits'; limits: AccountLimits }
  | { t: 'notice'; level: 'info' | 'error'; text: string }
  /** The CLI process ended; the conversation can be resumed by starting again. */
  | { t: 'exit'; code: number | null; signal: number | null; error: string | null }

export interface ChatEventMessage {
  paneId: string
  event: ChatEvent
}

/** A conversation id is passed to the CLI as an argument: keep it to a plain token. */
export const chatSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ChatImageType = (typeof CHAT_IMAGE_TYPES)[number]
/** Base64 length of one pasted image (about 5 MB of image). */
export const CHAT_IMAGE_MAX = 7_000_000
export const CHAT_IMAGES_MAX = 4
export const CHAT_TEXT_MAX = 200_000
/** A saved conversation view, as the renderer serialised it. */
export const CHAT_SAVE_MAX = 4_000_000

export interface ChatImage {
  mediaType: ChatImageType
  /** Base64, no `data:` prefix. */
  data: string
}

/** Image files attached from disk, by extension; anything else is sent as a path. */
export const CHAT_IMAGE_EXT: Record<string, ChatImageType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
/** Files attached to one message as paths (the agent reads them with its own tools). */
export const CHAT_FILES_MAX = 20

/** What the attach picker gave: images to send as images, other files as paths. */
export interface ChatPickResult {
  images: ChatImage[]
  files: string[]
}

/** The message with its attached files listed after it, one path a line. */
export function withAttachments(text: string, files: string[]): string {
  if (!files.length) return text
  const list = files.map((f) => `- ${f.replace(/[\r\n]+/g, ' ')}`).join('\n')
  return `${text ? `${text}\n\n` : ''}Attached files:\n${list}`
}

/** Clips tool output so a huge result never floods the view or the saved transcript. */
export function clip(text: string, max = 8000): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters)`
    : text
}
