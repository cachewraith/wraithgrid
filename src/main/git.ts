// Git facts for a pane's folder (branch, changed files, diff, branches) and the few writes the
// user asks for: a worktree for a new pane (and removing it), switching branch, commit, push,
// pull and a pull-request link; and the commit history (a page at a time) with each commit's diff.
// git runs through an injected runner (execFile, never a shell), so parsing and argument
// building stay unit-testable.
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  GitActionResult,
  GitBranches,
  GitCommit,
  GitDiffResult,
  GitLogResult,
  GitShowResult,
  GitStatus,
  GitWorktreeCheck,
  GitWorktreeResult
} from '@shared/ipc-contract'

/** `slow`: a commit (hooks) or push (network) may take minutes, not the polling timeout. */
export type GitRunner = (args: string[], cwd: string, opts?: { slow?: boolean }) => Promise<string>

export const COMMIT_MESSAGE_MAX = 5000

/** A diff bigger than this is cut, so one huge generated file can't stall the renderer. */
export const DIFF_MAX_BYTES = 1_000_000

/** Branch names we create: git's own rules are checked too, this keeps them simple and safe. */
export const BRANCH_PATTERN =
  /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}(?<![./])$/

/** Parses `git status --porcelain=1 --branch` output. */
export function parseStatus(out: string): Omit<GitStatus, 'repo'> {
  const lines = out.split('\n').filter(Boolean)
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  if (head) {
    if (head.startsWith('No commits yet on ')) branch = head.slice('No commits yet on '.length)
    else if (head.startsWith('HEAD (no branch)')) branch = null
    else branch = head.split('...')[0]!.split(' ')[0]!
    ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
    behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  }
  return { branch, ahead, behind, changed: lines.length }
}

/** The output git gave before it outran the runner's buffer, or null for any other failure. */
function overflowed(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown; stdout?: unknown }
  const over =
    e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/.test(String(e?.message))
  return over && typeof e.stdout === 'string' ? e.stdout : null
}

export async function gitStatus(run: GitRunner, cwd: string): Promise<GitStatus> {
  try {
    const out = await run(['status', '--porcelain=1', '--branch', '--untracked-files=normal'], cwd)
    return { repo: true, ...parseStatus(out) }
  } catch (err) {
    // Too many changed files to list is still a repo: count what was listed (#140).
    const part = overflowed(err)
    if (part !== null)
      return { repo: true, ...parseStatus(part.slice(0, part.lastIndexOf('\n') + 1)) }
    return { repo: false, branch: null, ahead: 0, behind: 0, changed: 0 }
  }
}

export async function gitDiff(run: GitRunner, cwd: string): Promise<GitDiffResult> {
  let patch: string
  let over = false
  try {
    patch = await run(['diff', 'HEAD', '--no-color', '--no-ext-diff'], cwd)
  } catch (err) {
    const part = overflowed(err)
    if (part !== null) {
      // Bigger than the buffer: what came first, marked cut (#140), not the unstaged-only diff.
      patch = part
      over = true
    } else {
      // No commits yet: there is no HEAD to compare against.
      try {
        patch = await run(['diff', '--no-color', '--no-ext-diff'], cwd)
      } catch (err2) {
        const part2 = overflowed(err2)
        if (part2 === null) return { ok: false, error: firstLine(err2) }
        patch = part2
        over = true
      }
    }
  }
  let untracked: string[] = []
  try {
    untracked = (await run(['ls-files', '--others', '--exclude-standard'], cwd))
      .split('\n')
      .filter(Boolean)
      .slice(0, 500)
  } catch {
    // Listing untracked files is a nicety; the diff still stands.
  }
  const truncated = over || patch.length > DIFF_MAX_BYTES
  return {
    ok: true,
    patch: truncated ? patch.slice(0, DIFF_MAX_BYTES) : patch,
    truncated,
    untracked
  }
}

/** `~/.wraithgrid/worktrees/<repo>/<branch>`, outside the repo so it never shows as untracked. */
export function worktreeDir(worktreesRoot: string, repoRoot: string, branch: string): string {
  return path.join(worktreesRoot, path.basename(repoRoot), branch.replace(/\//g, '-'))
}

export async function addWorktree(
  run: GitRunner,
  cwd: string,
  branch: string,
  worktreesRoot: string,
  /** Use the folder if it is there, or check out the branch if only it exists (team, #79). */
  reuse = false
): Promise<GitWorktreeResult> {
  if (!BRANCH_PATTERN.test(branch)) return { ok: false, error: 'Not a valid branch name.' }
  let root: string
  try {
    root = (await run(['rev-parse', '--show-toplevel'], cwd)).trim()
    await run(['check-ref-format', '--branch', branch], cwd)
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
  const dir = worktreeDir(worktreesRoot, root, branch)
  if (reuse && existsSync(path.join(dir, '.git'))) return { ok: true, dir }
  try {
    await run(['worktree', 'add', '-b', branch, dir], root)
  } catch (err) {
    if (!reuse) return { ok: false, error: firstLine(err) }
    try {
      await run(['worktree', 'add', dir, branch], root)
    } catch {
      return { ok: false, error: firstLine(err) }
    }
  }
  return { ok: true, dir }
}

/** Stages everything in the pane's folder and commits it with the user's message. */
export async function commitAll(
  run: GitRunner,
  cwd: string,
  message: string
): Promise<GitActionResult> {
  const msg = message.trim()
  if (!msg) return { ok: false, error: 'Write a commit message first.' }
  if (msg.length > COMMIT_MESSAGE_MAX) return { ok: false, error: 'The message is too long.' }
  try {
    await run(['add', '-A'], cwd)
    await run(['commit', '-m', msg], cwd, { slow: true })
    const hash = (await run(['rev-parse', '--short', 'HEAD'], cwd)).trim()
    return { ok: true, detail: `Committed ${hash}` }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

const BRANCH_REF_FORMAT = '%(refname)%00%(committerdate:relative)%00%(upstream:short)'

/** Parses `git for-each-ref` over refs/heads and refs/remotes (newest commit first). */
export function parseBranches(out: string, current: string | null): GitBranches {
  const local: GitBranches['local'] = []
  const remoteRefs: { name: string; when: string }[] = []
  for (const line of out.split('\n')) {
    const [ref, when = '', upstream = ''] = line.split('\0')
    if (!ref) continue
    if (ref.startsWith('refs/heads/')) {
      local.push({ name: ref.slice('refs/heads/'.length), when, upstream: upstream || null })
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      remoteRefs.push({ name: ref.slice('refs/remotes/'.length), when })
    }
  }
  // A remote branch someone already has locally (as its upstream or by name) is not offered twice.
  const covered = new Set(local.flatMap((b) => [b.upstream, b.name]))
  const remote = remoteRefs.filter(
    (r) => !covered.has(r.name) && !covered.has(r.name.replace(/^[^/]+\//, ''))
  )
  return { current, local, remote }
}

export async function listBranches(
  run: GitRunner,
  cwd: string
): Promise<({ ok: true } & GitBranches) | { ok: false; error: string }> {
  try {
    const out = await run(
      [
        'for-each-ref',
        '--sort=-committerdate',
        `--format=${BRANCH_REF_FORMAT}`,
        'refs/heads',
        'refs/remotes'
      ],
      cwd
    )
    return { ok: true, ...parseBranches(out, await currentBranch(run, cwd)) }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/**
 * Checks out a local branch, a remote one (as a new local branch tracking it) or a new branch
 * from HEAD. A name must be one git listed (or, for a new one, a valid name), so nothing from
 * the renderer reaches git as an option. Uncommitted changes go along; git refuses when they
 * would be overwritten, and says which files.
 */
export async function switchBranch(
  run: GitRunner,
  cwd: string,
  to: { kind: 'local' | 'remote' | 'create'; name: string }
): Promise<GitActionResult> {
  if (to.kind === 'create') {
    if (!BRANCH_PATTERN.test(to.name)) return { ok: false, error: 'Not a valid branch name.' }
  } else {
    const list = await listBranches(run, cwd)
    if (!list.ok) return list
    const known =
      to.kind === 'local' ? list.local.map((b) => b.name) : list.remote.map((b) => b.name)
    if (!known.includes(to.name) || to.name.startsWith('-'))
      return { ok: false, error: `No branch ${to.name} here any more.` }
    if (to.kind === 'local' && to.name === list.current)
      return { ok: true, detail: `Already on ${to.name}` }
  }
  const args =
    to.kind === 'create'
      ? ['switch', '-c', to.name]
      : to.kind === 'remote'
        ? ['switch', '--track', to.name]
        : ['switch', to.name]
  try {
    if (to.kind === 'create') await run(['check-ref-format', '--branch', to.name], cwd)
    // Slow: post-checkout hooks and big trees take longer than the status poll's timeout.
    await run(args, cwd, { slow: true })
    return { ok: true, detail: `Switched to ${(await currentBranch(run, cwd)) ?? to.name}` }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/** The branch checked out in `cwd`, or null on a detached HEAD. */
async function currentBranch(run: GitRunner, cwd: string): Promise<string | null> {
  const b = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
  return b && b !== 'HEAD' ? b : null
}

/** `origin` when there is one, else the first remote. */
async function pickRemote(run: GitRunner, cwd: string): Promise<string | null> {
  const remotes = (await run(['remote'], cwd))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
}

/** Pushes the current branch, setting its upstream on the first push. */
export async function pushBranch(run: GitRunner, cwd: string): Promise<GitActionResult> {
  try {
    const branch = await currentBranch(run, cwd)
    if (!branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }
    let hasUpstream = true
    try {
      await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
    } catch {
      hasUpstream = false
    }
    if (hasUpstream) {
      await run(['push'], cwd, { slow: true })
      return { ok: true, detail: `Pushed ${branch}` }
    }
    const remote = await pickRemote(run, cwd)
    if (!remote) return { ok: false, error: 'This repository has no remote to push to.' }
    await run(['push', '--set-upstream', remote, branch], cwd, { slow: true })
    return { ok: true, detail: `Pushed ${branch} to ${remote}` }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/** `behind ahead` of HEAD against its upstream, after `git rev-list --left-right --count`. */
async function aheadBehind(
  run: GitRunner,
  cwd: string
): Promise<{ ahead: number; behind: number }> {
  const [behind, ahead] = (await run(['rev-list', '--left-right', '--count', '@{u}...HEAD'], cwd))
    .trim()
    .split(/\s+/)
    .map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}

const n = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`

/**
 * Pulls the current branch from its upstream (git's own pull settings: merge or rebase),
 * never forced. Says what happened: up to date, how many commits came in, or git's error
 * (conflicts, local changes in the way, diverged branches).
 */
export async function pullBranch(run: GitRunner, cwd: string): Promise<GitActionResult> {
  try {
    const branch = await currentBranch(run, cwd)
    if (!branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }
    try {
      await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
    } catch {
      return { ok: false, error: `${branch} has no upstream branch to pull from. Push it first.` }
    }
    await run(['fetch', '--quiet'], cwd, { slow: true })
    const before = await aheadBehind(run, cwd)
    if (before.behind === 0) {
      return {
        ok: true,
        detail: before.ahead ? `Up to date · ${n(before.ahead, 'commit')} to push` : 'Up to date'
      }
    }
    await run(['pull', '--no-edit'], cwd, { slow: true })
    const after = await aheadBehind(run, cwd)
    return {
      ok: true,
      detail: `Pulled ${n(before.behind, 'commit')}${after.ahead ? ` · ${n(after.ahead, 'commit')} to push` : ''}`
    }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

// ---- History ------------------------------------------------------------------------

/** Commits per page of the history graph. */
export const LOG_PAGE = 100
const SHA = /^[0-9a-f]{7,40}$/
const LOG_FORMAT = ['%H', '%P', '%an', '%ct', '%D', '%s'].join('%x1f') + '%x1e'

/** Parses `git log --format=LOG_FORMAT` output. */
export function parseLog(out: string): GitCommit[] {
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .flatMap((r): GitCommit[] => {
      const [sha, parents, author, time, refs, subject] = r.split('\x1f')
      if (!sha || !SHA.test(sha)) return []
      return [
        {
          sha,
          parents: (parents ?? '').split(' ').filter((p) => SHA.test(p)),
          author: author ?? '',
          time: Number(time) * 1000 || 0,
          refs: (refs ?? '')
            .split(', ')
            .map((x) => x.trim())
            .filter((x) => x && x !== 'HEAD'),
          subject: (subject ?? '').slice(0, 300)
        }
      ]
    })
}

/** A page of history for every branch and tag, newest first (topological within a date). */
export async function gitLog(run: GitRunner, cwd: string, skip: number): Promise<GitLogResult> {
  try {
    const out = await run(
      [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        'HEAD',
        '--date-order',
        `--max-count=${LOG_PAGE + 1}`,
        `--skip=${skip}`,
        `--format=${LOG_FORMAT}`,
        '--no-color'
      ],
      cwd
    )
    const commits = parseLog(out)
    return { ok: true, commits: commits.slice(0, LOG_PAGE), more: commits.length > LOG_PAGE }
  } catch (err) {
    const msg = firstLine(err)
    // A repository with no commits has no history, which is not an error.
    if (/does not have any commits|bad default revision|unknown revision/.test(msg))
      return { ok: true, commits: [], more: false }
    return { ok: false, error: msg }
  }
}

/** One commit's changes as a patch (cut like the working-tree diff). */
export async function gitShow(run: GitRunner, cwd: string, sha: string): Promise<GitShowResult> {
  if (!SHA.test(sha)) return { ok: false, error: 'Not a commit id.' }
  try {
    const patch = await run(
      ['show', '--format=', '--no-color', '--no-ext-diff', '--first-parent', '-m', sha, '--'],
      cwd
    )
    const truncated = patch.length > DIFF_MAX_BYTES
    return { ok: true, patch: truncated ? patch.slice(0, DIFF_MAX_BYTES) : patch, truncated }
  } catch (err) {
    const msg = firstLine(err)
    return { ok: false, error: /maxBuffer/.test(msg) ? 'This commit is too large to show.' : msg }
  }
}

/**
 * The web page that opens a pull request (GitHub) or merge request (GitLab) for `branch`,
 * from a remote URL in https or scp-like ssh form; null for other hosts.
 */
export function pullRequestUrl(remoteUrl: string, branch: string): string | null {
  const m =
    /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)(github\.com|gitlab\.com)[:/]([\w.-]+(?:\/[\w.-]+)+)\/?$/.exec(
      remoteUrl.trim()
    )
  if (!m) return null
  const host = m[1]
  const repo = m[2]!.replace(/\.git$/, '')
  const b = encodeURIComponent(branch)
  return host === 'github.com'
    ? `https://github.com/${repo}/compare/${b}?expand=1`
    : `https://gitlab.com/${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}`
}

/** The pull-request page for the pane's branch on its remote. */
export async function pullRequestLink(
  run: GitRunner,
  cwd: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const branch = await currentBranch(run, cwd)
    if (!branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }
    const remote = await pickRemote(run, cwd)
    if (!remote) return { ok: false, error: 'This repository has no remote.' }
    const url = pullRequestUrl(await run(['remote', 'get-url', remote], cwd), branch)
    if (!url) return { ok: false, error: 'Pull requests open for GitHub and GitLab remotes only.' }
    return { ok: true, url }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/**
 * Whether `dir` is a linked worktree (not a repo's main checkout), its branch and how many
 * files in it are uncommitted, so the user can decide before it is removed.
 */
export async function checkWorktree(run: GitRunner, dir: string): Promise<GitWorktreeCheck> {
  try {
    const [gitDir, commonDir] = (
      await run(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], dir)
    )
      .split('\n')
      .map((l) => l.trim())
    if (!gitDir || !commonDir || path.resolve(gitDir) === path.resolve(commonDir))
      return { ok: false, error: 'Not a linked worktree.' }
    const st = parseStatus(
      await run(['status', '--porcelain=1', '--branch', '--untracked-files=normal'], dir)
    )
    // git prints `C:/…` on Windows; resolve gives the platform's own separators.
    const mainRoot = path.dirname(path.resolve(commonDir))
    return { ok: true, branch: st.branch, changed: st.changed, mainRoot }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/**
 * Removes a linked worktree's folder; its branch and commits stay in the repo. Uncommitted
 * files are only thrown away with `force`. Runs from the main checkout: git won't remove
 * the worktree it is running in.
 */
export async function removeWorktree(
  run: GitRunner,
  dir: string,
  force: boolean
): Promise<GitActionResult> {
  const check = await checkWorktree(run, dir)
  if (!check.ok) return check
  if (check.changed && !force)
    return { ok: false, error: `${check.changed} uncommitted files; remove anyway to lose them.` }
  try {
    await run(['worktree', 'remove', ...(force ? ['--force'] : []), dir], check.mainRoot)
    return { ok: true, detail: check.branch ? `Kept branch ${check.branch}` : 'Removed' }
  } catch (err) {
    return { ok: false, error: firstLine(err) }
  }
}

/** git's own error line (it may print progress lines first), without the "fatal: " prefix. */
function firstLine(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  const lines = (e.stderr || e.message || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const line = lines.find((l) => /^(fatal|error): /.test(l)) ?? lines[0] ?? 'git failed'
  return line.replace(/^(fatal|error): /, '').slice(0, 300)
}
