// Web preview (#74): a project's dev server and the page it serves, in a pane. Pure: which
// command runs it, which addresses may load, and the address the server prints.

/** The preview's own session: no cookies or storage shared with the app. */
export const PREVIEW_PARTITION = 'wraithgrid-preview'
/** Lines of server output kept for the Log drawer. */
export const PREVIEW_LOG_MAX = 2000

export type PreviewEvent =
  | { kind: 'log'; line: string }
  /** The first local address the server printed. */
  | { kind: 'url'; url: string }
  | { kind: 'exit'; code: number | null; error?: string }

export interface ProjectFiles {
  /** package.json `scripts`, or null without one. */
  scripts: Record<string, string> | null
  /** Lockfile names found in the folder. */
  lockfiles: string[]
  /** A Laravel `artisan` file. */
  artisan: boolean
}

const RUNNERS: [lockfile: string, run: string][] = [
  ['bun.lock', 'bun run'],
  ['bun.lockb', 'bun run'],
  ['pnpm-lock.yaml', 'pnpm run'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm run']
]

/** The command that starts the project's dev server, and where it came from; null: none found. */
export function detectDevCommand(files: ProjectFiles): { command: string; source: string } | null {
  const script = ['dev', 'start'].find((s) => files.scripts?.[s])
  if (script) {
    const [lock, run] = RUNNERS.find(([l]) => files.lockfiles.includes(l)) ?? [null, 'npm run']
    return {
      command: `${run} ${script}`,
      source: `package.json "${script}"${lock ? `, ${lock}` : ''}`
    }
  }
  if (files.artisan) return { command: 'php artisan serve', source: 'artisan' }
  return null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Only this computer's own web servers load in the preview; anything else opens in the browser. */
export function isLocalUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  return LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith('.localhost')
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

/** A line of server output without its colours. */
export function plainLine(line: string): string {
  return line.replace(ANSI, '').replace(/\r/g, '')
}

/** The local address in a line of server output (`0.0.0.0` read as localhost), or null. */
export function findLocalUrl(line: string): string | null {
  const m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s'"<>)\]]*/.exec(
    plainLine(line)
  )
  if (!m) return null
  const url = m[0].replace(/[.,;:]+$/, '').replace('//0.0.0.0', '//localhost')
  return isLocalUrl(url) ? url : null
}

/** How the command runs: the platform's shell, so `bun run dev` and `&&` work as typed. */
export function shellLaunch(
  command: string,
  platform: string,
  env: Record<string, string | undefined>
): { file: string; args: string[] | string } {
  if (platform === 'win32') return { file: env.ComSpec || 'cmd.exe', args: `/d /s /c "${command}"` }
  return { file: '/bin/sh', args: ['-c', command] }
}
