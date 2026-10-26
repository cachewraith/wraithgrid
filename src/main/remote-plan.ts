// A remote pane as a plan (ADR 0004 phase 5): the window keeps every rule (which CLI, its
// arguments, the environment, how to read the login shell's PATH) and the Rust host on the
// ssh machine only does what needs that machine: PATH from its login shell, the first
// candidate binary that exists, the folder, `~` and its own environment.
import { AGENT_CLI_BIN, AGENT_CLI_LABEL, AGENT_CLI_SPECS } from '@shared/agent-clis'
import { paneEnvPlan, type PaneEnvPlan } from './pane-env'
import { pathProbePlan, type PathProbePlan } from './platform'
import { agentArgs, type SpawnSpec } from './spawn-resolve'

/** The default shells to try on a Linux machine after its $SHELL (platform.ts). */
const LINUX_SHELLS = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/bin/sh']

export interface RemotePlan {
  paneId: string
  cols: number
  rows: number
  /** The folder, `~` for the machine's home; relative paths are under it. */
  cwd: string
  /**
   * In order, the first that exists runs: `$SHELL` (the machine's login shell), a path
   * (absolute or `~/…`) or a bare name looked up on the machine's PATH.
   */
  candidates: string[]
  notFound: string
  args: string[]
  env: PaneEnvPlan
  path: PathProbePlan
  /** The CLI's "needs approval" output as a RegExp source, for `blocked`. */
  approval?: string
}

export function remotePlan(spec: SpawnSpec): RemotePlan {
  const env = paneEnvPlan({
    shell: spec.shell,
    cli: spec.cli,
    configDir: spec.configDir,
    platform: 'linux'
  })
  // Its own id, so an agent can name itself to `wraithgrid` (send, split, wait).
  env.set.WRAITHGRID_PANE = spec.paneId
  const bin = AGENT_CLI_BIN[spec.cli]
  return {
    paneId: spec.paneId,
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    candidates: spec.shell ? ['$SHELL', ...LINUX_SHELLS] : [bin],
    notFound: spec.shell
      ? 'No shell found on that machine.'
      : `${bin} (${AGENT_CLI_LABEL[spec.cli]}) was not found on PATH there.`,
    args: spec.shell ? [] : agentArgs(spec),
    env,
    path: pathProbePlan(),
    ...(spec.shell ? {} : { approval: AGENT_CLI_SPECS[spec.cli].approval.source })
  }
}
