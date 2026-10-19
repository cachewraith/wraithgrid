import type { PaneStatus } from '@shared/types'
import { RUNNING_WINDOW_MS } from '@shared/activity'

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

export { ECHO_WINDOW_MS, RUNNING_WINDOW_MS } from '@shared/activity'

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
