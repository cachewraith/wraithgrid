import type { PaneStatus } from '@shared/types'

export interface PaneActivity {
  lastOutputAt: number
  lastInputAt: number
  /** When output last showed a permission prompt ("Do you want to proceed?"). */
  approvalAt: number
}

export interface StatusInput {
  started: boolean
  exited: boolean
  /** A claude pane whose account is not signed in yet. */
  loginNeeded: boolean
  activity: PaneActivity | undefined
  now: number
}

/** Output within this window counts as "running"; quieter panes are idle. */
export const RUNNING_WINDOW_MS = 1200
/** Output this soon after a keypress is treated as echo, not work. */
export const ECHO_WINDOW_MS = 250

export const APPROVAL_PATTERN =
  /Do you want to (?:proceed|make this edit|create|allow|run)[^\n]{0,160}\?/i
export const LOGIN_PATTERN = /login successful|logged in as/i

export function deriveStatus({
  started,
  exited,
  loginNeeded,
  activity,
  now
}: StatusInput): PaneStatus {
  if (exited) return 'exited'
  if (!started) return 'starting'
  if (loginNeeded) return 'login'
  if (!activity) return 'idle'
  if (activity.approvalAt > activity.lastInputAt) return 'approval'
  if (now - activity.lastOutputAt < RUNNING_WINDOW_MS) return 'running'
  return 'idle'
}

/** The line shown in the exit bar: the last line mentioning an error, else the last line. */
export function lastErrorLine(tail: string): string | null {
  const lines = tail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const err = [...lines].reverse().find((l) => /error|failed|exception|not found|denied/i.test(l))
  const line = err ?? lines[lines.length - 1]
  return line ? line.slice(0, 200) : null
}
