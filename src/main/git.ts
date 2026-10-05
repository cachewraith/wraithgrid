// Read-only git facts for a pane's folder (branch, changed files, diff) and one write:
// adding a worktree so a new pane works on its own branch. git runs through an injected
// runner (execFile, never a shell), so parsing and argument building stay unit-testable.
import path from 'node:path'
import type { GitDiffResult, GitStatus, GitWorktreeResult } from '@shared/ipc-contract'

export type GitRunner = (args: string[], cwd: string) => Promise<string>

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
