// CSI, OSC (BEL or ST terminated), two-byte escapes, then C0 controls except \n.
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|[\x00-\x09\x0b-\x1f\x7f]/g

/** Plain text of terminal output, for pattern matching only (never displayed). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}
