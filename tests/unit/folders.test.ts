import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FOLDER_ENTRIES_MAX, gitBranchOf, listFolder } from '../../src/main/folders'

// Display paths keep the OS separator (contractHome), so expectations must too (Windows CI).
const sep = (s: string): string => s.replaceAll('/', path.sep)

function home(): string {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-folders-')))
  for (const d of ['code/api/.git/refs', 'code/web', 'code/.cache', 'Code2', 'docs'])
    fs.mkdirSync(path.join(h, d), { recursive: true })
  fs.writeFileSync(path.join(h, 'code/api/.git/HEAD'), 'ref: refs/heads/feat/x\n')
  fs.writeFileSync(path.join(h, 'code/readme.md'), 'not a folder')
  return h
}

describe('folder picker listing', () => {
  it('lists folders only, sorted, marking git repos and hidden ones; ~ in and out', async () => {
    const h = home()
    const r = await listFolder('~/code', h)
    expect(r).toMatchObject({
      ok: true,
      path: sep('~/code'),
      parent: '~',
      truncated: false,
      branch: null
    })
    expect(r.ok && r.entries).toEqual([
      { name: '.cache', hidden: true, git: false },
      { name: 'api', hidden: false, git: true },
      { name: 'web', hidden: false, git: false }
    ])
    // Relative paths are from home; the folder's own branch comes from .git/HEAD.
    expect(await listFolder('code/api', h)).toMatchObject({
      ok: true,
      path: sep('~/code/api'),
      branch: 'feat/x'
    })
    expect((await listFolder('', h)).path).toBe('~')
  })

  it('says why a folder cannot be listed', async () => {
    const h = home()
    expect(await listFolder('~/nope', h)).toMatchObject({
      ok: false,
      error: 'This folder does not exist.'
    })
    expect(await listFolder('~/code/readme.md', h)).toMatchObject({
      ok: false,
      error: 'That is a file, not a folder.'
    })
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const locked = path.join(h, 'locked')
      fs.mkdirSync(locked, { mode: 0o000 })
      expect(await listFolder(locked, h)).toMatchObject({ ok: false, error: /permission/ })
      fs.chmodSync(locked, 0o755)
    }
  })

  it('caps big folders', async () => {
    const h = home()
    const big = path.join(h, 'big')
    for (let i = 0; i < FOLDER_ENTRIES_MAX + 5; i++)
      fs.mkdirSync(path.join(big, `d${i}`), { recursive: true })
    const r = await listFolder(big, h)
    expect(r.ok && r.entries.length).toBe(FOLDER_ENTRIES_MAX)
    expect(r.ok && r.truncated).toBe(true)
    // Numeric order, not text order.
    expect(r.ok && r.entries.slice(0, 3).map((e) => e.name)).toEqual(['d0', 'd1', 'd2'])
  })

  it('reads a worktree branch through its .git file', async () => {
    const h = home()
    const real = path.join(h, 'gitdir')
    fs.mkdirSync(real)
    fs.writeFileSync(path.join(real, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    const wt = path.join(h, 'wt')
    fs.mkdirSync(wt)
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${real}\n`)
    expect(await gitBranchOf(wt)).toBe('wt-branch')
    expect(await gitBranchOf(path.join(h, 'docs'))).toBeNull()
  })
})
