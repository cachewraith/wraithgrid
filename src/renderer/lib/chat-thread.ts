// A chat pane's conversation as the view draws it, folded from ChatEvents (ADR 0002). Pure,
// so it is tested without a window; ChatBus keeps one per pane and saves it to disk.
import type {
  ApprovalDecision,
  ChatAccountInfo,
  ChatBackgroundTask,
  ChatControls,
  ChatCommand,
  ChatEvent,
  ChatMode,
  ChatModel,
  ToolKind,
  ToolPreview
} from '@shared/chat'

export interface ToolApproval {
  reqId: string
  canAlways: boolean
  /** null while it waits for the user. */
  decided: ApprovalDecision | null
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: number }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      toolKind: ToolKind
      subtitle: string
      preview: ToolPreview | null
      /** null until the tool returns. */
      output: string | null
      isError: boolean
      approval: ToolApproval | null
    }
  /** `divider`: a line across the chat, e.g. "Continued as home · 14:32". */
  | { kind: 'notice'; id: string; level: 'info' | 'error' | 'divider'; text: string }
  | {
      kind: 'turn'
      id: string
      costUsd: number | null
      durationMs: number | null
      error: string | null
    }

export interface ChatThread {
  items: ChatItem[]
  busy: boolean
  sessionId: string | null
  model: string | null
  /** When the running turn started (for the elapsed timer); null while idle. */
  turnStartedAt: number | null
  /** Ids for items made here (user messages, notices). */
  seq: number
  /** How many leading items came from the saved view (drawn without an entrance). */
  restored: number
  /** The models the CLI offered and whose account it runs as (empty until it said). */
  models: ChatModel[]
  account: ChatAccountInfo | null
  /** Slash commands and skills the CLI offers, and the ones that need its own screen. */
  commands: ChatCommand[]
  terminalOnly: string[]
  /** The permission mode the CLI says is in force; null until it said. */
  mode: ChatMode | null
  /** Background work still running after its turn (#39); never saved, it dies with the CLI. */
  background: ChatBackgroundTask[]
  /** What the CLI can't do live (agy, #41); null = everything live, like claude. */
  controls: ChatControls | null
}

export const EMPTY_THREAD: ChatThread = {
  items: [],
  busy: false,
  sessionId: null,
  model: null,
  turnStartedAt: null,
  seq: 0,
  restored: 0,
  models: [],
  account: null,
  commands: [],
  terminalOnly: [],
  mode: null,
  background: [],
  controls: null
}

/** The saved view keeps this many items; older ones are dropped from the view only. */
const KEEP_ITEMS = 400

/** Replaces the newest item with `id` (searching from the end: updates hit recent items). */
function updateItem(
  items: ChatItem[],
  id: string,
  fn: (it: ChatItem) => ChatItem
): ChatItem[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.id !== id) continue
    const next = items.slice()
    next[i] = fn(items[i]!)
    return next
  }
  return null
}

const nextId = (t: ChatThread, prefix: string): [string, number] => [
  `${prefix}-${t.seq + 1}`,
  t.seq + 1
]

export function addUserMessage(
  t: ChatThread,
  text: string,
  images: number,
  now: number
): ChatThread {
  const [id, seq] = nextId(t, 'u')
  return {
    ...t,
    seq,
    busy: true,
    turnStartedAt: t.turnStartedAt ?? now,
    items: [...t.items, { kind: 'user', id, text, images }]
  }
}

export function addNotice(
  t: ChatThread,
  level: 'info' | 'error' | 'divider',
  text: string
): ChatThread {
  const [id, seq] = nextId(t, 'n')
  return { ...t, seq, items: [...t.items, { kind: 'notice', id, level, text }] }
}

export function applyChatEvent(t: ChatThread, e: ChatEvent, now: number): ChatThread {
  switch (e.t) {
    case 'session':
      return {
        ...t,
        sessionId: e.id,
        model: e.model ?? t.model,
        terminalOnly: e.terminalOnly ?? t.terminalOnly
      }
    case 'capabilities':
      return { ...t, models: e.models, account: e.account, commands: e.commands ?? t.commands }
    case 'busy':
      return {
        ...t,
        busy: e.busy,
        turnStartedAt: e.busy ? (t.turnStartedAt ?? now) : null
      }
    case 'text':
    case 'thinking': {
      const kind = e.t === 'text' ? 'assistant' : 'thinking'
      const updated = updateItem(t.items, e.id, (it) =>
        it.kind === kind ? { ...it, text: it.text + e.delta } : it
      )
      if (updated) return { ...t, items: updated }
      return { ...t, items: [...t.items, { kind, id: e.id, text: e.delta }] }
    }
    case 'tool': {
      const fields = {
        name: e.name,
        toolKind: e.kind,
        subtitle: e.subtitle,
        preview: e.preview
      }
      const updated = updateItem(t.items, e.id, (it) =>
        it.kind === 'tool' ? { ...it, ...fields } : it
      )
      if (updated) return { ...t, items: updated }
      return {
        ...t,
        items: [
          ...t.items,
          { kind: 'tool', id: e.id, ...fields, output: null, isError: false, approval: null }
        ]
      }
    }
    case 'toolResult': {
      const updated = updateItem(t.items, e.id, (it) =>
        it.kind === 'tool' ? { ...it, output: e.output, isError: e.isError } : it
      )
      return updated ? { ...t, items: updated } : t
    }
    case 'approval': {
      const approval: ToolApproval = { reqId: e.reqId, canAlways: e.canAlways, decided: null }
      const id = e.toolId ?? `approval-${e.reqId}`
      const updated = updateItem(t.items, id, (it) =>
        it.kind === 'tool' ? { ...it, approval } : it
      )
      if (updated) return { ...t, items: updated }
      return {
        ...t,
        items: [
          ...t.items,
          {
            kind: 'tool',
            id,
            name: e.name,
            toolKind: 'other',
            subtitle: e.subtitle,
            preview: e.preview,
            output: null,
            isError: false,
            approval
          }
        ]
      }
    }
    case 'approvalDone': {
      let changed = false
      const items = t.items.map((it) => {
        if (it.kind !== 'tool' || it.approval?.reqId !== e.reqId) return it
        changed = true
        return { ...it, approval: { ...it.approval, decided: e.decision } }
      })
      return changed ? { ...t, items } : t
    }
    case 'turnEnd': {
      const [id, seq] = nextId(t, 't')
      return {
        ...t,
        seq,
        items: [
          ...t.items,
          { kind: 'turn', id, costUsd: e.costUsd, durationMs: e.durationMs, error: e.error }
        ]
      }
    }
    case 'limits':
      return t
    case 'controls':
      return { ...t, controls: e.controls }
    case 'background':
      return t.background.length || e.tasks.length ? { ...t, background: e.tasks } : t
    case 'mode':
      return t.mode === e.mode ? t : { ...t, mode: e.mode }
    case 'notice':
      return addNotice(t, e.level, e.text)
    case 'exit': {
      const ended = { ...t, busy: false, turnStartedAt: null, background: [] }
      return e.error ? addNotice(ended, 'error', e.error) : ended
    }
  }
}

/** The tool call waiting for an answer, if any. */
export function pendingApproval(t: ChatThread): Extract<ChatItem, { kind: 'tool' }> | null {
  for (let i = t.items.length - 1; i >= 0; i--) {
    const it = t.items[i]!
    if (it.kind === 'tool' && it.approval && it.approval.decided === null) return it
  }
  return null
}

/** What the pane's status dot says about a chat. */
export function chatStatus(t: ChatThread): 'running' | 'approval' | 'background' | 'idle' {
  if (t.busy && pendingApproval(t)) return 'approval'
  if (t.busy) return 'running'
  return t.background.length ? 'background' : 'idle'
}

const SAVE_VERSION = 1

export function serializeThread(t: ChatThread): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    sessionId: t.sessionId,
    model: t.model,
    seq: t.seq,
    models: t.models,
    items: t.items.slice(-KEEP_ITEMS)
  })
}

const ITEM_KINDS = new Set(['user', 'assistant', 'thinking', 'tool', 'notice', 'turn'])

/** A saved view, or an empty thread when the file is missing, old or damaged. */
export function parseThread(raw: string | null): ChatThread {
  if (!raw) return EMPTY_THREAD
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    if (d.v !== SAVE_VERSION || !Array.isArray(d.items)) return EMPTY_THREAD
    const items = (d.items as ChatItem[]).filter(
      (it) =>
        typeof it === 'object' &&
        it !== null &&
        ITEM_KINDS.has(it.kind) &&
        typeof it.id === 'string'
    )
    // A request the old process asked can never be answered now. Views saved before #51 hold
    // a notice repeating the tool's description after each long command: drop it.
    const settled = items
      .filter((it, i) => {
        const prev = items[i - 1]
        return !(
          it.kind === 'notice' &&
          it.level === 'info' &&
          prev?.kind === 'tool' &&
          prev.subtitle === it.text
        )
      })
      .map((it) =>
        it.kind === 'tool' && it.approval && it.approval.decided === null
          ? { ...it, approval: { ...it.approval, decided: 'deny' as const } }
          : it
      )
    return {
      ...EMPTY_THREAD,
      items: settled,
      sessionId: typeof d.sessionId === 'string' ? d.sessionId : null,
      model: typeof d.model === 'string' ? d.model : null,
      seq: typeof d.seq === 'number' ? d.seq : items.length,
      models: Array.isArray(d.models) ? (d.models as ChatModel[]) : [],
      restored: settled.length
    }
  } catch {
    return EMPTY_THREAD
  }
}
