import { describe, expect, it } from 'vitest'
import {
  AGENT_CLIS,
  AGENT_CLI_SPECS,
  CONFIG_DIR_VARS,
  withProjectDocArgs,
  withResumeArgs
} from '../../src/shared/agent-clis'
import { imagePasteText } from '../../src/main/clipboard-image'

describe('agent CLI registry', () => {
  it('has a spec for every CLI, and only shared sign-ins lack a config dir variable', () => {
    for (const cli of AGENT_CLIS) {
      const spec = AGENT_CLI_SPECS[cli]
      expect(spec.bin).toMatch(/^[a-z-]+$/)
      expect(spec.configDirVar === null).toBe(spec.signIn === 'shared')
    }
    expect(CONFIG_DIR_VARS).toEqual([
      'CLAUDE_CONFIG_DIR',
      'GEMINI_CLI_HOME',
      'CODEX_HOME',
      'CURSOR_CONFIG_DIR',
      'COPILOT_HOME'
    ])
  })

  it('adds the resume args before the pane args, once', () => {
    expect(withResumeArgs('claude', ['--model', 'opus'])).toEqual(['--continue', '--model', 'opus'])
    expect(withResumeArgs('codex', [])).toEqual(['resume', '--last'])
    expect(withResumeArgs('gemini', [])).toEqual(['--resume', 'latest'])
    expect(withResumeArgs('claude', ['--resume', 'abc'])).toEqual(['--resume', 'abc'])
    expect(withResumeArgs('claude', ['-c'])).toEqual(['-c'])
    expect(withResumeArgs('agy', ['x'])).toEqual(['--continue', 'x'])
  })

  it('pastes an image as a path or an @path reference', () => {
    expect(imagePasteText('claude', '/t/a.png')).toBe('/t/a.png ')
    expect(imagePasteText('codex', '/t/a.png')).toBe('/t/a.png ')
    expect(imagePasteText('copilot', '/t/my a.png')).toBe('@"/t/my a.png" ')
  })

  it('recognizes each CLI family’s approval prompt', () => {
    expect(AGENT_CLI_SPECS.gemini.approval.test('Allow execution of: rm -rf build?')).toBe(true)
    expect(
      AGENT_CLI_SPECS.codex.approval.test('Would you like to run the following command?')
    ).toBe(true)
    expect(AGENT_CLI_SPECS.opencode.approval.test('Run this command? [y/N]')).toBe(true)
    expect(AGENT_CLI_SPECS.claude.approval.test('Allow execution of: ls?')).toBe(false)
  })
})

describe('withProjectDocArgs', () => {
  it("makes codex read a project's CLAUDE.md, before any subcommand", () => {
    expect(withProjectDocArgs('codex', withResumeArgs('codex', []))).toEqual([
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      'resume',
      '--last'
    ])
    expect(withProjectDocArgs('codex', ['app-server'])[2]).toBe('app-server')
    expect(withProjectDocArgs('claude', ['--model', 'opus'])).toEqual(['--model', 'opus'])
  })
})
