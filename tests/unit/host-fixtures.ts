// Fakes shared by the pty host and `wraithgrid` command tests.
import { Duplex } from 'node:stream'

/** Two connected in-memory streams, like both ends of a socket. */
export function pipePair(): [Duplex, Duplex] {
  const ends: Duplex[] = []
  const make = (i: number): Duplex =>
    new Duplex({
      allowHalfOpen: false,
      read() {},
      write(chunk, _enc, cb) {
        ends[1 - i]!.push(chunk)
        cb()
      },
      final(cb) {
        ends[1 - i]!.push(null)
        cb()
      },
      destroy(err, cb) {
        const other = ends[1 - i]!
        if (!other.destroyed) other.destroy()
        cb(err)
      }
    })
  ends.push(make(0), make(1))
  return [ends[0]!, ends[1]!]
}

export class FakePty {
  static nextPid = 5000
  pid = FakePty.nextPid++
  written: string[] = []
  size = { cols: 0, rows: 0 }
  private dataL: ((d: string) => void)[] = []
  private exitL: ((e: { exitCode: number; signal?: number }) => void)[] = []
  onData = (l: (d: string) => void) => {
    this.dataL.push(l)
    return { dispose: () => (this.dataL = this.dataL.filter((x) => x !== l)) }
  }
  onExit = (l: (e: { exitCode: number; signal?: number }) => void) => {
    this.exitL.push(l)
    return { dispose: () => (this.exitL = this.exitL.filter((x) => x !== l)) }
  }
  write = (d: string) => this.written.push(d)
  resize = (cols: number, rows: number) => (this.size = { cols, rows })
  emit(d: string) {
    this.dataL.forEach((l) => l(d))
  }
  exit(code: number) {
    this.exitL.forEach((l) => l({ exitCode: code }))
  }
}

export const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))
