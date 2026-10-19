// Entry of the background pty host (ADR 0001): started by the GUI with its own Electron
// binary as plain Node (ELECTRON_RUN_AS_NODE), detached, so panes outlive the window.
// Never import `electron` here. Settings arrive as JSON in WRAITHGRID_HOST.
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { chmod } from 'node:fs/promises'
import net from 'node:net'
import { spawn } from 'node-pty'
import { closeMaskedFds } from './fds'
import { ensureHostDir, type HostPaths } from './paths'
import { HostServer } from './server'

interface HostSettings {
  paths: HostPaths
  appVersion: string
  /** fds 3..maskedFds are /dev/null copies standing in for the GUI's own (fds.ts). */
  maskedFds?: number
}

const settings = JSON.parse(process.env.WRAITHGRID_HOST ?? 'null') as HostSettings | null
// Pane envs are built by the GUI; nothing of the host's own launch leaks into them anyway.
delete process.env.WRAITHGRID_HOST
delete process.env.ELECTRON_RUN_AS_NODE
process.title = 'wraithgrid-host'

const log = (msg: string): void => console.error(`[${new Date().toISOString()}] ${msg}`)

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** One host per socket: an exclusive lock file with our pid; a dead owner's lock is taken over. */
function takeLock(file: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      writeFileSync(fd, String(process.pid))
      closeSync(fd)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const owner = Number(readFileSync(file, 'utf8').trim())
      if (owner && owner !== process.pid && alive(owner)) return false
      unlinkSync(file)
    }
  }
  return false
}

const quietUnlink = (file: string): void => {
  try {
    unlinkSync(file)
  } catch {
    // Already gone.
  }
}

async function main(s: HostSettings): Promise<void> {
  const { paths } = s
  const posix = process.platform !== 'win32'
  if (posix && s.maskedFds) closeMaskedFds(s.maskedFds)
  await ensureHostDir(paths.dir, process.platform, process.getuid?.() ?? -1)
  if (!takeLock(paths.lock)) {
    log('another host owns this socket; exiting')
    process.exit(0)
  }
  // The lock is ours, so any socket file left is from a host that died.
  if (posix) quietUnlink(paths.socket)

  const token = randomBytes(32).toString('hex')
  const tmp = `${paths.token}.${process.pid}`
  writeFileSync(tmp, token, { mode: 0o600 })
  renameSync(tmp, paths.token)

  let exiting = false
  const exit = (code: number): void => {
    if (exiting) return
    exiting = true
    server.close()
    if (posix) quietUnlink(paths.socket)
    quietUnlink(paths.token)
    quietUnlink(paths.lock)
    log(`host exiting (${code})`)
    // A clean exit leaves nothing behind; after a failure the log stays for a bug report.
    if (code === 0) {
      quietUnlink(paths.log)
      try {
        rmdirSync(paths.dir)
      } catch {
        // Not empty, or already gone.
      }
    }
    process.exit(code)
  }

  const host = new HostServer({
    spawn,
    token,
    appVersion: s.appVersion,
    pid: process.pid,
    onIdle: () => exit(0),
    onShutdown: () => exit(0),
    log
  })
  const server = net.createServer((sock) => host.accept(sock))
  server.on('error', (err) => {
    log(`listen failed: ${err.message}`)
    exit(1)
  })
  server.listen(paths.socket, () => {
    if (posix) void chmod(paths.socket, 0o600).catch(() => {})
    log(`host ${process.pid} listening (app ${s.appVersion})`)
  })

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void host.stopAll().finally(() => exit(0)))
  }
  // Detached from any terminal; a hang-up is not ours to act on.
  process.on('SIGHUP', () => {})
  process.on('uncaughtException', (err) => log(`uncaught: ${err.stack ?? err.message}`))
}

if (!settings) {
  console.error('wraithgrid-host: started without settings')
  process.exit(2)
}
main(settings).catch((err: Error) => {
  log(`host failed: ${err.stack ?? err.message}`)
  process.exit(1)
})
