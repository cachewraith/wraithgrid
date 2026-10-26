// Starts the background pty host (ADR 0001) detached, with this same binary running as plain
// Node. Used by the window and by `wraithgrid host-stdio` on a remote machine (H5), so it
// must not import `electron`.
import { spawn } from 'node:child_process'
import { closeSync, openSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import path from 'node:path'
import { highestOpenFd, stdioMasking } from '../host/fds'
import { ensureHostDir, type HostPaths } from '../host/paths'

export interface HostStart {
  paths: HostPaths
  appVersion: string
  /** The app's binary (Electron); it runs `host.js` with ELECTRON_RUN_AS_NODE. */
  execPath: string
  /** Folder holding the built `host.js`. */
  outDir: string
  /** The Rust host binary to start instead (ADR 0004 phase 2); same settings and socket. */
  rustBin?: string | null
  cwd: string
  env: NodeJS.ProcessEnv
  uid: number
}

export async function startHostProcess(s: HostStart): Promise<void> {
  await ensureHostDir(s.paths.dir, process.platform, s.uid)
  let size = 0
  try {
    size = statSync(s.paths.log).size
  } catch {
    // No log yet.
  }
  const out = openSync(s.paths.log, size > 1024 * 1024 ? 'w' : 'a', 0o600)
  const posix = process.platform !== 'win32'
  const nullFd = posix ? openSync('/dev/null', 'r') : -1
  // Every fd this process has open would leak into the long-lived host: mask them (fds.ts).
  const maskUpTo = posix ? highestOpenFd(process.platform) : 2
  try {
    const [file, args] = s.rustBin
      ? [s.rustBin, []]
      : [s.execPath, [path.join(s.outDir, 'host.js')]]
    const child = spawn(file, args, {
      detached: true,
      stdio: posix ? stdioMasking(out, nullFd, maskUpTo) : ['ignore', out, out],
      windowsHide: true,
      cwd: s.cwd,
      env: {
        ...s.env,
        ...(s.rustBin ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
        WRAITHGRID_HOST: JSON.stringify({
          paths: s.paths,
          appVersion: s.appVersion,
          maskedFds: maskUpTo
        })
      }
    })
    // A spawn that fails later (ENOENT, EACCES on the Rust binary) must not throw in main: the
    // connect that follows finds no host and says it did not start (#140).
    child.once('error', (err) => console.warn(`[wraithgrid] host spawn failed: ${err.message}`))
    child.unref()
  } finally {
    closeSync(out)
    if (nullFd >= 0) closeSync(nullFd)
  }
}

/** Connects to the host socket; rejects when nothing listens. */
export const connectSocket = (socket: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const sock = createConnection(socket)
    sock.once('connect', () => {
      sock.off('error', reject)
      resolve(sock)
    })
    sock.once('error', reject)
  })
