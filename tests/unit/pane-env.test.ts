import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPaneEnv } from '../../src/main/pane-env'

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
})
