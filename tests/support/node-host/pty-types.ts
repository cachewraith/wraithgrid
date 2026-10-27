// The slice of node-pty's API the test host uses. node-pty is gone (ADR 0004 phase 4b): the
// tests hand the host fake ptys (tests/unit/host-fixtures.ts) that have just these members.
export interface IDisposable {
  dispose(): void
}

export interface IPty {
  readonly pid: number
  onData(listener: (data: string) => void): IDisposable
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): IDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface IPtyForkOptions {
  name?: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
}
