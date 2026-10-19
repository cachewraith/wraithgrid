// Chromium leaves many of its file descriptors without close-on-exec (GPU device, IPC
// sockets, cache files, a test runner's pipes), and a spawned child inherits them all. The
// host outlives the GUI, so it must not hold them: the GUI maps each one to /dev/null in the
// child's stdio, and the host closes those copies once it runs.
import { closeSync, fstatSync, readdirSync, statSync } from 'node:fs'

/** The highest fd open in this process (POSIX), or 2 when it cannot be listed. */
export function highestOpenFd(platform: NodeJS.Platform): number {
  if (platform === 'win32') return 2
  try {
    const dir = platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
    return Math.max(2, ...readdirSync(dir).map(Number).filter(Number.isInteger))
  } catch {
    return 2
  }
}

/** Child stdio that replaces fds 3..upTo with `nullFd`, so nothing else is inherited. */
export function stdioMasking(out: number, nullFd: number, upTo: number): (number | 'ignore')[] {
  return ['ignore', out, out, ...Array.from({ length: Math.max(0, upTo - 2) }, () => nullFd)]
}

/** In the host: closes fds 3..upTo that are /dev/null, the masks set up by the GUI. */
export function closeMaskedFds(upTo: number): void {
  let nullDev: number
  try {
    nullDev = statSync('/dev/null').rdev
  } catch {
    return
  }
  for (let fd = 3; fd <= upTo; fd++) {
    try {
      const st = fstatSync(fd)
      if (st.isCharacterDevice() && st.rdev === nullDev) closeSync(fd)
    } catch {
      // Not open.
    }
  }
}
