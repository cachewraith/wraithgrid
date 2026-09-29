import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureSource, linkShared, unlinkShared } from '../../src/main/shared-config'

describe.skipIf(process.platform === 'win32')('shared CLAUDE.md and skills', () => {
  let root: string
  let source: string
  let target: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shared-'))
    source = path.join(root, 'personal')
    target = path.join(root, 'work')
    fs.mkdirSync(path.join(source, 'skills', 'deploy'), { recursive: true })
    fs.writeFileSync(path.join(source, 'CLAUDE.md'), '# shared rules\n')
    fs.writeFileSync(path.join(source, '.credentials.json'), 'secret')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('links both items into an account and is idempotent', async () => {
    const first = await linkShared(source, target)
    expect(first.map((r) => [r.item, r.outcome])).toEqual([
      ['CLAUDE.md', 'linked'],
      ['skills', 'linked']
    ])
    expect(fs.readlinkSync(path.join(target, 'CLAUDE.md'))).toBe(path.join(source, 'CLAUDE.md'))
    expect(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8')).toBe('# shared rules\n')
    expect(fs.existsSync(path.join(target, 'skills', 'deploy'))).toBe(true)
    // Credentials and everything else stay per account.
    expect(fs.existsSync(path.join(target, '.credentials.json'))).toBe(false)

    const again = await linkShared(source, target)
    expect(again.map((r) => r.outcome)).toEqual(['already-linked', 'already-linked'])
  })

  it('moves an existing CLAUDE.md and skills aside instead of deleting them', async () => {
    fs.mkdirSync(path.join(target, 'skills', 'old'), { recursive: true })
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# work only\n')
    const res = await linkShared(source, target)
    expect(res.every((r) => r.outcome === 'linked' && r.backup)).toBe(true)
    expect(fs.readFileSync(path.join(target, 'CLAUDE.md.wraithgrid-backup'), 'utf8')).toBe(
      '# work only\n'
    )
    expect(fs.existsSync(path.join(target, 'skills.wraithgrid-backup', 'old'))).toBe(true)
  })

  it('replaces a link that points somewhere else, keeping it as a backup', async () => {
    fs.mkdirSync(target)
    fs.symlinkSync('/etc/hostname', path.join(target, 'CLAUDE.md'))
    const res = await linkShared(source, target)
    expect(res[0]).toMatchObject({ outcome: 'linked' })
    expect(fs.readlinkSync(path.join(target, 'CLAUDE.md.wraithgrid-backup'))).toBe('/etc/hostname')
  })

  it('does nothing when the account is the source', async () => {
    expect(await linkShared(source, source)).toEqual([])
    expect(await unlinkShared(source, source)).toEqual([])
  })

  it('unlinking removes only its own links and restores backups', async () => {
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# work only\n')
    await linkShared(source, target)
    const res = await unlinkShared(source, target)
    expect(res.map((r) => [r.item, r.outcome])).toEqual([
      ['CLAUDE.md', 'restored'],
      ['skills', 'unlinked']
    ])
    expect(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8')).toBe('# work only\n')
    expect(fs.existsSync(path.join(target, 'skills'))).toBe(false)
    // The source itself is untouched.
    expect(fs.readFileSync(path.join(source, 'CLAUDE.md'), 'utf8')).toBe('# shared rules\n')
  })

  it('never touches real files that are not its links', async () => {
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# mine\n')
    expect(await unlinkShared(source, target)).toEqual([])
    expect(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8')).toBe('# mine\n')
  })

  it('creates empty shared items in a source that has none, without overwriting', async () => {
    const fresh = path.join(root, 'fresh')
    await ensureSource(fresh)
    expect(fs.readFileSync(path.join(fresh, 'CLAUDE.md'), 'utf8')).toBe('')
    expect(fs.statSync(path.join(fresh, 'skills')).isDirectory()).toBe(true)
    await ensureSource(source)
    expect(fs.readFileSync(path.join(source, 'CLAUDE.md'), 'utf8')).toBe('# shared rules\n')
  })

  it('deleting an account dir removes the links but not the shared files', async () => {
    await linkShared(source, target)
    fs.rmSync(target, { recursive: true, force: true })
    expect(fs.readFileSync(path.join(source, 'CLAUDE.md'), 'utf8')).toBe('# shared rules\n')
    expect(fs.existsSync(path.join(source, 'skills', 'deploy'))).toBe(true)
  })
})
