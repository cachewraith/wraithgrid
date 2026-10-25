import { describe, expect, it } from 'vitest'
import { cycleModes, type ChatCommand, type ChatMode } from '@shared/chat'
import { createClaudeAdapter } from '../../src/main/chat/claude'
import {
  APP_COMMANDS,
  buildSlashItems,
  leadingCommand,
  mentionQuery,
  rankSlash,
  slashQuery
} from '../../src/renderer/lib/slash'

const cmd = (name: string, extra: Partial<ChatCommand> = {}): ChatCommand => ({
  name,
  description: '',
  argumentHint: '',
  aliases: [],
  builtin: false,
  ...extra
})

// Shapes from claude 2.1.306's initialize answer (`commands`) and init (`terminal_slash_commands`).
const COMMANDS = [
  cmd('product-management:brainstorm', {
    description: '(product-management) Brainstorm a product idea',
    argumentHint: '<topic, problem, or idea to explore>'
  }),
  cmd('postman:api-testing', { description: '(postman) Use when testing an endpoint' }),
  cmd('postman:api-mocking', { description: '(postman) Use when creating a stand-in backend' }),
  cmd('cachewraith-skills:testing', { aliases: ['testing'] }),
  cmd('compact', { builtin: true, description: 'Clear conversation history but keep a summary' }),
  cmd('clear', { builtin: true }),
  cmd('model', { builtin: true }),
  cmd('doctor', { builtin: true })
]

describe('slashQuery', () => {
  it('is the first word after a leading /, while the caret is in it', () => {
    expect(slashQuery('/', 1)).toBe('')
    expect(slashQuery('/api', 4)).toBe('api')
    expect(slashQuery('/api', 2)).toBe('a')
    expect(slashQuery('/api test', 9)).toBeNull()
    expect(slashQuery('hi /api', 7)).toBeNull()
    expect(slashQuery('/api', 0)).toBeNull()
  })
})

describe('buildSlashItems', () => {
  const items = buildSlashItems(COMMANDS, ['doctor'])

  it('puts ours first and hides the CLI commands ours replace', () => {
    expect(items.slice(0, APP_COMMANDS.length).map((i) => i.name)).toEqual([
      'new',
      'model',
      'effort',
      'mode',
      'usage',
      'terminal'
    ])
    expect(
      items.filter((i) => i.name === 'clear' || (i.name === 'model' && i.group !== 'app'))
    ).toEqual([])
  })

  it('groups skills, built-ins and terminal-only commands; the plugin is a badge', () => {
    const by = (n: string) => items.find((i) => i.name === n)!
    expect(by('postman:api-testing')).toMatchObject({
      group: 'skill',
      source: 'postman',
      description: 'Use when testing an endpoint'
    })
    expect(by('compact').group).toBe('builtin')
    expect(by('doctor').group).toBe('terminal')
    expect(items.map((i) => i.group)).toEqual(
      [...items.map((i) => i.group)].sort(
        (a, b) =>
          ['app', 'skill', 'builtin', 'terminal'].indexOf(a) -
          ['app', 'skill', 'builtin', 'terminal'].indexOf(b)
      )
    )
  })
})

describe('rankSlash', () => {
  const items = buildSlashItems(COMMANDS, ['doctor'])
  const names = (q: string) => rankSlash(items, q).map((i) => i.name)

  it('lists everything for a bare /', () => {
    expect(names('')).toHaveLength(items.length)
  })

  it('ranks exact, then prefix of the name, the part after the plugin, aliases', () => {
    expect(names('usage')[0]).toBe('usage')
    expect(names('clear')[0]).toBe('new')
    expect(names('api-t')[0]).toBe('postman:api-testing')
    expect(names('postman')).toEqual(['postman:api-mocking', 'postman:api-testing'])
    expect(names('testing')[0]).toBe('cachewraith-skills:testing')
    expect(names('brain')[0]).toBe('product-management:brainstorm')
  })

  it('matches letters in order, then descriptions; nothing for nonsense', () => {
    expect(names('apmk')).toContain('postman:api-mocking')
    expect(names('summary')).toEqual(['compact'])
    expect(names('zzzz')).toEqual([])
  })
})

describe('leadingCommand', () => {
  it('splits a sent /command from its arguments', () => {
    expect(leadingCommand('/postman:api-testing check login')).toEqual({
      name: 'postman:api-testing',
      rest: 'check login'
    })
    expect(leadingCommand('/compact')).toEqual({ name: 'compact', rest: '' })
    expect(leadingCommand('hello /x')).toBeNull()
    expect(leadingCommand('/not a/ path')).toEqual({ name: 'not', rest: 'a/ path' })
  })
})

describe('claude adapter: commands', () => {
  it('reads the initialize answer’s commands and the init’s terminal-only list', () => {
    const a = createClaudeAdapter()
    const [hello] = a.hello() as [{ request_id: string }]
    const caps = a.decode({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: hello.request_id,
        response: {
          models: [],
          commands: [
            {
              name: 'postman:api-testing',
              description: '(postman) Test',
              argumentHint: '',
              aliases: []
            },
            {
              name: 'compact',
              description: 'Compact',
              argumentHint: '<instructions>',
              builtin: true
            },
            { name: '__remote-workflow', description: 'internal' },
            { name: 'bad name; rm', description: 'x' }
          ]
        }
      }
    }).events[0]
    expect(caps).toMatchObject({
      t: 'capabilities',
      commands: [
        { name: 'postman:api-testing', builtin: false, aliases: [] },
        { name: 'compact', builtin: true, argumentHint: '<instructions>' }
      ]
    })
    const session = a.decode({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      terminal_slash_commands: ['doctor', 'color']
    }).events[0]
    expect(session).toMatchObject({ t: 'session', terminalOnly: ['doctor', 'color'] })
  })
})

describe('claude adapter: permission modes', () => {
  it('reads the mode from init and status, switches it live, and starts in it', () => {
    const a = createClaudeAdapter()
    expect(
      a.decode({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan' }).events
    ).toEqual([{ t: 'mode', mode: 'plan' }])
    expect(a.decode({ type: 'system', subtype: 'status', permissionMode: 'weird' }).events).toEqual(
      []
    )
    expect(a.setMode!('auto')).toMatchObject({
      type: 'control_request',
      request: { subtype: 'set_permission_mode', mode: 'auto' }
    })
    const args = (mode: ChatMode | null) =>
      a.args({ sessionId: null, continueLast: false, model: null, effort: null, mode })
    expect(args('plan')).toEqual(expect.arrayContaining(['--permission-mode', 'plan']))
    expect(args('default')).not.toContain('--permission-mode')
    expect(args(null)).not.toContain('--permission-mode')
  })

  it('Shift+Tab steps through ask, accept edits, plan (and auto where the model has it)', () => {
    expect(cycleModes(false)).toEqual(['default', 'acceptEdits', 'plan'])
    expect(cycleModes(true)).toEqual(['default', 'acceptEdits', 'plan', 'auto'])
  })
})

describe('codex $ skills (#96)', () => {
  it('a skill is named with $, in the / menu too', () => {
    const items = buildSlashItems([cmd('review', { mention: true })], [])
    expect(items.find((i) => i.name === 'review')).toMatchObject({ group: 'skill', sigil: '$' })
    expect(items.find((i) => i.name === 'new')!.sigil).toBe('/')
  })

  it('mentionQuery is the $word the caret ends, at the start or after a space', () => {
    expect(mentionQuery('$', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('use $rev', 8)).toEqual({ start: 4, query: 'rev' })
    expect(mentionQuery('use $rev now', 12)).toBeNull()
    expect(mentionQuery('a$b', 3)).toBeNull()
    expect(mentionQuery('plain', 5)).toBeNull()
  })
})
