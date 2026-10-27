// What a pane looks like right now, kept by the host so a client that attaches late gets the
// real screen (alternate screen, modes, cursor) instead of a cut byte stream (ADR 0001 §3).
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/headless'

/** Same as the renderer's xterm, so a reattached pane keeps as much as it showed. */
export const HOST_SCROLLBACK = 5000

export interface Screen {
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Resolves once every write so far is parsed. */
  serialize(): Promise<string>
  /** Plain text of the visible rows, or of the last `lines` rows including scrollback. */
  text(lines?: number): Promise<string>
  dispose(): void
}

export type ScreenFactory = (cols: number, rows: number) => Screen

export const headlessScreen: ScreenFactory = (cols, rows) => {
  const term = new Terminal({ cols, rows, scrollback: HOST_SCROLLBACK, allowProposedApi: true })
  const ser = new SerializeAddon()
  term.loadAddon(ser)
  return {
    write: (data) => term.write(data),
    resize: (c, r) => term.resize(c, r),
    serialize: () => new Promise((resolve) => term.write('', () => resolve(ser.serialize()))),
    text: (lines) =>
      new Promise((resolve) =>
        term.write('', () => {
          const buf = term.buffer.active
          const end = buf.baseY + term.rows
          const start = Math.max(0, lines ? end - lines : buf.baseY)
          const out: string[] = []
          for (let y = start; y < end; y++) {
            const line = buf.getLine(y)
            const t = line?.translateToString(true) ?? ''
            // A row the terminal wrapped continues the previous line.
            if (line?.isWrapped && out.length) out[out.length - 1] += t
            else out.push(t)
          }
          while (out.length && !out[out.length - 1]) out.pop()
          resolve(out.join('\n'))
        })
      ),
    dispose: () => term.dispose()
  }
}
