// claude's headless mode for the chat view: `-p` with stream-json in and out, and tool
// approvals answered over the same pipe (`--permission-prompt-tool stdio`, the Agent SDK's
// control protocol). Shapes checked against claude 2.1.306 output (tests/fixtures/claude-chat.ndjson).
import {
  clip,
  type ApprovalDecision,
  CHAT_MODES,
  type ChatCommand,
  type ChatMode,
  type ChatModel,
  type ToolKind,
  type ToolPreview
} from '@shared/chat'
import type { ChatAdapter, Decoded } from './adapter'
import type { UsageWindow } from '@shared/usage'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const firstLine = (s: string): string => s.split('\n', 1)[0] ?? ''

/** How a claude tool call looks in the chat: its kind, one line, and a preview. */
export function describeClaudeTool(
  name: string,
  input: unknown
): { kind: ToolKind; subtitle: string; preview: ToolPreview | null } {
  const i = isObj(input) ? input : {}
  const path = str(i.file_path) || str(i.notebook_path) || str(i.path)
  switch (name) {
    case 'Bash':
      return {
        kind: 'shell',
        subtitle: str(i.description) || firstLine(str(i.command)),
        preview: str(i.command) ? { type: 'code', text: clip(str(i.command), 4000) } : null
      }
    case 'Edit':
      return {
        kind: 'edit',
        subtitle: path,
        preview: {
          type: 'diff',
          path,
          before: clip(str(i.old_string), 6000),
          after: clip(str(i.new_string), 6000)
        }
      }
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? i.edits.filter(isObj) : []
      return {
        kind: 'edit',
        subtitle: path,
        preview: {
          type: 'diff',
          path,
          before: clip(edits.map((e) => str(e.old_string)).join('\n…\n'), 6000),
          after: clip(edits.map((e) => str(e.new_string)).join('\n…\n'), 6000)
        }
      }
    }
    case 'Write':
      return {
        kind: 'edit',
        subtitle: path,
        preview: { type: 'diff', path, before: '', after: clip(str(i.content), 6000) }
      }
    case 'NotebookEdit':
      return { kind: 'edit', subtitle: path, preview: null }
    case 'Read':
      return { kind: 'read', subtitle: path, preview: null }
    case 'Grep':
    case 'Glob':
      return {
        kind: 'search',
        subtitle: [str(i.pattern), path].filter(Boolean).join('  in  '),
        preview: null
      }
    case 'WebFetch':
      return { kind: 'web', subtitle: str(i.url), preview: null }
    case 'WebSearch':
      return { kind: 'web', subtitle: str(i.query), preview: null }
    case 'Task':
    case 'Agent':
      return {
        kind: 'agent',
        subtitle: str(i.description) || firstLine(str(i.prompt)),
        preview: str(i.prompt) ? { type: 'code', text: clip(str(i.prompt), 4000) } : null
      }
    case 'TodoWrite': {
      const todos = Array.isArray(i.todos) ? i.todos.filter(isObj) : []
      const status = (s: unknown): 'pending' | 'active' | 'done' =>
        s === 'completed' ? 'done' : s === 'in_progress' ? 'active' : 'pending'
      return {
        kind: 'todo',
        subtitle: `${todos.filter((t) => t.status === 'completed').length}/${todos.length} done`,
        preview: {
          type: 'todos',
          items: todos.map((t) => ({ text: str(t.content), status: status(t.status) }))
        }
      }
    }
    default: {
      const firstString = Object.values(i).find((v) => typeof v === 'string')
      const json = JSON.stringify(input, null, 2) ?? ''
      return {
        kind: 'other',
        subtitle: firstLine(str(firstString)),
        preview: json && json !== '{}' ? { type: 'code', text: clip(json, 4000) } : null
      }
    }
  }
}

/** A tool result's text: a string, or the text blocks of a content list. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isObj)
    .map((b) => (b.type === 'text' ? str(b.text) : b.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n')
}

const INTERRUPTED = '[Request interrupted by user'

export function createClaudeAdapter(): ChatAdapter {
  let seq = 0
  /** Text block ids are this process's own: a view can hold several processes' turns. */
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const reqId = (): string => `wg-${++seq}`
  /** Approval requests claude waits on: what it asked to run, and what "always" would save. */
  const pending = new Map<string, { input: unknown; suggestions: unknown[] }>()
  /** Messages whose text arrived as stream deltas, so the full copy is not shown twice. */
  const streamed = new Set<string>()
  let messageId = ''
  /** The `initialize` request: its answer lists the models and the account. */
  let helloId = ''
  /** The user stopped this turn, so its error result is expected, not news. */
  let interrupted = false
  /** The mode claude last said is in force, and our switch requests it hasn't answered yet. */
  let mode: ChatMode | null = null
  const modeReqs = new Set<string>()

  const decode = (msg: unknown): Decoded => {
    const out: Decoded = { events: [], replies: [] }
    if (!isObj(msg)) return out
    // A subagent's own steps: its Task tool call stands for all of them.
    if (msg.parent_tool_use_id) return out
    const push = out.events.push.bind(out.events)

    switch (msg.type) {
      case 'system': {
        // claude says which mode is in force at start and after every switch (`status`).
        const m = str(msg.permissionMode)
        if ((CHAT_MODES as readonly string[]).includes(m)) {
          mode = m as ChatMode
          push({ t: 'mode', mode })
        }
        if (msg.subtype === 'init' && str(msg.session_id))
          push({
            t: 'session',
            id: str(msg.session_id),
            model: str(msg.model) || null,
            terminalOnly: Array.isArray(msg.terminal_slash_commands)
              ? msg.terminal_slash_commands.map(str).filter(Boolean).slice(0, 200)
              : []
          })
        break
      }

      case 'stream_event': {
        const ev = isObj(msg.event) ? msg.event : {}
        if (ev.type === 'message_start' && isObj(ev.message)) messageId = str(ev.message.id)
        if (ev.type !== 'content_block_delta' || !isObj(ev.delta)) break
        const id = `${run}:${messageId}:${String(ev.index)}`
        if (ev.delta.type === 'text_delta') {
          streamed.add(messageId)
          push({ t: 'text', id, delta: str(ev.delta.text) })
        } else if (ev.delta.type === 'thinking_delta') {
          streamed.add(messageId)
          push({ t: 'thinking', id, delta: str(ev.delta.thinking) })
        }
        break
      }

      case 'assistant': {
        const m = isObj(msg.message) ? msg.message : {}
        const mid = str(m.id)
        const blocks = Array.isArray(m.content) ? m.content.filter(isObj) : []
        blocks.forEach((b, n) => {
          if (b.type === 'tool_use') {
            push({
              t: 'tool',
              id: str(b.id),
              name: str(b.name),
              ...describeClaudeTool(str(b.name), b.input)
            })
          } else if (b.type === 'text' && !streamed.has(mid) && str(b.text)) {
            push({ t: 'text', id: `${run}:${mid}:full:${n}`, delta: str(b.text) })
          }
        })
        break
      }

      case 'user': {
        const m = isObj(msg.message) ? msg.message : {}
        const blocks = Array.isArray(m.content) ? m.content.filter(isObj) : []
        for (const b of blocks) {
          if (b.type === 'tool_result')
            push({
              t: 'toolResult',
              id: str(b.tool_use_id),
              output: clip(resultText(b.content)),
              isError: b.is_error === true
            })
          else if (b.type === 'text' && str(b.text).startsWith(INTERRUPTED)) {
            interrupted = true
            push({ t: 'notice', level: 'info', text: 'Interrupted' })
          }
        }
        break
      }

      case 'rate_limit_event': {
        // claude 2.1.306: rate_limit_info.unifiedWindows.{five_hour,seven_day} =
        // { utilization: 0–1, resetsAt: unix seconds }.
        const info = isObj(msg.rate_limit_info) ? msg.rate_limit_info : {}
        const w = isObj(info.unifiedWindows) ? info.unifiedWindows : {}
        const win = (x: unknown): UsageWindow | null =>
          isObj(x) && typeof x.utilization === 'number' && typeof x.resetsAt === 'number'
            ? { utilization: Math.max(0, x.utilization), resetsAt: x.resetsAt * 1000 }
            : null
        const fiveHour = win(w.five_hour)
        const sevenDay = win(w.seven_day)
        if (fiveHour || sevenDay)
          push({ t: 'limits', limits: { fiveHour, sevenDay, at: Date.now() } })
        break
      }

      case 'result': {
        const failed = msg.is_error === true && !interrupted
        interrupted = false
        const cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null
        const u = isObj(msg.usage) ? msg.usage : {}
        const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)
        const model = isObj(msg.modelUsage) ? (Object.keys(msg.modelUsage)[0] ?? null) : null
        push({
          t: 'turnEnd',
          costUsd: cost,
          durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : null,
          error: failed
            ? str(msg.result) || `The turn failed (${str(msg.subtype) || 'error'}).`
            : null,
          usage:
            cost === null && !isObj(msg.usage)
              ? null
              : {
                  model,
                  costUsd: cost ?? 0,
                  input: n(u.input_tokens),
                  output: n(u.output_tokens),
                  cacheRead: n(u.cache_read_input_tokens),
                  cacheWrite: n(u.cache_creation_input_tokens)
                }
        })
        push({ t: 'busy', busy: false })
        break
      }

      case 'control_response': {
        const r = isObj(msg.response) ? msg.response : {}
        // A refused switch (e.g. bypass in a session not allowed it): say why, show the mode in force.
        if (modeReqs.delete(str(r.request_id)) && r.subtype === 'error') {
          push({
            t: 'notice',
            level: 'error',
            text: `Couldn't change mode: ${str(r.error) || 'claude refused it'}`
          })
          if (mode) push({ t: 'mode', mode })
          break
        }
        if (r.request_id !== helloId || r.subtype !== 'success' || !isObj(r.response)) break
        const info = r.response
        const models: ChatModel[] = (Array.isArray(info.models) ? info.models : [])
          .filter(isObj)
          .filter((m) => str(m.value))
          .map((m) => ({
            value: str(m.value),
            label: str(m.displayName) || str(m.value),
            description: str(m.description),
            efforts:
              m.supportsEffort === true && Array.isArray(m.supportedEffortLevels)
                ? m.supportedEffortLevels.filter((e): e is string => typeof e === 'string')
                : [],
            autoMode: m.supportsAutoMode === true
          }))
        const acc = isObj(info.account) ? info.account : null
        // Names are plain tokens (`plugin:skill`); anything else is not a command we can type.
        const commands: ChatCommand[] = (Array.isArray(info.commands) ? info.commands : [])
          .filter(isObj)
          .filter(
            (c) => /^[A-Za-z0-9_.:-]{1,100}$/.test(str(c.name)) && !str(c.name).startsWith('_')
          )
          .slice(0, 500)
          .map((c) => ({
            name: str(c.name),
            description: str(c.description).slice(0, 400),
            argumentHint: str(c.argumentHint).slice(0, 120),
            aliases: Array.isArray(c.aliases)
              ? c.aliases.map(str).filter((a) => /^[A-Za-z0-9_.:-]{1,100}$/.test(a))
              : [],
            builtin: c.builtin === true
          }))
        push({
          t: 'capabilities',
          commands,
          models,
          account: acc
            ? { email: str(acc.email) || null, plan: str(acc.subscriptionType) || null }
            : null
        })
        break
      }

      case 'control_request': {
        const id = str(msg.request_id)
        const r = isObj(msg.request) ? msg.request : {}
        if (r.subtype === 'can_use_tool') {
          const name = str(r.tool_name)
          const suggestions = Array.isArray(r.permission_suggestions)
            ? r.permission_suggestions
            : []
          pending.set(id, { input: r.input, suggestions })
          const d = describeClaudeTool(name, r.input)
          push({
            t: 'approval',
            reqId: id,
            toolId: str(r.tool_use_id) || null,
            name: str(r.display_name) || name,
            subtitle: d.subtitle,
            preview: d.preview,
            canAlways: suggestions.length > 0
          })
        } else {
          // Hooks or MCP calls meant for an SDK host: say no, or claude waits for ever.
          out.replies.push({
            type: 'control_response',
            response: { subtype: 'error', request_id: id, error: 'Not supported by Wraithgrid' }
          })
        }
        break
      }
    }
    return out
  }

  return {
    args: ({ sessionId, continueLast, model, effort, mode }) => [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
      // Only makes Bypass a mode the user can pick mid-chat; without it claude refuses the switch.
      '--allow-dangerously-skip-permissions',
      ...(sessionId ? ['--resume', sessionId] : continueLast ? ['--continue'] : []),
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : []),
      ...(mode && mode !== 'default' ? ['--permission-mode', mode] : [])
    ],
    hello: () => {
      helloId = reqId()
      return [{ type: 'control_request', request_id: helloId, request: { subtype: 'initialize' } }]
    },
    setMode: (m) => {
      const id = reqId()
      modeReqs.add(id)
      return {
        type: 'control_request',
        request_id: id,
        request: { subtype: 'set_permission_mode', mode: m }
      }
    },
    setModel: (model) => ({
      type: 'control_request',
      request_id: reqId(),
      request: { subtype: 'set_model', model }
    }),
    user: (text, images) => ({
      type: 'user',
      message: {
        role: 'user',
        content: images.length
          ? [
              ...images.map((img) => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mediaType, data: img.data }
              })),
              ...(text ? [{ type: 'text', text }] : [])
            ]
          : text
      }
    }),
    interrupt: () => ({
      type: 'control_request',
      request_id: reqId(),
      request: { subtype: 'interrupt' }
    }),
    answer: (id, decision: ApprovalDecision) => {
      const req = pending.get(id)
      if (!req) return null
      pending.delete(id)
      const response =
        decision === 'deny'
          ? { behavior: 'deny', message: 'The user denied this in Wraithgrid.' }
          : {
              behavior: 'allow',
              updatedInput: req.input,
              ...(decision === 'always' ? { updatedPermissions: req.suggestions } : {})
            }
      return {
        type: 'control_response',
        response: { subtype: 'success', request_id: id, response }
      }
    },
    decode
  }
}
