// agy's headless mode for the chat view (#41): `--print=` with stream-json in and out. Shapes
// checked against agy 1.4.4 output (tests/fixtures/agy-chat.ndjson, agy-denied.ndjson):
// input is `{"event":"user","message":{…}}` (text only); output is `init`, `step_update`
// (one per step: user_input, agent_response with `text_delta`, tool with `tool_info`) and
// `result`. Over the pipe agy can't ask before a tool (it refuses it and lists it in
// `denied_actions`), can't stop a turn (no event for it, SIGINT is ignored) and can't switch
// model or mode: the view restarts it for those, resuming by `--conversation <id>`.
import {
  CHAT_EFFORTS,
  clip,
  type ChatMode,
  type ChatModel,
  type ToolKind,
  type ToolPreview
} from '@shared/chat'
import type { ChatAdapter, Decoded } from './adapter'
import { saveChatImages } from './images'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The modes agy has (`--mode`, `--dangerously-skip-permissions`); auto depends on the plan. */
const AGY_MODES: ChatMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

const MODE_ARGS: Partial<Record<ChatMode, string[]>> = {
  acceptEdits: ['--mode', 'accept-edits'],
  plan: ['--mode', 'plan'],
  auto: ['--mode', 'auto'],
  bypassPermissions: ['--dangerously-skip-permissions']
}

/**
 * Models that take `--effort`, from the last `agy models` list: agy names one model per level
 * (`gemini-3.8-flash-low`), and the base name takes `--effort`; other models refuse the flag.
 */
const effortModels = new Set<string>()

/** `agy models` output (`id<TAB>Label` lines) → the picker's models, effort levels folded. */
export function parseAgyModels(out: string): ChatModel[] {
  const models: ChatModel[] = []
  const byBase = new Map<string, ChatModel>()
  for (const line of out.split(/\r?\n/)) {
    const [id = '', label = ''] = line.split('\t').map((x) => x.trim())
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) continue
    const m = /^(.+)-(low|medium|high|xhigh|max)$/.exec(id)
    if (m) {
      const base = m[1]!
      const name = label.replace(/\s*\((Low|Medium|High|Extra high|Max)\)\s*$/i, '') || base
      let model = byBase.get(base)
      if (!model) {
        model = { value: base, label: name, description: '', efforts: [] }
        byBase.set(base, model)
        models.push(model)
      }
      model.efforts.push(m[2]!)
    } else {
      models.push({ value: id, label: label || id, description: '', efforts: [] })
    }
  }
  for (const m of models)
    m.efforts.sort(
      (a, b) =>
        (CHAT_EFFORTS as readonly string[]).indexOf(a) -
        (CHAT_EFFORTS as readonly string[]).indexOf(b)
    )
  effortModels.clear()
  for (const m of models) if (m.efforts.length) effortModels.add(m.value)
  return models.slice(0, 100)
}

/** One agy tool call, drawn like the others: kind, one line, and a preview where it helps. */
export function describeAgyTool(
  name: string,
  params: unknown
): { kind: ToolKind; subtitle: string; preview: ToolPreview | null } {
  const p = isObj(params) ? params : {}
  const file = str(p.Path) || str(p.AbsolutePath) || str(p.TargetFile) || str(p.File)
  switch (name) {
    case 'run_command':
    case 'send_command_input':
    case 'command_status': {
      const cmd = str(p.CommandLine) || str(p.Input) || str(p.CommandId)
      return { kind: 'shell', subtitle: cmd, preview: cmd ? { type: 'code', text: cmd } : null }
    }
    case 'write_to_file':
    case 'write_file':
    case 'replace_file_content':
    case 'multi_replace_file_content':
    case 'sed_file':
    case 'notebook_edit':
      return { kind: 'edit', subtitle: file, preview: null }
    case 'view_file':
    case 'read_file':
    case 'read_resource':
      return { kind: 'read', subtitle: file, preview: null }
    case 'grep_search':
    case 'find_by_name':
    case 'list_dir':
      return {
        kind: 'search',
        subtitle:
          str(p.Query) || str(p.Pattern) || str(p.SearchPath) || str(p.DirectoryPath) || file,
        preview: null
      }
    case 'search_web':
    case 'read_url_content':
      return { kind: 'web', subtitle: str(p.query) || str(p.Query) || str(p.Url), preview: null }
    case 'invoke_subagent':
    case 'browser_subagent':
      return { kind: 'agent', subtitle: str(p.Task) || str(p.Description), preview: null }
    default:
      return { kind: 'other', subtitle: file, preview: null }
  }
}

const SIGN_IN = /not authenticated|sign[ -]?in|log ?in|unauthenticated|credentials/i

export function createAgyAdapter(): ChatAdapter {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  /** The mode it was started in: agy's init doesn't say. */
  let mode: ChatMode = 'default'
  /** Messages agy took since the last result: one result can answer several queued ones. */
  let taken = 0

  const decode = (msg: unknown): Decoded => {
    const out: Decoded = { events: [], replies: [] }
    if (!isObj(msg)) return out
    const push = out.events.push.bind(out.events)
    switch (msg.event) {
      case 'init': {
        const init = isObj(msg.init) ? msg.init : {}
        const id = str(msg.conversation_id)
        if (id) push({ t: 'session', id, model: str(init.model) || null })
        push({
          t: 'controls',
          controls: {
            live: { interrupt: false, model: false, mode: false },
            modes: AGY_MODES,
            approvals: false
          }
        })
        push({ t: 'mode', mode })
        break
      }

      case 'step_update': {
        const s = isObj(msg.step_update) ? msg.step_update : {}
        const id = `${run}:${str(s.conversation_id)}:${String(s.step_index)}`
        const state = str(s.state)
        const delta = str(s.text_delta)
        switch (str(s.step_type)) {
          case 'user_input':
            if (state === 'DONE') taken++
            break
          case 'agent_response':
          case 'notify_user':
            if (delta) push({ t: 'text', id, delta })
            break
          case 'thinking':
            push({ t: 'thinking', id, delta })
            break
          case 'tool': {
            const info = isObj(s.tool_info) ? s.tool_info : {}
            const name = str(info.name) || str(s.tool_name)
            push({ t: 'tool', id, name, ...describeAgyTool(name, info.parameters) })
            if (state !== 'ACTIVE')
              push({
                t: 'toolResult',
                id,
                output: clip(str(info.output) || str(s.error)),
                isError: state !== 'DONE'
              })
            break
          }
          case 'compaction':
            if (state === 'DONE') push({ t: 'notice', level: 'info', text: 'Context compacted' })
            break
          case 'error':
            if (str(s.error) || delta)
              push({ t: 'notice', level: 'error', text: str(s.error) || delta })
            break
        }
        break
      }

      case 'result': {
        const r = isObj(msg.result) ? msg.result : {}
        const failed = str(r.status) !== 'SUCCESS'
        const error = failed ? str(r.error) || 'The turn failed.' : null
        if (error && SIGN_IN.test(error))
          push({
            t: 'notice',
            level: 'error',
            text: 'agy is not signed in. Open this account in a terminal pane once and sign in with Google there.'
          })
        const denied = Array.isArray(r.denied_actions)
          ? r.denied_actions
              .filter(isObj)
              .map((d) => str(d.display_name) || str(d.action))
              .filter(Boolean)
          : []
        if (denied.length)
          push({
            t: 'notice',
            level: 'error',
            text: `agy can't ask for approval in a chat, so it skipped: ${[...new Set(denied)].join(', ')}. Pick Bypass permissions in the mode menu, or allow it under permissions.allow in agy's settings.json.`
          })
        push({
          t: 'turnEnd',
          costUsd: null,
          durationMs:
            typeof r.duration_seconds === 'number' ? Math.round(r.duration_seconds * 1000) : null,
          error,
          usage: null
        })
        // One turn end per message it answered, so a queued one doesn't leave the chat busy.
        const ends = Math.max(1, taken)
        taken = 0
        for (let i = 0; i < ends; i++) push({ t: 'busy', busy: false })
        break
      }
    }
    return out
  }

  return {
    args: ({ sessionId, continueLast, model, effort, mode: m }) => {
      mode = m && AGY_MODES.includes(m) ? m : 'default'
      return [
        '--print=',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        ...(sessionId ? ['--conversation', sessionId] : continueLast ? ['--continue'] : []),
        ...(model ? ['--model', model] : []),
        ...(model && effort && effortModels.has(model) ? ['--effort', effort] : []),
        ...(MODE_ARGS[mode] ?? [])
      ]
    },
    hello: () => [],
    user: (text, images) => {
      // It reads only text: images go as `@path` file references.
      const refs = saveChatImages(images).map((f) => (/\s/.test(f) ? `@"${f}"` : `@${f}`))
      const content = [text, refs.join(' ')].filter(Boolean).join('\n\n')
      return { event: 'user', message: { role: 'user', content } }
    },
    interrupt: () => null,
    setModel: () => null,
    setMode: () => null,
    answer: () => null,
    listModels: { args: ['models'], parse: parseAgyModels },
    decode
  }
}
