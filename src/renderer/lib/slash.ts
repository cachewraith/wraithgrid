// The `/` menu in the chat box: Wraithgrid's own commands, then the CLI's skills and
// commands (from its own list), then the ones that only work in the CLI's screen. codex
// skills are named as `$name` instead, and also open from a `$` word (#96). Pure.
import type { ChatCommand } from '@shared/chat'

export type SlashGroup = 'app' | 'skill' | 'builtin' | 'terminal'

export interface SlashItem {
  name: string
  description: string
  argumentHint: string
  aliases: string[]
  group: SlashGroup
  /** The plugin a skill comes from (`postman` of `postman:api-testing`). */
  source: string | null
  /** What goes before the name in the text: `$` for a codex skill. */
  sigil: '/' | '$'
}

export const SLASH_GROUP_LABEL: Record<SlashGroup, string> = {
  app: 'Wraithgrid',
  skill: 'Skills and commands',
  builtin: 'Built in',
  terminal: 'Opens in the terminal'
}
const GROUP_ORDER: SlashGroup[] = ['app', 'skill', 'builtin', 'terminal']

/** Handled by Wraithgrid itself; the CLI's commands of the same name are hidden. */
export const APP_COMMANDS: SlashItem[] = [
  {
    name: 'new',
    description: 'Start a new conversation in this chat',
    aliases: ['clear'],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  },
  {
    name: 'model',
    description: 'Switch the model',
    aliases: [],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  },
  {
    name: 'effort',
    description: 'How long it thinks: low to max',
    aliases: [],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  },
  {
    name: 'mode',
    description: 'How much it may do without asking: plan, accept edits, auto…',
    aliases: ['permissions'],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  },
  {
    name: 'usage',
    description: 'Open the usage panel: limits, cost and tokens',
    aliases: [],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  },
  {
    name: 'terminal',
    description: "Show this chat as the CLI's own terminal screen",
    aliases: [],
    argumentHint: '',
    group: 'app',
    source: null,
    sigil: '/'
  }
]

const TAKEN = new Set(APP_COMMANDS.flatMap((c) => [c.name, ...c.aliases]))

/** The menu's items for a chat: ours, then the CLI's, grouped. */
export function buildSlashItems(commands: ChatCommand[], terminalOnly: string[]): SlashItem[] {
  const term = new Set(terminalOnly)
  const theirs = commands
    .filter((c) => !TAKEN.has(c.name))
    .map((c): SlashItem => {
      const source = c.name.includes(':') ? c.name.slice(0, c.name.indexOf(':')) : null
      return {
        name: c.name,
        // claude starts a plugin's descriptions with "(plugin) "; the badge says that.
        description: source ? c.description.replace(/^\([^)]*\)\s*/, '') : c.description,
        argumentHint: c.argumentHint,
        aliases: c.aliases,
        group: term.has(c.name) ? 'terminal' : c.builtin ? 'builtin' : 'skill',
        source,
        sigil: c.mention ? '$' : '/'
      }
    })
  return [...APP_COMMANDS, ...theirs].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  )
}

/**
 * The text after `/` while the caret is still in the first word of a message that starts
 * with `/`; null when the menu should not show.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null
  const head = text.slice(0, caret)
  if (caret < 1 || /\s/.test(head)) return null
  return head.slice(1)
}

/**
 * The `$word` the caret ends (start of the text or after a space), for the skills menu:
 * where it starts and the text after `$`; null when the caret is not in one.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)\$([A-Za-z0-9_.:-]{0,100})$/.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[1]!.length - 1, query: m[1]! }
}

function subsequence(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) if (ch === q[i]) i++
  return i === q.length
}

function score(item: SlashItem, q: string): number {
  const name = item.name.toLowerCase()
  const short = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const aliases = item.aliases.map((a) => a.toLowerCase())
  if (name === q || short === q || aliases.includes(q)) return 100
  if (name.startsWith(q)) return 80
  if (short.startsWith(q)) return 75
  if (aliases.some((a) => a.startsWith(q))) return 70
  if (name.includes(q)) return 50
  if (subsequence(q, short)) return 30
  if (q.length >= 3 && item.description.toLowerCase().includes(q)) return 15
  return 0
}

/** Items matching what was typed, best first; everything (grouped) for a bare `/`. */
export function rankSlash(items: SlashItem[], query: string, limit = 80): SlashItem[] {
  const q = query.toLowerCase()
  if (!q) return items.slice(0, limit)
  return items
    .map((item) => ({ item, s: score(item, q) }))
    .filter((x) => x.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s ||
        GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) ||
        a.item.name.localeCompare(b.item.name)
    )
    .slice(0, limit)
    .map((x) => x.item)
}

/** A sent message's leading `/command`, to draw it as a chip; null for plain text. */
export function leadingCommand(text: string): { name: string; rest: string } | null {
  const m = /^\/([A-Za-z0-9_.:-]{1,100})(\s[\s\S]*)?$/.exec(text)
  return m ? { name: m[1]!, rest: (m[2] ?? '').trimStart() } : null
}
