import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPaneEnv, pluginDirsValue } from '../../src/main/pane-env'

const home = path.resolve('/home/tester')
const base = {
  PATH: '/usr/bin',
  HOME: home,
  SHELL: '/bin/zsh',
  ELECTRON_RUN_AS_NODE: '1',
  EMPTY: undefined
}

describe('buildPaneEnv', () => {
  it('sets CLAUDE_CONFIG_DIR for claude panes, expanding ~', () => {
    const env = buildPaneEnv({
      baseEnv: base,
      shell: false,
      configDir: '~/.wraithgrid/accounts/work',
      homeDir: home
    })
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(home, '.wraithgrid', 'accounts', 'work'))
  })

  it('keeps absolute config dirs as they are', () => {
    const dir = path.resolve('/srv/claude/acme')
    const env = buildPaneEnv({ baseEnv: base, shell: false, configDir: dir, homeDir: home })
    expect(env.CLAUDE_CONFIG_DIR).toBe(dir)
  })

  it('handles a bare ~', () => {
    const env = buildPaneEnv({ baseEnv: base, shell: false, configDir: '~', homeDir: home })
    expect(env.CLAUDE_CONFIG_DIR).toBe(home)
  })

  it('does not set CLAUDE_CONFIG_DIR for shell panes', () => {
    const env = buildPaneEnv({ baseEnv: base, shell: true, configDir: '~/.claude', homeDir: home })
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('does not set CLAUDE_CONFIG_DIR without an account', () => {
    const env = buildPaneEnv({ baseEnv: base, shell: false, configDir: null, homeDir: home })
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('overrides an inherited CLAUDE_CONFIG_DIR for claude panes', () => {
    const env = buildPaneEnv({
      baseEnv: { ...base, CLAUDE_CONFIG_DIR: '/elsewhere' },
      shell: false,
      configDir: '~/.claude',
      homeDir: home
    })
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(home, '.claude'))
  })

  it('sets terminal capabilities and drops Electron and undefined variables', () => {
    const env = buildPaneEnv({ baseEnv: base, shell: false, configDir: '~/.claude', homeDir: home })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PATH).toBe('/usr/bin')
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('EMPTY')
  })

  it('never mutates the base environment', () => {
    const copy = { ...base }
    buildPaneEnv({ baseEnv: copy, shell: false, configDir: '~/.claude', homeDir: home })
    expect(copy).toEqual(base)
  })

  it('points gemini at its config dir with GEMINI_CLI_HOME', () => {
    const env = buildPaneEnv({
      baseEnv: base,
      shell: false,
      cli: 'gemini',
      configDir: '~/.wraithgrid/accounts/g',
      homeDir: home
    })
    expect(env.GEMINI_CLI_HOME).toBe(path.join(home, '.wraithgrid', 'accounts', 'g'))
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('sets no config dir variable for agy, dropping inherited ones', () => {
    const env = buildPaneEnv({
      baseEnv: { ...base, CLAUDE_CONFIG_DIR: '/x', GEMINI_CLI_HOME: '/y' },
      shell: false,
      cli: 'agy',
      configDir: '~/.wraithgrid/accounts/a',
      homeDir: home
    })
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    expect(env).not.toHaveProperty('GEMINI_CLI_HOME')
  })

  it('gives each CLI only its own config dir variable from the registry', () => {
    const inherited = { ...base, CODEX_HOME: '/x', COPILOT_HOME: '/y', CURSOR_CONFIG_DIR: '/z' }
    const dir = path.join(home, '.wraithgrid', 'accounts', 'c')
    const run = (cli: 'codex' | 'copilot' | 'cursor' | 'opencode') =>
      buildPaneEnv({ baseEnv: inherited, shell: false, cli, configDir: dir, homeDir: home })
    expect(run('codex')).toMatchObject({ CODEX_HOME: dir })
    expect(run('codex')).not.toHaveProperty('COPILOT_HOME')
    expect(run('copilot')).toMatchObject({ COPILOT_HOME: dir })
    expect(run('cursor')).toMatchObject({ CURSOR_CONFIG_DIR: dir })
    for (const v of ['CODEX_HOME', 'COPILOT_HOME', 'CURSOR_CONFIG_DIR'])
      expect(run('opencode')).not.toHaveProperty(v)
  })

  it('keeps inherited config dir variables in plain shell panes', () => {
    const env = buildPaneEnv({
      baseEnv: { ...base, CODEX_HOME: '/x' },
      shell: true,
      configDir: null,
      homeDir: home
    })
    expect(env.CODEX_HOME).toBe('/x')
  })
})

describe('mod folders (CLAUDE_CODE_PLUGIN_DIRS)', () => {
  const claude = { baseEnv: base, shell: false, configDir: '~/.claude', homeDir: home } as const

  // Absolute paths are the host's (a drive letter on Windows), so these two run as the host.
  const sep = path.delimiter

  it('gives claude panes the mod folders as absolute paths', () => {
    const env = buildPaneEnv({ ...claude, modDirs: ['~/mods/tally', ' '] })
    expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe(path.join(home, 'mods', 'tally'))
  })

  it('keeps folders the user already named, without repeats', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((n) => path.resolve('/opt/mods', n))
    expect(pluginDirsValue(`${a}${sep}${b}`, [a!, c!], home, process.platform)).toBe(
      [a, b, c].join(sep)
    )
  })

  it('separates with ; on Windows and leaves out a folder holding the separator', () => {
    expect(pluginDirsValue('C:\\a', [], home, 'win32')).toBe('C:\\a')
    expect(pluginDirsValue(undefined, ['/opt/we:ird'], home, 'linux')).toBe('')
  })

  it('is not set without mod folders, nor for shell, gemini or agy panes', () => {
    expect(buildPaneEnv(claude)).not.toHaveProperty('CLAUDE_CODE_PLUGIN_DIRS')
    const dirs = ['~/mods/tally']
    for (const extra of [{ shell: true }, { cli: 'gemini' }, { cli: 'agy' }] as const) {
      expect(buildPaneEnv({ ...claude, ...extra, modDirs: dirs })).not.toHaveProperty(
        'CLAUDE_CODE_PLUGIN_DIRS'
      )
    }
  })
})
