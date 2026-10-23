// Moving a chat to another account (#29). claude keeps a conversation inside the signed-in
// account's own config dir (`projects/<encoded folder>/<session id>.jsonl`), so another
// account can only resume it once the file is in its dir too: this copies it (the original
// stays with the first account), and the chat then restarts as the other account with
// `--resume <id>`. Checked with claude 2.1.306: a copied transcript resumes and carries on.
// Only between Wraithgrid's own account dirs; session ids are plain tokens.
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chatSessionIdSchema } from '@shared/chat'
import { isStrictlyInside } from '../paths'

export type CopyResult = { ok: true } | { ok: false; error: string }

const isFile = (p: string): Promise<boolean> =>
  fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false)
const isDir = (p: string): Promise<boolean> =>
  fs
    .stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false)

/**
 * Copies session `sessionId` from `fromDir` to the same project folder in `toDir`
 * (overwriting an older copy from an earlier switch). Both dirs must be inside `root`.
 */
export async function copyTranscript(
  fromDir: string,
  toDir: string,
  sessionId: string,
  root: string
): Promise<CopyResult> {
  if (!chatSessionIdSchema.safeParse(sessionId).success)
    return { ok: false, error: 'Not a conversation id.' }
  if (!isStrictlyInside(fromDir, root) || !isStrictlyInside(toDir, root))
    return { ok: false, error: 'Only accounts in Wraithgrid’s own folder can be switched.' }
  if (path.resolve(fromDir) === path.resolve(toDir))
    return { ok: false, error: 'This chat already runs as that account.' }

  // The folder name is claude's encoding of the working directory: find it rather than
  // re-derive it, so a change in claude's encoding can't send the copy elsewhere.
  const projects = path.join(fromDir, 'projects')
  let found: string | null = null
  try {
    for (const d of await fs.readdir(projects, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const file = path.join(projects, d.name, `${sessionId}.jsonl`)
      if (await isFile(file)) {
        found = d.name
        break
      }
    }
  } catch {
    // No projects folder: nothing to copy.
  }
  if (!found) return { ok: false, error: 'This conversation’s file was not found.' }

  const src = path.join(projects, found)
  const dst = path.join(toDir, 'projects', found)
  try {
    await fs.mkdir(dst, { recursive: true })
    await fs.copyFile(path.join(src, `${sessionId}.jsonl`), path.join(dst, `${sessionId}.jsonl`))
    // Subagent transcripts and tool results, when claude keeps any for this session.
    const extra = path.join(src, sessionId)
    if (await isDir(extra)) {
      await fs.cp(extra, path.join(dst, sessionId), { recursive: true, force: true })
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Could not copy the conversation: ${(err as Error).message}` }
  }
}

/**
 * codex (#60): a thread is `sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl` in the
 * account's CODEX_HOME. Copied to the same place in `toDir`, `thread/resume` finds it there
 * (checked with codex-cli 0.164.0; its sqlite index isn't needed). Both dirs inside `root`.
 */
export async function copyCodexRollout(
  fromDir: string,
  toDir: string,
  threadId: string,
  root: string
): Promise<CopyResult> {
  if (!chatSessionIdSchema.safeParse(threadId).success)
    return { ok: false, error: 'Not a conversation id.' }
  if (!isStrictlyInside(fromDir, root) || !isStrictlyInside(toDir, root))
    return { ok: false, error: 'Only accounts in Wraithgrid’s own folder can be switched.' }
  if (path.resolve(fromDir) === path.resolve(toDir))
    return { ok: false, error: 'This chat already runs as that account.' }

  // Three folder levels (year, month, day), then the file; found, not derived from a date.
  const sessions = path.join(fromDir, 'sessions')
  const find = async (dir: string, depth: number): Promise<string | null> => {
    let list: Dirent[]
    try {
      list = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const d of list) {
      const p = path.join(dir, d.name)
      if (depth < 3 && d.isDirectory() && /^\d{1,4}$/.test(d.name)) {
        const hit = await find(p, depth + 1)
        if (hit) return hit
      } else if (
        depth === 3 &&
        d.isFile() &&
        d.name.startsWith('rollout-') &&
        d.name.endsWith(`-${threadId}.jsonl`)
      )
        return p
    }
    return null
  }
  const found = await find(sessions, 0)
  if (!found) return { ok: false, error: 'This conversation’s file was not found.' }
  const dst = path.join(toDir, 'sessions', path.relative(sessions, found))
  try {
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.copyFile(found, dst)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Could not copy the conversation: ${(err as Error).message}` }
  }
}
