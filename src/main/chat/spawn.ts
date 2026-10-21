// Starts a chat pane's CLI from main with plain pipes. Chromium's fds lack close-on-exec,
// so every one past stdio is masked with /dev/null (as for the pty host, fds.ts); on POSIX
// the CLI leads its own process group, so a stop also ends the tools it started.
import { execFile, spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { highestOpenFd } from '../../host/fds'
import type { ChatChild, ChatLaunch } from './sessions'

export function spawnChatChild(launch: ChatLaunch): ChatChild {
  const posix = process.platform !== 'win32'
  const nullFd = posix ? openSync('/dev/null', 'r') : -1
  try {
    const upTo = posix ? highestOpenFd(process.platform) : 2
    const verbatim = typeof launch.args === 'string'
    const args = typeof launch.args === 'string' ? [launch.args] : launch.args
    const stdio: StdioOptions = [
      'pipe',
      'pipe',
      'pipe',
      ...Array.from({ length: Math.max(0, upTo - 2) }, () => nullFd)
    ]
    const child: ChildProcess = spawn(launch.file, args, {
      windowsVerbatimArguments: verbatim,
      cwd: launch.cwd,
      env: launch.env,
      stdio,
      detached: posix,
      windowsHide: true
    })
    const kill = (signal: NodeJS.Signals = 'SIGTERM'): boolean => {
      if (!child.pid) return false
      if (posix) {
        try {
          process.kill(-child.pid, signal)
          return true
        } catch {
          // The group is gone; try the leader alone.
        }
      }
      return child.kill(signal)
    }
    return {
      get pid() {
        return child.pid
      },
      stdin: child.stdin!,
      stdout: child.stdout!,
      stderr: child.stderr!,
      kill,
      once: (event: 'exit' | 'error', cb: (...a: never[]) => void) =>
        child.once(event, cb as (...a: unknown[]) => void)
    } as ChatChild
  } finally {
    if (nullFd >= 0) closeSync(nullFd)
  }
}

/** Windows: a `.cmd` CLI runs under cmd.exe, so the whole tree is ended. */
export function forceKillTree(pid: number): void {
  if (process.platform === 'win32')
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
}
