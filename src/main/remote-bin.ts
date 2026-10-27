// The Rust host on a machine reached over ssh (ADR 0004 phase 5): copied there once per
// version, so a remote pane needs no Wraithgrid installed on that machine. Linux only; any
// other machine, or one this build has no binary for, keeps `wraithgrid host-stdio`.

/** `uname -m` → the musl target whose static binary runs there. */
const TARGETS: Record<string, string> = {
  x86_64: 'x86_64-unknown-linux-musl',
  amd64: 'x86_64-unknown-linux-musl',
  aarch64: 'aarch64-unknown-linux-musl',
  arm64: 'aarch64-unknown-linux-musl'
}

const PRESENT = '__WRAITHGRID_HOST_PRESENT__'

/** From `uname -sm` ("Linux x86_64"); null on anything but Linux on x64/arm64. */
export function remoteTarget(uname: string): string | null {
  const [os, arch] = uname.trim().split(/\s+/)
  return os === 'Linux' ? (TARGETS[arch ?? ''] ?? null) : null
}

/** Relative to the remote home, where ssh starts. */
export const remoteBinPath = (version: string): string =>
  `.wraithgrid/bin/wraithgrid-host-${version}`

/** Other versions unused this long are deleted from a machine; 0 days would make two
 *  Wraithgrid versions that share one machine copy theirs over again on every connect. */
export const UNUSED_DAYS = 30

/**
 * POSIX sh and fish both run these: plain commands joined by `;` and `&&`. A binary counts
 * only once it ran there (`--version`), so one that can't run falls back instead of failing.
 * Found, it is touched (its date says when it was last used), and other versions unused for
 * UNUSED_DAYS go; a host still running one keeps running, since Linux keeps a deleted file
 * open for it.
 */
export const preflightCommand = (version: string): string => {
  const bin = remoteBinPath(version)
  // `command`: a shell function named find (a fish config's) must not stand in for it.
  const sweep = `command find .wraithgrid/bin -maxdepth 1 -type f -name 'wraithgrid-host-*' ! -name 'wraithgrid-host-${version}' -mtime +${UNUSED_DAYS} -delete 2>/dev/null`
  return `uname -sm; test -x ${bin} && ${bin} --version >/dev/null && touch ${bin} && echo ${PRESENT}; ${sweep}`
}

export const uploadCommand = (version: string): string => {
  const tmp = `.wraithgrid/bin/.wraithgrid-host-${version}.part`
  const bin = remoteBinPath(version)
  return `mkdir -p .wraithgrid/bin && cat > ${tmp} && chmod 700 ${tmp} && ${tmp} --version >/dev/null && mv -f ${tmp} ${bin}`
}

export interface PrepareDeps {
  version: string
  /** Runs a command on the machine; `input` goes to its stdin. */
  run: (command: string, input?: Buffer) => Promise<{ code: number | null; stdout: string }>
  /** This build's binary for a target, or null when it has none. */
  binary: (target: string) => Promise<Buffer | null>
  log?: (msg: string) => void
}

/**
 * Makes sure the machine has this version's Rust host. Resolves to the ssh command that runs
 * its bridge, or null to fall back to `wraithgrid host-stdio`.
 */
export async function prepareRemote(d: PrepareDeps): Promise<string[] | null> {
  // The version lands in a shell command: only what a release version can hold.
  if (!/^[0-9A-Za-z.+-]+$/.test(d.version)) return null
  const pre = await d.run(preflightCommand(d.version))
  const target = remoteTarget(pre.stdout.split('\n')[0] ?? '')
  if (!target) {
    d.log?.(`no Rust host for "${pre.stdout.split('\n')[0]?.trim()}"; using wraithgrid host-stdio`)
    return null
  }
  if (!pre.stdout.includes(PRESENT)) {
    const bin = await d.binary(target)
    if (!bin) {
      d.log?.(`this build has no ${target} host; using wraithgrid host-stdio`)
      return null
    }
    const up = await d.run(uploadCommand(d.version), bin)
    if (up.code !== 0) {
      d.log?.(`copying the host failed (${up.code}); using wraithgrid host-stdio`)
      return null
    }
  }
  return [remoteBinPath(d.version), 'stdio', d.version]
}
