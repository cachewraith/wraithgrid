import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BRANCH_PATTERN,
  DIFF_MAX_BYTES,
  addWorktree,
  checkWorktree,
  commitAll,
  gitDiff,
  gitLog,
  gitShow,
  gitStatus,
  listBranches,
  parseBranches,
  parseStatus,
  pullBranch,
  pullRequestLink,
  pullRequestUrl,
  pushBranch,
  removeWorktree,
  switchBranch,
  worktreeDir,
  type GitRunner
} from '../../src/main/git'
import { parsePatch } from '../../src/renderer/lib/diff'
import { matches } from '../../src/renderer/lib/search'

// An empty global git config, so the user's own config can't change results. Not
// os.devNull: on Windows that is \\.\nul, which git refuses to open.
const EMPTY_GITCONFIG = path.join(os.tmpdir(), `wg-empty-gitconfig-${process.pid}`)
writeFileSync(EMPTY_GITCONFIG, '')

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
          GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG,
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

// These suites spawn many Git processes; Windows runners can exceed the unit-test default.
const REAL_GIT_TIMEOUT = 30_000

describe('with a real repository', { timeout: REAL_GIT_TIMEOUT }, () => {
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
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    await rm(wt, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
    // A team agent (#79) takes the same folder again, or its branch once the folder is gone.
    expect(await addWorktree(realGit, dir, 'feat/x', wt, true)).toEqual(r)
    await rm(path.join(wt, path.basename(dir), 'feat-x'), { recursive: true, force: true })
    await realGit(['worktree', 'prune'], dir)
    expect(await addWorktree(realGit, dir, 'feat/x', wt, true)).toEqual(r)
  })

  it('commits everything, then pushes the branch with an upstream on the first push', async () => {
    expect(await commitAll(realGit, dir, '  ')).toEqual({
      ok: false,
      error: 'Write a commit message first.'
    })
    expect(await pushBranch(realGit, dir)).toEqual({
      ok: false,
      error: 'This repository has no remote to push to.'
    })
    await writeFile(path.join(dir, 'a.txt'), 'two\n')
    await writeFile(path.join(dir, 'b.txt'), 'b\n')
    const c = await commitAll(realGit, dir, 'feat: two files')
    expect(c.ok && c.detail).toMatch(/^Committed [0-9a-f]+$/)
    expect((await gitStatus(realGit, dir)).changed).toBe(0)
    expect((await realGit(['log', '-1', '--format=%s'], dir)).trim()).toBe('feat: two files')

    const bare = path.join(wt, 'remote.git')
    await realGit(['init', '-q', '--bare', bare], wt)
    await realGit(['remote', 'add', 'origin', bare], dir)
    expect(await pushBranch(realGit, dir)).toEqual({ ok: true, detail: 'Pushed main to origin' })
    await writeFile(path.join(dir, 'c.txt'), 'c\n')
    await commitAll(realGit, dir, 'more')
    expect(await pushBranch(realGit, dir)).toEqual({ ok: true, detail: 'Pushed main' })
    expect((await realGit(['log', '-1', '--format=%s', 'main'], bare)).trim()).toBe('more')

    // The remote is a local folder, not GitHub or GitLab.
    expect(await pullRequestLink(realGit, dir)).toEqual({
      ok: false,
      error: 'Pull requests open for GitHub and GitLab remotes only.'
    })
  })

  it('lists branches newest first and switches local, remote and new ones', async () => {
    const bare = path.join(wt, 'remote.git')
    await realGit(['init', '-q', '--bare', bare], wt)
    await realGit(['remote', 'add', 'origin', bare], dir)
    await realGit(['push', '-q', '-u', 'origin', 'main'], dir)
    // A branch only the remote has (pushed from another checkout).
    await realGit(['push', '-q', 'origin', 'main:refs/heads/theirs'], dir)
    await realGit(['fetch', '-q', 'origin'], dir)
    await realGit(['branch', '-q', 'older'], dir)

    const list = await listBranches(realGit, dir)
    if (!list.ok) throw new Error(list.error)
    expect(list.current).toBe('main')
    expect(list.local.map((b) => b.name).sort()).toEqual(['main', 'older'])
    expect(list.local.find((b) => b.name === 'main')!.upstream).toBe('origin/main')
    expect(list.remote.map((b) => b.name)).toEqual(['origin/theirs'])

    expect(await switchBranch(realGit, dir, { kind: 'local', name: 'older' })).toEqual({
      ok: true,
      detail: 'Switched to older'
    })
    expect(await switchBranch(realGit, dir, { kind: 'remote', name: 'origin/theirs' })).toEqual({
      ok: true,
      detail: 'Switched to theirs'
    })
    expect((await realGit(['rev-parse', '--abbrev-ref', '@{u}'], dir)).trim()).toBe('origin/theirs')
    expect(await switchBranch(realGit, dir, { kind: 'create', name: 'feat/new' })).toEqual({
      ok: true,
      detail: 'Switched to feat/new'
    })
    expect(await switchBranch(realGit, dir, { kind: 'local', name: 'feat/new' })).toEqual({
      ok: true,
      detail: 'Already on feat/new'
    })
  })

  it('refuses names git did not list, bad new names, and a switch that would lose changes', async () => {
    expect(await switchBranch(realGit, dir, { kind: 'local', name: '--orphan=x' })).toEqual({
      ok: false,
      error: 'No branch --orphan=x here any more.'
    })
    expect(await switchBranch(realGit, dir, { kind: 'create', name: '-x' })).toEqual({
      ok: false,
      error: 'Not a valid branch name.'
    })
    await realGit(['switch', '-qc', 'other'], dir)
    await writeFile(path.join(dir, 'a.txt'), 'other\n')
    await realGit(['commit', '-qam', 'other'], dir)
    await realGit(['switch', '-q', 'main'], dir)
    await writeFile(path.join(dir, 'a.txt'), 'uncommitted\n')
    const r = await switchBranch(realGit, dir, { kind: 'local', name: 'other' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/local changes/)
    expect((await gitStatus(realGit, dir)).branch).toBe('main')
  })

  it('removes only linked worktrees, and dirty ones only when forced', async () => {
    expect(await checkWorktree(realGit, dir)).toEqual({
      ok: false,
      error: 'Not a linked worktree.'
    })
    const r = await addWorktree(realGit, dir, 'feat/y', wt)
    if (!r.ok) throw new Error(r.error)
    expect(await checkWorktree(realGit, r.dir)).toEqual({
      ok: true,
      branch: 'feat/y',
      changed: 0,
      mainRoot: dir
    })
    await writeFile(path.join(r.dir, 'wip.txt'), 'w\n')
    const refused = await removeWorktree(realGit, r.dir, false)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toMatch(/^1 uncommitted files/)
    expect(await removeWorktree(realGit, r.dir, true)).toEqual({
      ok: true,
      detail: 'Kept branch feat/y'
    })
    expect((await realGit(['worktree', 'list'], dir)).split('\n').filter(Boolean)).toHaveLength(1)
    // The branch stays.
    expect((await realGit(['branch', '--list', 'feat/y'], dir)).trim()).toBe('feat/y')
  })
})

describe('parseBranches', () => {
  it('skips remote HEAD and remote branches checked out locally', () => {
    const out = [
      'refs/heads/main\x002 hours ago\x00origin/main',
      'refs/heads/fix\x003 days ago\x00',
      'refs/remotes/origin/HEAD\x002 hours ago\x00',
      'refs/remotes/origin/main\x002 hours ago\x00',
      'refs/remotes/origin/fix\x003 days ago\x00',
      'refs/remotes/origin/new\x001 hour ago\x00'
    ].join('\n')
    expect(parseBranches(out, 'main')).toEqual({
      current: 'main',
      local: [
        { name: 'main', when: '2 hours ago', upstream: 'origin/main' },
        { name: 'fix', when: '3 days ago', upstream: null }
      ],
      remote: [{ name: 'origin/new', when: '1 hour ago' }]
    })
  })
})

describe('pullRequestUrl', () => {
  it('builds GitHub and GitLab pages from https and ssh remotes', () => {
    expect(pullRequestUrl('git@github.com:acme/app.git', 'feat/x')).toBe(
      'https://github.com/acme/app/compare/feat%2Fx?expand=1'
    )
    expect(pullRequestUrl('https://github.com/acme/app', 'b')).toBe(
      'https://github.com/acme/app/compare/b?expand=1'
    )
    expect(pullRequestUrl('https://token@github.com/acme/app.git\n', 'b')).toBe(
      'https://github.com/acme/app/compare/b?expand=1'
    )
    expect(pullRequestUrl('ssh://git@gitlab.com/group/sub/app.git', 'b')).toBe(
      'https://gitlab.com/group/sub/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=b'
    )
    expect(pullRequestUrl('https://example.com/acme/app.git', 'b')).toBeNull()
    expect(pullRequestUrl('https://github.com.evil.io/acme/app', 'b')).toBeNull()
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

describe('pull and history (real git)', { timeout: REAL_GIT_TIMEOUT }, () => {
  let root: string
  const init = async (): Promise<{ dir: string; other: string }> => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wg-pull-')))
    const bare = path.join(root, 'remote.git')
    const dir = path.join(root, 'mine')
    const other = path.join(root, 'theirs')
    await realGit(['init', '-q', '--bare', '-b', 'main', bare], root)
    await realGit(['clone', '-q', bare, dir], root)
    await realGit(['checkout', '-q', '-b', 'main'], dir)
    await writeFile(path.join(dir, 'a.txt'), 'one\n')
    await commitAll(realGit, dir, 'first')
    await realGit(['push', '-q', '-u', 'origin', 'main'], dir)
    await realGit(['clone', '-q', bare, other], root)
    return { dir, other }
  }
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('says up to date, pulls new commits, and reports what git refuses', async () => {
    const { dir, other } = await init()
    expect(await pullBranch(realGit, dir)).toEqual({ ok: true, detail: 'Up to date' })

    for (const n of ['2', '3']) {
      await writeFile(path.join(other, 'a.txt'), `${n}\n`)
      await commitAll(realGit, other, `theirs ${n}`)
    }
    await realGit(['push', '-q'], other)
    expect(await pullBranch(realGit, dir)).toEqual({ ok: true, detail: 'Pulled 2 commits' })
    expect((await realGit(['log', '-1', '--format=%s'], dir)).trim()).toBe('theirs 3')

    // A local change in the way: git's own error, nothing pulled.
    await writeFile(path.join(other, 'a.txt'), '4\n')
    await commitAll(realGit, other, 'theirs 4')
    await realGit(['push', '-q'], other)
    await writeFile(path.join(dir, 'a.txt'), 'mine, not committed\n')
    const r = await pullBranch(realGit, dir)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/local changes|overwritten/)
    expect((await realGit(['log', '-1', '--format=%s'], dir)).trim()).toBe('theirs 3')
  })

  it('refuses without an upstream or on a detached HEAD', async () => {
    const { dir } = await init()
    await realGit(['checkout', '-q', '-b', 'solo'], dir)
    expect(await pullBranch(realGit, dir)).toEqual({
      ok: false,
      error: 'solo has no upstream branch to pull from. Push it first.'
    })
    await realGit(['checkout', '-q', '--detach'], dir)
    expect(await pullBranch(realGit, dir)).toMatchObject({ ok: false, error: /detached/ })
  })

  it('lists history with merges and refs, a page at a time, and shows a commit', async () => {
    const { dir } = await init()
    await realGit(['checkout', '-q', '-b', 'feat'], dir)
    await writeFile(path.join(dir, 'f.txt'), 'f\n')
    await commitAll(realGit, dir, 'feature')
    await realGit(['checkout', '-q', 'main'], dir)
    await writeFile(path.join(dir, 'm.txt'), 'm\n')
    await commitAll(realGit, dir, 'on main')
    await realGit(['merge', '-q', '--no-ff', '-m', 'Merge feat', 'feat'], dir)
    await realGit(['tag', 'v1'], dir)

    const log = await gitLog(realGit, dir, 0)
    expect(log.ok).toBe(true)
    if (!log.ok) return
    expect(log.more).toBe(false)
    expect(log.commits.map((c) => c.subject)).toEqual(['Merge feat', 'on main', 'feature', 'first'])
    expect(log.commits[0]!.parents).toHaveLength(2)
    expect(log.commits[0]!.refs).toEqual(expect.arrayContaining(['HEAD -> main', 'tag: v1']))
    expect((await gitLog(realGit, dir, 3)).ok && (await gitLog(realGit, dir, 3))).toMatchObject({
      commits: [{ subject: 'first' }]
    })

    const feature = log.commits.find((c) => c.subject === 'feature')!
    const shown = await gitShow(realGit, dir, feature.sha)
    expect(shown.ok && parsePatch(shown.patch).map((f) => f.path)).toEqual(['f.txt'])
    expect(await gitShow(realGit, dir, '--all')).toEqual({ ok: false, error: 'Not a commit id.' })
  })
})
