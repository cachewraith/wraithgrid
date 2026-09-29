import { describe, expect, it } from 'vitest'
import { formatArgs, parseArgs } from '@shared/args'
import { contractHome, expandHome, slugify } from '@shared/paths'
import { stripAnsi } from '../../src/renderer/lib/ansi'
import {
  APPROVAL_PATTERN,
  LOGIN_PATTERN,
  deriveStatus,
  lastErrorLine
} from '../../src/renderer/lib/status'

describe('launch args', () => {
  it('splits like a shell without expanding anything', () => {
    expect(parseArgs('')).toEqual([])
    expect(parseArgs('  --resume  ')).toEqual(['--resume'])
    expect(parseArgs('-c --model "claude x" \'a b\'')).toEqual(['-c', '--model', 'claude x', 'a b'])
    expect(parseArgs('$(rm -rf ~) `x` ;ls')).toEqual(['$(rm', '-rf', '~)', '`x`', ';ls'])
    expect(parseArgs('""')).toEqual([''])
  })

  it('round-trips through formatArgs', () => {
    const args = ['-c', 'two words', "it's"]
    expect(parseArgs(formatArgs(args))).toEqual(args)
  })
})

describe('paths', () => {
  it('expands and contracts the home dir', () => {
    expect(expandHome('~/p', '/home/u')).toBe('/home/u/p')
    expect(expandHome('~', '/home/u')).toBe('/home/u')
    expect(expandHome('/abs', '/home/u')).toBe('/abs')
    expect(expandHome('~other/x', '/home/u')).toBe('~other/x')
    expect(contractHome('/home/u/p', '/home/u')).toBe('~/p')
    expect(contractHome('/home/user2', '/home/u')).toBe('/home/user2')
  })

  it('slugifies account names', () => {
    expect(slugify('  My Work!  ')).toBe('my-work')
    expect(slugify('../../etc')).toBe('etc')
    expect(slugify('###')).toBe('')
  })
})

describe('pane status', () => {
  const base = { started: true, exited: false, loginNeeded: false, now: 10_000 }

  it('derives status from process state and activity', () => {
    expect(deriveStatus({ ...base, exited: true, activity: undefined })).toBe('exited')
    expect(deriveStatus({ ...base, started: false, activity: undefined })).toBe('starting')
    expect(deriveStatus({ ...base, loginNeeded: true, activity: undefined })).toBe('login')
    const quiet = { lastOutputAt: 1000, lastInputAt: 0, approvalAt: 0 }
    expect(deriveStatus({ ...base, activity: quiet })).toBe('idle')
    expect(deriveStatus({ ...base, activity: { ...quiet, lastOutputAt: 9500 } })).toBe('running')
    expect(deriveStatus({ ...base, activity: { ...quiet, approvalAt: 900 } })).toBe('approval')
    // Answering the prompt clears it.
    expect(
      deriveStatus({ ...base, activity: { ...quiet, approvalAt: 900, lastInputAt: 950 } })
    ).toBe('idle')
  })

  it('recognizes prompts and login lines in terminal output', () => {
    expect(APPROVAL_PATTERN.test(stripAnsi('\x1b[1mDo you want to proceed?\x1b[0m'))).toBe(true)
    expect(APPROVAL_PATTERN.test('Do you want to make this edit to auth.ts?')).toBe(true)
    expect(LOGIN_PATTERN.test('Login successful. Press Enter to continue')).toBe(true)
    expect(LOGIN_PATTERN.test('Logged in as someone@example.com')).toBe(true)
    expect(LOGIN_PATTERN.test('Not logged in. Run /login')).toBe(false)
  })

  it('strips escape sequences but keeps newlines', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m\r\nnext\x1b]8;;https://x\x07link\x1b]8;;\x07')).toBe(
      'red\nnextlink'
    )
  })

  it('picks the most relevant line for the exit bar', () => {
    expect(lastErrorLine('ok\nError: ECONNRESET while streaming\nbye\n')).toBe(
      'Error: ECONNRESET while streaming'
    )
    expect(lastErrorLine('just\nlines\n')).toBe('lines')
    expect(lastErrorLine('')).toBeNull()
  })
})
