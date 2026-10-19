// Git facts for a pane's folder (branch, changed files, diff) and the few writes the user asks
// for: a worktree for a new pane (and removing it), commit, push and a pull-request link.
// git runs through an injected runner (execFile, never a shell), so parsing and argument
// building stay unit-testable.
import path from 'node:path'
import type {
  GitActionResult,
  GitDiffResult,
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

export async function gitStatus(run: GitRunner, cwd: string): Promise<GitStatus> {
  try {
    const out = await run(['status', '--porcelain=1', '--branch', '--untracked-files=normal'], cwd)
    return { repo: true, ...parseStatus(out) }
  } catch {
    return { repo: false, branch: null, ahead: 0, behind: 0, changed: 0 }
  }
}

export async function gitDiff(run: GitRunner, cwd: string): Promise<GitDiffResult> {
  let patch: string
  try {
    patch = await run(['diff', 'HEAD', '--no-color', '--no-ext-diff'], cwd)
  } catch {
    // No commits yet: there is no HEAD to compare against.
    try {
      patch = await run(['diff', '--no-color', '--no-ext-diff'], cwd)
    } catch (err) {
      return { ok: false, error: firstLine(err) }
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
  const truncated = patch.length > DIFF_MAX_BYTES
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
  worktreesRoot: string
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
  try {
    await run(['worktree', 'add', '-b', branch, dir], root)
  } catch (err) {
    return { ok: false, error: firstLine(err) }
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
