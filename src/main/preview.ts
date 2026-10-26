// Web preview (#74): each preview pane's dev server, run over pipes in the project folder and
// stopped with its pane (and on quit). Its output goes to the pane's Log drawer; the first local
// address it prints is where the page loads from.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  findLocalUrl,
  PREVIEW_LOG_MAX,
  plainLine,
  type PreviewEvent,
  type ProjectFiles
} from '@shared/preview'
import type { ChatChild, ChatLaunch } from './chat/sessions'

export interface DevServersDeps {
  spawn(launch: ChatLaunch): ChatChild
  emit(paneId: string, event: PreviewEvent): void
  /** Ends a server that ignored SIGTERM (Windows: the whole tree). */
  forceKill?(pid: number): void
  stopGraceMs?: number
}

/** How much of an unfinished output line is held back waiting for its end. */
const LINE_REST_MAX = 64 * 1024

interface Run {
  child: ChatChild
  urlSeen: boolean
  lines: number
}

export class DevServers {
  private runs = new Map<string, Run>()

  constructor(private deps: DevServersDeps) {}

  start(paneId: string, launch: ChatLaunch): void {
    this.stop(paneId)
    let child: ChatChild
    try {
      child = this.deps.spawn(launch)
    } catch (e) {
      this.deps.emit(paneId, { kind: 'exit', code: null, error: (e as Error).message })
      return
    }
    const run: Run = { child, urlSeen: false, lines: 0 }
    this.runs.set(paneId, run)
    const onLines = (lines: string[]): void => {
      for (const raw of lines) {
        const line = plainLine(raw)
        if (!line.trim()) continue
        // A server stuck printing forever still leaves the app responsive.
        if (++run.lines > PREVIEW_LOG_MAX * 10) return
        this.deps.emit(paneId, { kind: 'log', line })
        const url = run.urlSeen ? null : findLocalUrl(line)
        if (url) {
          run.urlSeen = true
          this.deps.emit(paneId, { kind: 'url', url })
        }
      }
    }
    // Line by line, per stream: a URL cut across two chunks (`:51` | `73/`) is read whole (#140).
    const ends: (() => void)[] = []
    for (const s of [child.stdout, child.stderr]) {
      let rest = ''
      s.setEncoding('utf8')
      s.on('data', (chunk: string) => {
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()!
        // A line that never ends (a progress bar redrawn with \r) still shows, in pieces.
        if (rest.length > LINE_REST_MAX) {
          lines.push(rest)
          rest = ''
        }
        onLines(lines)
      })
      ends.push(() => {
        if (rest) onLines([rest])
        rest = ''
      })
    }
    child.once('exit', () => {
      if (this.runs.get(paneId) === run) ends.forEach((f) => f())
    })
    child.once('error', (err) => {
      if (this.runs.get(paneId) !== run) return
      this.runs.delete(paneId)
      this.deps.emit(paneId, { kind: 'exit', code: null, error: err.message })
    })
    child.once('exit', (code) => {
      if (this.runs.get(paneId) !== run) return
      this.runs.delete(paneId)
      this.deps.emit(paneId, { kind: 'exit', code })
    })
  }

  /** Stops the pane's server (and what it started); quiet: the pane asked for it. */
  stop(paneId: string): void {
    const run = this.runs.get(paneId)
    if (!run) return
    this.runs.delete(paneId)
    run.child.kill('SIGTERM')
    const pid = run.child.pid
    setTimeout(() => {
      run.child.kill('SIGKILL')
      if (pid) this.deps.forceKill?.(pid)
    }, this.deps.stopGraceMs ?? 3000).unref()
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }

  running(paneId: string): boolean {
    return this.runs.has(paneId)
  }
}

/** What the folder says about how it runs (package.json scripts, lockfiles, artisan). */
export async function readProjectFiles(dir: string): Promise<ProjectFiles> {
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    // Missing folder: nothing to detect.
  }
  let scripts: Record<string, string> | null = null
  if (names.includes('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
        scripts?: unknown
      }
      if (pkg.scripts && typeof pkg.scripts === 'object')
        scripts = Object.fromEntries(
          Object.entries(pkg.scripts).filter((e): e is [string, string] => typeof e[1] === 'string')
        )
    } catch {
      // Unreadable package.json: as if there were none.
    }
  }
  return { scripts, lockfiles: names, artisan: names.includes('artisan') }
}
