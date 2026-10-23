// codex's app-server for the chat view (#40): JSON-RPC 2.0, one message a line, over stdio
// (`codex app-server`, experimental in codex-cli 0.163.0). Chosen over `codex exec --json`
// because one process holds the conversation, stops a turn (`turn/interrupt`) and asks
// before commands and edits (server requests answered with a decision). Shapes checked
// against real output (tests/fixtures/codex-chat.ndjson). Model, effort and mode go with
// each `turn/start`, so they switch without a restart.
import {
  CHAT_EFFORTS,
  clip,
  type ApprovalDecision,
  type ChatAccountInfo,
  type ChatEvent,
  type ChatMode,
  type ChatModel,
  type ToolKind,
  type ToolPreview
} from '@shared/chat'
import type { UsageWindow } from '@shared/usage'
import type { ChatAdapter, Decoded } from './adapter'
import { saveChatImages } from './images'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The modes codex has, as approval policy + sandbox (its Read only / Auto / Full access). */
const CODEX_MODES: ChatMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

const POLICY: Record<string, { approvalPolicy: string; sandboxPolicy: Obj; sandbox: string }> = {
  // Asks before anything but trusted reads.
  default: {
    approvalPolicy: 'untrusted',
    sandbox: 'workspace-write',
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false }
  },
  // Works in the folder on its own; asks to go beyond it.
  acceptEdits: {
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false }
  },
  plan: {
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
    sandboxPolicy: { type: 'readOnly', networkAccess: false }
  },
  bypassPermissions: {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    sandboxPolicy: { type: 'dangerFullAccess' }
  }
}
const policyOf = (m: ChatMode) => POLICY[m] ?? POLICY.default!

/** `model/list` → the picker's models (hidden ones left out; effort levels we know). */
export function parseCodexModels(result: unknown): ChatModel[] {
  const data = isObj(result) && Array.isArray(result.data) ? result.data.filter(isObj) : []
  return data
    .filter((m) => m.hidden !== true && str(m.id))
    .slice(0, 100)
    .map((m) => ({
      value: str(m.id),
      label: str(m.displayName) || str(m.id),
      description: str(m.description).slice(0, 400),
      efforts: (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
        .filter(isObj)
        .map((e) => str(e.reasoningEffort))
        .filter((e) => (CHAT_EFFORTS as readonly string[]).includes(e))
    }))
}

/** codex's rate limits → the usage windows (primary = 5 hours, secondary = a week). */
function limitsOf(snapshot: unknown): ChatEvent | null {
  if (!isObj(snapshot)) return null
  const win = (w: unknown): UsageWindow | null =>
    isObj(w) && typeof w.usedPercent === 'number' && typeof w.resetsAt === 'number'
      ? { utilization: Math.max(0, w.usedPercent / 100), resetsAt: w.resetsAt * 1000 }
      : null
  const fiveHour = win(snapshot.primary)
  const sevenDay = win(snapshot.secondary)
  return fiveHour || sevenDay
    ? { t: 'limits', limits: { fiveHour, sevenDay, at: Date.now() } }
    : null
}

/** codex's token counts (`thread/tokenUsage/updated`); input includes the cached part. */
interface CodexTokens {
  input: number
  cached: number
  cacheWrite: number
  output: number
}
function tokensOf(u: unknown): CodexTokens | null {
  if (!isObj(u)) return null
  const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)
  return {
    input: n(u.inputTokens),
    cached: n(u.cachedInputTokens),
    cacheWrite: n(u.cacheWriteInputTokens),
    output: n(u.outputTokens)
  }
}
const minus = (a: CodexTokens, b: CodexTokens): CodexTokens => ({
  input: Math.max(0, a.input - b.input),
  cached: Math.max(0, a.cached - b.cached),
  cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
  output: Math.max(0, a.output - b.output)
})

/** `bash -lc '…'` as codex runs commands → the command itself. */
function commandOf(item: Obj): string {
  const actions = Array.isArray(item.commandActions) ? item.commandActions.filter(isObj) : []
  return (
    actions
      .map((a) => str(a.command))
      .filter(Boolean)
      .join(' && ') || str(item.command)
  )
}

/** One codex item drawn as a tool card, or null when it isn't one. */
export function describeCodexItem(
  item: Obj
): { name: string; kind: ToolKind; subtitle: string; preview: ToolPreview | null } | null {
  switch (str(item.type)) {
    case 'commandExecution': {
      const cmd = commandOf(item)
      return { name: 'Shell', kind: 'shell', subtitle: cmd, preview: { type: 'code', text: cmd } }
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isObj) : []
      const diff = changes.map((c) => str(c.diff)).join('\n')
      return {
        name: 'Edit',
        kind: 'edit',
        subtitle: changes.map((c) => str(c.path)).join(', '),
        preview: diff ? { type: 'code', text: clip(diff, 20_000) } : null
      }
    }
    case 'mcpToolCall':
      return {
        name: `${str(item.server)}.${str(item.tool)}`,
        kind: 'other',
        subtitle: '',
        preview: null
      }
    case 'dynamicToolCall':
      return { name: str(item.tool), kind: 'other', subtitle: '', preview: null }
    case 'webSearch':
      return { name: 'Web search', kind: 'web', subtitle: str(item.query), preview: null }
    case 'collabAgentToolCall':
      return { name: 'Agent', kind: 'agent', subtitle: str(item.prompt), preview: null }
    case 'imageView':
      return { name: 'View image', kind: 'read', subtitle: str(item.path), preview: null }
    default:
      return null
  }
}

/** A finished tool item → its card's output and whether it failed. */
function resultOf(item: Obj): { output: string; isError: boolean } {
  const status = str(item.status)
  const failed = status === 'failed' || status === 'declined'
  switch (str(item.type)) {
    case 'commandExecution': {
      const code = typeof item.exitCode === 'number' ? item.exitCode : null
      const out = str(item.aggregatedOutput)
      return {
        output:
          out || (status === 'declined' ? 'Declined' : code !== null ? `Exit code ${code}` : ''),
        isError: failed || (code !== null && code !== 0)
      }
    }
    case 'mcpToolCall': {
      const err = isObj(item.error) ? str(item.error.message) : ''
      return { output: err || JSON.stringify(item.result ?? '').slice(0, 8000), isError: !!err }
    }
    default:
      return {
        output: failed ? (status === 'declined' ? 'Declined' : 'Failed') : '',
        isError: failed
      }
  }
}

export function createCodexAdapter(): ChatAdapter {
  let seq = 0
  const rpc = (method: string, params: unknown): Obj => ({
    jsonrpc: '2.0',
    id: ++seq,
    method,
    params
  })
  /** What our requests were, by id, for their answers. */
  const asked = new Map<number, string>()
  const request = (method: string, params: unknown): Obj => {
    const msg = rpc(method, params)
    asked.set(msg.id as number, method)
    return msg
  }

  let start = {
    sessionId: null as string | null,
    continueLast: false,
    model: null as string | null,
    effort: null as string | null,
    mode: 'default' as ChatMode
  }
  let thread: string | null = null
  /** The running turn (for interrupt), and messages added to it while it ran. */
  let turn: string | null = null
  let steered = 0
  let stopAsked = false
  /** The thread's token total when this turn began, and the latest one (#53). `last` is per
   *  model call and a turn can repeat it, so a turn's use is the change in `total`. */
  let turnBase: CodexTokens | null = null
  let latest: CodexTokens | null = null
  /** Messages sent before the thread was ready. */
  const waiting: Obj[] = []
  /** Items that already streamed their text, so the full copy isn't shown twice. */
  const streamed = new Set<string>()
  /** Approvals codex waits on: our id → its request id and method. */
  const pending = new Map<string, { id: unknown; method: string }>()
  /** What codex offers, kept together: each answer fills in its half. */
  let models: ChatModel[] = []
  let account: ChatAccountInfo | null = null
  /** Tool items seen, so an approval can show what it is about. */
  const items = new Map<string, Obj>()

  const turnStart = (input: Obj[]): Obj => {
    const p = policyOf(start.mode)
    return request('turn/start', {
      threadId: thread,
      input,
      model: start.model,
      effort: start.effort,
      approvalPolicy: p.approvalPolicy,
      sandboxPolicy: p.sandboxPolicy
    })
  }

  const threadParams = (): Obj => {
    const p = policyOf(start.mode)
    return { model: start.model, approvalPolicy: p.approvalPolicy, sandbox: p.sandbox }
  }

  const decode = (msg: unknown): Decoded => {
    const out: Decoded = { events: [], replies: [] }
    if (!isObj(msg)) return out
    const push = out.events.push.bind(out.events)
    const reply = out.replies.push.bind(out.replies)
    const method = str(msg.method)

    // ---- Answers to our requests.
    if (!method && msg.id !== undefined) {
      const what = asked.get(msg.id as number) ?? ''
      asked.delete(msg.id as number)
      const r = msg.result
      if (isObj(msg.error)) {
        const text = str(msg.error.message) || 'codex refused a request.'
        if (what === 'thread/resume') {
          // A conversation codex no longer has: start a new one rather than fail.
          push({
            t: 'notice',
            level: 'info',
            text: `Could not resume (${text}); started a new conversation.`
          })
          reply(request('thread/start', threadParams()))
        } else if (what === 'turn/start') {
          push({ t: 'notice', level: 'error', text })
          push({ t: 'busy', busy: false })
        } else if (what !== 'account/rateLimits/read' && what !== 'model/list')
          push({ t: 'notice', level: 'error', text })
        return out
      }
      switch (what) {
        case 'initialize':
          reply({ jsonrpc: '2.0', method: 'initialized' })
          if (start.sessionId)
            reply(request('thread/resume', { threadId: start.sessionId, ...threadParams() }))
          else if (start.continueLast) reply(request('thread/list', { limit: 1, cwd: null }))
          else reply(request('thread/start', threadParams()))
          reply(request('model/list', {}))
          reply(request('account/read', {}))
          reply(request('account/rateLimits/read', null))
          break
        case 'thread/list': {
          const last = isObj(r) && Array.isArray(r.data) ? r.data.filter(isObj)[0] : undefined
          reply(
            last && str(last.id)
              ? request('thread/resume', { threadId: str(last.id), ...threadParams() })
              : request('thread/start', threadParams())
          )
          break
        }
        case 'thread/start':
        case 'thread/resume': {
          const t = isObj(r) && isObj(r.thread) ? r.thread : {}
          thread = str(t.id) || null
          if (thread) push({ t: 'session', id: thread, model: (isObj(r) && str(r.model)) || null })
          push({
            t: 'controls',
            controls: {
              live: { interrupt: true, model: true, mode: true },
              modes: CODEX_MODES,
              approvals: true
            }
          })
          for (const input of waiting.splice(0)) reply(turnStart(input.input as Obj[]))
          break
        }
        case 'model/list':
          models = parseCodexModels(r)
          push({ t: 'capabilities', models, account, commands: [] })
          break
        case 'account/read': {
          const a = isObj(r) && isObj(r.account) ? r.account : null
          if (isObj(r) && !a && r.requiresOpenaiAuth === true)
            push({
              t: 'notice',
              level: 'error',
              text: 'codex is not signed in for this account. Use Login on the Accounts page.'
            })
          if (a) {
            account = {
              email: str(a.email) || null,
              plan: str(a.planType) ? `ChatGPT ${str(a.planType)}` : str(a.type) || null
            }
            // The list and the account come in either order: say both each time.
            push({ t: 'capabilities', models, account, commands: [] })
          }
          break
        }
        case 'account/rateLimits/read': {
          const l = limitsOf(isObj(r) ? r.rateLimits : null)
          if (l) push(l)
          break
        }
      }
      return out
    }

    // ---- Requests codex waits on.
    if (method && msg.id !== undefined) {
      const p = isObj(msg.params) ? msg.params : {}
      const itemId = str(p.itemId)
      if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
        const cmd = commandOf(p) || (Array.isArray(p.command) ? p.command.map(str).join(' ') : '')
        const reqId = `cx-${String(msg.id)}`
        pending.set(reqId, { id: msg.id, method })
        push({
          t: 'approval',
          reqId,
          toolId: itemId || null,
          name: 'Shell',
          subtitle: str(p.reason) || cmd,
          preview: cmd ? { type: 'code', text: cmd } : null,
          canAlways: method === 'item/commandExecution/requestApproval'
        })
      } else if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
        const reqId = `cx-${String(msg.id)}`
        pending.set(reqId, { id: msg.id, method })
        const d = items.get(itemId)
        const shown = d ? describeCodexItem(d) : null
        push({
          t: 'approval',
          reqId,
          toolId: itemId || null,
          name: 'Edit',
          subtitle: shown?.subtitle || str(p.reason) || 'Change files',
          preview: shown?.preview ?? null,
          canAlways: method === 'item/fileChange/requestApproval'
        })
      } else {
        // Questions and tool calls meant for a richer host: say no, or codex waits for ever.
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'Not supported by Wraithgrid' }
        })
      }
      return out
    }

    // ---- Notifications.
    const p = isObj(msg.params) ? msg.params : {}
    switch (method) {
      case 'turn/started': {
        const t = isObj(p.turn) ? p.turn : {}
        turn = str(t.id) || null
        if (stopAsked && turn) {
          stopAsked = false
          reply(request('turn/interrupt', { threadId: thread, turnId: turn }))
        }
        break
      }
      case 'item/agentMessage/delta':
        streamed.add(str(p.itemId))
        push({ t: 'text', id: str(p.itemId), delta: str(p.delta) })
        break
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        push({ t: 'thinking', id: str(p.itemId), delta: str(p.delta) })
        break
      case 'item/started':
      case 'item/completed': {
        const item = isObj(p.item) ? p.item : {}
        const id = str(item.id)
        if (item.type === 'agentMessage') {
          if (method === 'item/completed' && !streamed.has(id) && str(item.text))
            push({ t: 'text', id, delta: str(item.text) })
          break
        }
        const tool = describeCodexItem(item)
        if (!tool) break
        items.set(id, item)
        push({ t: 'tool', id, ...tool })
        if (method === 'item/completed') {
          items.delete(id)
          const res = resultOf(item)
          push({ t: 'toolResult', id, output: clip(res.output), isError: res.isError })
        }
        break
      }
      case 'serverRequest/resolved': {
        // Answered elsewhere, or no longer wanted: the bar must go.
        for (const [reqId, q] of pending)
          if (String(q.id) === String(p.requestId)) pending.delete(reqId)
        break
      }
      case 'thread/tokenUsage/updated': {
        const u = isObj(p.tokenUsage) ? p.tokenUsage : {}
        const total = tokensOf(u.total)
        if (!total) break
        // First count seen (a resumed thread's total holds its history): start before it.
        if (!latest) turnBase = minus(total, tokensOf(u.last) ?? total)
        latest = total
        break
      }
      case 'account/rateLimits/updated': {
        const l = limitsOf(p.rateLimits)
        if (l) push(l)
        break
      }
      case 'error': {
        const e = isObj(p.error) ? p.error : {}
        if (p.willRetry !== true && str(e.message))
          push({ t: 'notice', level: 'error', text: str(e.message) })
        break
      }
      case 'thread/compacted':
        push({ t: 'notice', level: 'info', text: 'Context compacted' })
        break
      case 'turn/completed': {
        const t = isObj(p.turn) ? p.turn : {}
        const status = str(t.status)
        turn = null
        stopAsked = false
        if (status === 'interrupted') push({ t: 'notice', level: 'info', text: 'Interrupted' })
        const err = isObj(t.error) ? str(t.error.message) : ''
        const used = latest && turnBase ? minus(latest, turnBase) : null
        turnBase = latest
        push({
          t: 'turnEnd',
          costUsd: null,
          durationMs: typeof t.durationMs === 'number' ? t.durationMs : null,
          error: status === 'failed' ? err || 'The turn failed.' : null,
          // codex reports tokens, never a cost (#53).
          usage: used
            ? {
                model: start.model,
                costUsd: null,
                input: Math.max(0, used.input - used.cached),
                output: used.output,
                cacheRead: used.cached,
                cacheWrite: used.cacheWrite
              }
            : null
        })
        // Messages added to a running turn end with it.
        const ends = 1 + steered
        steered = 0
        for (let i = 0; i < ends; i++) push({ t: 'busy', busy: false })
        break
      }
    }
    return out
  }

  return {
    args: ({ sessionId, continueLast, model, effort, mode }) => {
      start = {
        sessionId,
        continueLast,
        model: model && model !== 'default' ? model : null,
        effort,
        mode: mode && CODEX_MODES.includes(mode) ? mode : 'default'
      }
      return ['app-server']
    },
    hello: () => [
      request('initialize', {
        clientInfo: { name: 'wraithgrid', title: 'Wraithgrid', version: '1' },
        capabilities: null
      })
    ],
    user: (text, images) => {
      const input: Obj[] = [
        ...(text ? [{ type: 'text', text, text_elements: [] }] : []),
        ...saveChatImages(images).map((path) => ({ type: 'localImage', path }))
      ]
      if (!thread) {
        waiting.push({ input })
        return null
      }
      // A message while a turn runs joins that turn (codex steers it).
      if (turn) steered++
      return turnStart(input)
    },
    interrupt: () => {
      if (thread && turn) return request('turn/interrupt', { threadId: thread, turnId: turn })
      // Not started yet: stop it as soon as it is.
      stopAsked = true
      return null
    },
    setModel: (model) => {
      start.model = model && model !== 'default' ? model : null
      return null
    },
    setMode: (mode) => {
      start.mode = CODEX_MODES.includes(mode) ? mode : 'default'
      return null
    },
    answer: (reqId: string, decision: ApprovalDecision) => {
      const q = pending.get(reqId)
      if (!q) return null
      pending.delete(reqId)
      const legacy = q.method === 'execCommandApproval' || q.method === 'applyPatchApproval'
      const value = legacy
        ? decision === 'deny'
          ? 'denied'
          : decision === 'always'
            ? 'approved_for_session'
            : 'approved'
        : decision === 'deny'
          ? 'decline'
          : decision === 'always'
            ? 'acceptForSession'
            : 'accept'
      return { jsonrpc: '2.0', id: q.id, result: { decision: value } }
    },
    decode
  }
}
