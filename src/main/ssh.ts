// Reaching a remote machine's Wraithgrid (H5): the system `ssh` runs `wraithgrid host-stdio`
// there and its stdin/stdout carry the host protocol. Keys or an agent only (BatchMode): the
// window cannot answer a password prompt.
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'

/** Host names from ~/.ssh/config, without patterns (`*`, `?`, `!`). */
export function sshConfigHosts(text: string): string[] {
  const hosts = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^host\s+(.+)$/i.exec(line)
    if (!m) continue
    for (const name of m[1]!.split(/\s+/)) {
      if (name && !/[*?!]/.test(name) && !name.startsWith('-')) hosts.add(name)
    }
  }
  return [...hosts]
}

/** `--` ends ssh's options, so a host can never be read as one (the schema refuses `-` too). */
export const sshArgs = (sshHost: string): string[] => [
  '-T',
  '-o',
  'BatchMode=yes',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
  '--',
  sshHost,
  'wraithgrid',
  'host-stdio'
]

export interface SshLink {
  stream: Duplex
  /** The end of what ssh printed on stderr: why it failed, if it did. */
  stderr: () => string
}

/** Starts `program` (ssh, or a stand-in in tests) and joins its stdio into one stream. */
export function openSshLink(program: string, args: string[]): Promise<SshLink> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let tail = ''
    child.stderr.on('data', (d: Buffer) => (tail = (tail + d.toString()).slice(-600)))
    child.once('error', reject)
    child.once('spawn', () => {
      const stream = Duplex.from({ readable: child.stdout, writable: child.stdin })
      // Closing our side ends ssh too.
      stream.once('close', () => child.kill())
      child.once('close', () => stream.destroy())
      resolve({ stream, stderr: () => tail.trim().split('\n').pop() ?? '' })
    })
  })
}
