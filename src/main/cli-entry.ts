// `wraithgrid <command>` as plain Node: index.ts runs this file with the app's binary and
// ELECTRON_RUN_AS_NODE, so no window system starts (none exists over ssh). Never import
// `electron` here. The user-data dir and version arrive from index.ts in the environment.
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { parseConfig } from '@shared/schema'
import { hostPaths } from '../host/paths'
import { HOST_STDIO, runCli, type Tty } from './cli'
import { runBridge } from './host-bridge'
import { connectSocket, startHostProcess } from './host-start'
import { configFilePath } from './paths'
import { extraBinDirs, loginShellPath, mergePath } from './platform'
import { resolveSpawn } from './spawn-resolve'

const userData = process.env.WRAITHGRID_CLI_USER_DATA ?? ''
const appVersion = process.env.WRAITHGRID_CLI_VERSION ?? ''
delete process.env.WRAITHGRID_CLI_USER_DATA
delete process.env.WRAITHGRID_CLI_VERSION
delete process.env.ELECTRON_RUN_AS_NODE

const files = hostPaths({
  platform: process.platform,
  env: process.env,
  userData,
  tmpDir: os.tmpdir(),
  uid: process.getuid?.() ?? -1,
  userName: os.userInfo().username
})

const uid = process.getuid?.() ?? -1
const readToken = async (): Promise<string> => (await readFile(files.token, 'utf8')).trim()

/** `wraithgrid host-stdio`, the remote end of a machine connection (H5). */
async function bridge(): Promise<number> {
  // ssh runs this without a login shell: take PATH from one, as the window does at launch.
  if (process.platform !== 'win32' && !process.env.TERM) {
    const shellPath = await loginShellPath(process.env)
    process.env.PATH = mergePath(
      path.delimiter,
      shellPath ?? undefined,
      process.env.PATH,
      extraBinDirs(process.platform, os.homedir(), process.env).join(path.delimiter)
    )
  }
  await runBridge({
    input: process.stdin,
    output: process.stdout,
    connectHost: () => connectSocket(files.socket),
    startHost: () =>
      startHostProcess({
        paths: files,
        appVersion,
        execPath: process.execPath,
        outDir: __dirname,
        cwd: os.homedir(),
        env: process.env,
        uid
      }),
    readToken,
    // This machine's binaries and home; the GUI's own overrides are paths on another computer.
    resolve: (spec) =>
      resolveSpawn(spec, {
        platform: process.platform,
        env: process.env,
        homeDir: os.homedir(),
        claudePath: '',
        cliPaths: {},
        shellPath: '',
        shellArgs: [],
        modDirs: []
      })
  })
  return 0
}

const clamp = (n: number | undefined, fallback: number): number =>
  Math.min(1000, Math.max(1, n || fallback))

const tty: Tty | undefined =
  process.stdin.isTTY && process.stdout.isTTY
    ? {
        size: () => ({
          cols: clamp(process.stdout.columns, 80),
          rows: clamp(process.stdout.rows, 24)
        }),
        write: (data) => void process.stdout.write(data),
        raw: (on) => {
          process.stdin.setRawMode(on)
          if (on) process.stdin.resume()
          else process.stdin.pause()
        },
        onInput: (cb) => {
          // One decoder for the stream: a character cut across two chunks stays whole (#140).
          const utf8 = new StringDecoder('utf8')
          const listener = (chunk: Buffer): void => {
            const text = utf8.write(chunk)
            if (text) cb(text)
          }
          process.stdin.on('data', listener)
          return () => process.stdin.off('data', listener)
        },
        onResize: (cb) => {
          process.stdout.on('resize', cb)
          return () => process.stdout.off('resize', cb)
        }
      }
    : undefined

const command =
  process.argv[2] === HOST_STDIO
    ? bridge().catch((err: Error) => {
        process.stderr.write(`wraithgrid host-stdio: ${err.message}\n`)
        return 1
      })
    : runCli(process.argv.slice(2), {
        connect: () => connectSocket(files.socket),
        readToken,
        readConfig: async () => {
          try {
            const r = parseConfig(JSON.parse(await readFile(configFilePath(userData), 'utf8')))
            return r.ok ? r.config : null
          } catch {
            return null
          }
        },
        appVersion,
        cwd: process.cwd(),
        out: (text) => void process.stdout.write(text.endsWith('\n') ? text : `${text}\n`),
        err: (text) => void process.stderr.write(`${text}\n`),
        tty
      })
void command.then((code) => {
  process.exitCode = code
  // Exit even if a socket or stdin is still referenced; output is flushed first.
  process.stdout.write('', () => process.exit(code))
})
