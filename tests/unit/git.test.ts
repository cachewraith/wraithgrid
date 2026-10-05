import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BRANCH_PATTERN,
  DIFF_MAX_BYTES,
  addWorktree,
  gitDiff,
  gitStatus,
  parseStatus,
  worktreeDir,
  type GitRunner
} from '../../src/main/git'
import { parsePatch } from '../../src/renderer/lib/diff'
import { matches } from '../../src/renderer/lib/search'

const realGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: os.devNull,
          LC_ALL: 'C'
        }
      },
      (err, stdout, stderr) =>
        err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))
    )
  })

describe('parseStatus', () => {
  it('reads the branch, ahead/behind and the change count', () => {
    expect(parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({
      branch: 'main',
      ahead: 2,
      behind: 1,
      changed: 2
    })
    expect(parseStatus('## feat/x\n')).toEqual({
      branch: 'feat/x',
      ahead: 0,
      behind: 0,
      changed: 0
    })
    expect(parseStatus('## No commits yet on main\n?? a\n').branch).toBe('main')
    expect(parseStatus('## HEAD (no branch)\n').branch).toBeNull()
  })

  it('reports a non-repo when git fails', async () => {
    const failing: GitRunner = () => Promise.reject(new Error('not a git repository'))
    expect(await gitStatus(failing, '/x')).toMatchObject({ repo: false, changed: 0 })
  })
})

describe('branch names', () => {
  it('accepts plain names and refuses option-like or unsafe ones', () => {
    for (const ok of ['feat/rate-limit', 'fix_1', 'v1.2'])
      expect(BRANCH_PATTERN.test(ok)).toBe(true)
    for (const bad of ['-b', '--force', 'a..b', 'a b', 'x.lock', 'x/', 'a//b', '', 'a;rm'])
      expect(BRANCH_PATTERN.test(bad)).toBe(false)
  })

  it('never runs git for a refused name', async () => {
    let called = false
    const spy: GitRunner = () => {
      called = true
      return Promise.resolve('')
    }
    expect(await addWorktree(spy, '/r', '--upload-pack=x', '/w')).toMatchObject({ ok: false })
    expect(called).toBe(false)
  })

  it('puts worktrees under the root, one folder per repo, slashes flattened', () => {
    expect(worktreeDir('/h/wt', '/code/api', 'feat/x')).toBe(path.join('/h/wt', 'api', 'feat-x'))
  })
})

describe('gitDiff', () => {
  it('cuts a huge diff and says so', async () => {
    const big = 'x'.repeat(DIFF_MAX_BYTES + 10)
    const run: GitRunner = (args) => Promise.resolve(args[0] === 'diff' ? big : '')
    const r = await gitDiff(run, '/r')
    expect(r.ok && r.truncated).toBe(true)
    expect(r.ok && r.patch.length).toBe(DIFF_MAX_BYTES)
  })
})

describe('with a real repository', () => {
  let dir: string
  let wt: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wg-git-')))
    wt = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wg-wt-')))
    await realGit(['init', '-q', '-b', 'main'], dir)
    await writeFile(path.join(dir, 'a.txt'), 'one\n')
    await realGit(['add', '.'], dir)
    await realGit(['commit', '-qm', 'init'], dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(wt, { recursive: true, force: true })
  })

  it('reads status and diff, and adds a worktree on a new branch', async () => {
    await writeFile(path.join(dir, 'a.txt'), 'two\n')
    await writeFile(path.join(dir, 'new.txt'), 'n\n')
    expect(await gitStatus(realGit, dir)).toEqual({
      repo: true,
      branch: 'main',
      ahead: 0,
      behind: 0,
      changed: 2
    })
    const d = await gitDiff(realGit, dir)
    expect(d.ok && d.untracked).toEqual(['new.txt'])
    const files = d.ok ? parsePatch(d.patch) : []
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'a.txt', added: 1, removed: 1 })

    const r = await addWorktree(realGit, dir, 'feat/x', wt)
    expect(r).toEqual({ ok: true, dir: path.join(wt, path.basename(dir), 'feat-x') })
    expect(r.ok && (await gitStatus(realGit, r.dir)).branch).toBe('feat/x')
    // The same branch twice is git's error, passed on.
    const again = await addWorktree(realGit, dir, 'feat/x', wt)
    expect(again.ok).toBe(false)
    expect(!again.ok && again.error).toMatch(/already exists/)
  })
})

describe('parsePatch', () => {
  it('splits files and counts lines, with renames, new files and binaries', () => {
    const patch = [
      'diff --git a/src/x.ts b/src/x.ts',
      'index 1..2 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '+new',
      '\\ No newline at end of file',
      'diff --git a/n.md b/n.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/n.md',
      '@@ -0,0 +1 @@',
      '+hi',
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      ''
    ].join('\n')
    const files = parsePatch(patch)
    expect(files.map((f) => [f.path, f.status, f.added, f.removed, f.binary])).toEqual([
      ['src/x.ts', 'modified', 1, 1, false],
      ['n.md', 'added', 1, 0, false],
      ['new.ts', 'renamed', 0, 0, false],
      ['img.png', 'modified', 0, 0, true]
    ])
    expect(files[0]!.lines.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'meta'])
    expect(files[2]!.oldPath).toBe('old.ts')
  })

  it('returns nothing for an empty diff', () => {
    expect(parsePatch('')).toEqual([])
  })
})

describe('palette search', () => {
  it('needs every word, in any order, case-insensitive', () => {
    expect(matches('api work', 'api-server work · main')).toBe(true)
    expect(matches('WORK api', 'api-server work')).toBe(true)
    expect(matches('api infra', 'api-server work')).toBe(false)
    expect(matches('  ', 'anything')).toBe(true)
  })
})
