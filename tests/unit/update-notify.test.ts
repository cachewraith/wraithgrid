import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpdateCheckResult } from '@shared/ipc-contract'
import { notifyIfNew, type UpdateNotice } from '../../src/main/update-notify'

const available = (version: string, url?: string): UpdateCheckResult => ({
  status: 'available',
  current: '1.1.0',
  checkedAt: 0,
  latest: {
    version,
    url: url ?? `https://github.com/cachewraith/wraithgrid/releases/tag/v${version}`,
    notes: '',
    publishedAt: null
  }
})

describe('notifyIfNew', () => {
  let dir: string
  let shown: UpdateNotice[]
  let deps: { stateFile: string; show: (n: UpdateNotice) => void }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-notify-'))
    shown = []
    deps = { stateFile: path.join(dir, 'update-notified.json'), show: (n) => shown.push(n) }
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('announces a new release once per version', async () => {
    expect(await notifyIfNew(available('1.2.0'), deps)).toBe(true)
    expect(shown[0]).toMatchObject({ title: 'Wraithgrid 1.2.0 is available' })
    expect(await notifyIfNew(available('1.2.0'), deps)).toBe(false)
    expect(await notifyIfNew(available('1.3.0'), deps)).toBe(true)
    expect(shown).toHaveLength(2)
  })

  it('stays quiet when up to date or the check failed', async () => {
    const current: UpdateCheckResult = {
      status: 'current',
      current: '1.1.0',
      checkedAt: 0,
      latest: { version: '1.1.0', url: '', notes: '', publishedAt: null }
    }
    const failed: UpdateCheckResult = {
      status: 'error',
      current: '1.1.0',
      error: 'x',
      checkedAt: 0
    }
    expect(await notifyIfNew(current, deps)).toBe(false)
    expect(await notifyIfNew(failed, deps)).toBe(false)
    expect(shown).toHaveLength(0)
  })

  it('never offers a link outside the project release pages', async () => {
    expect(await notifyIfNew(available('9.9.9', 'https://evil.example/x'), deps)).toBe(false)
    expect(shown).toHaveLength(0)
  })

  it('treats an unreadable state file as nothing announced yet', async () => {
    fs.writeFileSync(deps.stateFile, 'not json')
    expect(await notifyIfNew(available('1.2.0'), deps)).toBe(true)
  })
})
