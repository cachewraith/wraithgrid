// The chat view's own language (ADR 0002). Every agent CLI that can run headless is
// translated into these events by its adapter in main (src/main/chat/), so the chat UI
// never knows which CLI it is talking to.
import { z } from 'zod'

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
}

export interface ChatAccountInfo {
  email: string | null
  /** The plan, e.g. "Claude Pro"; null when the CLI does not say. */
  plan: string | null
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

/** One thing the agent did, as main tells the renderer about it. */
export type ChatEvent =
  /** The CLI's conversation id, used to resume it later; `model` when it says. */
  | { t: 'session'; id: string; model: string | null }
  /** What the CLI said it offers once it started: models to pick from, and whose plan. */
  | { t: 'capabilities'; models: ChatModel[]; account: ChatAccountInfo | null }
  /** A turn started or ended. */
  | { t: 'busy'; busy: boolean }
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
  | { t: 'turnEnd'; costUsd: number | null; durationMs: number | null; error: string | null }
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

/** Clips tool output so a huge result never floods the view or the saved transcript. */
export function clip(text: string, max = 8000): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters)`
    : text
}
