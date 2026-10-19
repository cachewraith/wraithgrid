// Where the pty host listens and keeps its token. One host per user-data dir, so a test run
// (WRAITHGRID_USER_DATA_DIR) never meets the user's real agents (ADR 0001, review §2).
import { createHash } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface HostPaths {
  /** Holds the socket, token, lock and log (POSIX); the token, lock and log on Windows. */
  dir: string
  /** Unix socket path, or a named pipe on Windows. */
  socket: string
  token: string
  lock: string
  log: string
}

export interface HostPathInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  userData: string
  tmpDir: string
  /** POSIX uid; -1 on Windows. */
  uid: number
  userName: string
}

const shortHash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12)

export function hostPaths(i: HostPathInput): HostPaths {
  if (i.platform === 'win32') {
    const p = path.win32
    const dir = p.join(i.userData, 'run')
    return {
      dir,
      socket: `\\\\.\\pipe\\wraithgrid-host-${shortHash(`${i.userName}\0${i.userData}`)}`,
      token: p.join(dir, 'host.token'),
      lock: p.join(dir, 'host.lock'),
      log: p.join(dir, 'host.log')
    }
  }
  const p = path.posix
  // XDG_RUNTIME_DIR is per-user and 0700 already; os.tmpdir() is per-user on macOS. The name
  // stays short: Unix socket paths are limited to 104 bytes on macOS.
  const base = i.env.XDG_RUNTIME_DIR?.startsWith('/') ? i.env.XDG_RUNTIME_DIR : i.tmpDir
  const dir = p.join(base, `wraithgrid-${i.uid}-${shortHash(i.userData)}`)
  return {
    dir,
    socket: p.join(dir, 'host.sock'),
    token: p.join(dir, 'host.token'),
    lock: p.join(dir, 'host.lock'),
    log: p.join(dir, 'host.log')
  }
}

/**
 * Creates the host dir user-only. A dir that already exists must be ours, a real directory
 * and closed to group/other: in a shared /tmp another user could have made it first.
 */
export async function ensureHostDir(
  dir: string,
  platform: NodeJS.Platform,
  uid: number
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  if (platform === 'win32') return
  const st = await lstat(dir)
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`)
  if (st.uid !== uid) throw new Error(`${dir} belongs to another user`)
  if ((st.mode & 0o077) !== 0) throw new Error(`${dir} is open to other users`)
}
