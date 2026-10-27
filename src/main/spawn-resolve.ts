// Turns "run this account's CLI (or a shell) in this folder" into the exact process to start:
// binary, args, cwd and env. The GUI does it for panes on this computer; on a remote machine
// (H5) `wraithgrid host-stdio` does it there, with that machine's PATH, home and binaries.
import { access, stat } from 'node:fs/promises'
import { z } from 'zod'
import { expandHome } from '@shared/paths'
import { idSchema } from '@shared/schema'
import {
  AGENT_CLIS,
  AGENT_CLI_BIN,
  AGENT_CLI_LABEL,
  AGENT_CLI_SPECS,
  withProjectDocArgs,
  withResumeArgs
} from '@shared/agent-clis'
import type { SpawnRequest } from '../host/protocol'
import { findOnPath, resolveClaudePath } from './claude-detect'
import { buildPaneEnv } from './pane-env'
import { resolveUserPath } from './paths'
import { resolvePaneShell, spawnCommandFor } from './platform'

const dim = z.number().int().min(1).max(1000)

/** What a pane runs, before anything machine-specific is looked up. */
export const spawnSpecSchema = z.object({
  paneId: idSchema,
  cli: z.enum(AGENT_CLIS),
  shell: z.boolean(),
  /** The account's config dir, `~` meaning the home of the machine it runs on. */
  configDir: z.string().max(4096).nullable(),
  cwd: z.string().min(1).max(4096),
  args: z
    .array(
      z
        .string()
        .max(1000)
        .refine((s) => !s.includes('\0'))
    )
    .max(32),
  resume: z.boolean(),
  cols: dim,
  rows: dim
})
export type SpawnSpec = z.infer<typeof spawnSpecSchema>

/** This machine's facts and the user's overrides that apply on it. */
export interface ResolveContext {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homeDir: string
  /** claude binary override; empty: found on PATH. */
  claudePath: string
  cliPaths: Partial<Record<SpawnSpec['cli'], string>>
  shellPath: string
  shellArgs: string[]
  modDirs: string[]
}

export type ResolveResult = { ok: true; req: SpawnRequest } | { ok: false; error: string }

const fileExists = (f: string): Promise<boolean> =>
  access(f).then(
    () => true,
    () => false
  )

/** An agent pane's arguments: the account's, plus resume and project-doc flags of its CLI. */
export function agentArgs(spec: SpawnSpec): string[] {
  let args = spec.args
  if (spec.resume) args = withResumeArgs(spec.cli, args)
  return spec.cli === 'claude' ? args : withProjectDocArgs(spec.cli, args)
}

export async function resolveSpawn(spec: SpawnSpec, ctx: ResolveContext): Promise<ResolveResult> {
  const fail = (error: string): ResolveResult => ({ ok: false, error })
  const { homeDir } = ctx
  const cwd = resolveUserPath(spec.cwd, homeDir)
  try {
    if (!(await stat(cwd)).isDirectory()) return fail(`Not a folder: ${spec.cwd}`)
  } catch {
    return fail(`Folder not found: ${spec.cwd}`)
  }

  const { cli } = spec
  let file: string
  let args: string[]
  if (spec.shell) {
    const picked = await resolvePaneShell(
      ctx.platform,
      ctx.env,
      (name) => findOnPath(name, ctx.env, ctx.platform),
      fileExists,
      {
        // A bare name stays bare: it is looked up on PATH.
        path: expandHome(ctx.shellPath.trim(), homeDir),
        args: ctx.shellArgs
      }
    )
    if (!picked.ok) return fail(picked.error)
    file = picked.shell.file
    args = picked.shell.args
  } else if (cli !== 'claude') {
    const bin = AGENT_CLI_BIN[cli]
    const override = expandHome((ctx.cliPaths[cli] ?? '').trim(), homeDir)
    if (override) {
      try {
        if (!(await stat(override)).isFile()) return fail(`Not a file: ${override}`)
      } catch {
        return fail(`${bin} binary not found: ${override}`)
      }
      file = override
    } else {
      const found = await findOnPath(bin, ctx.env, ctx.platform)
      if (!found) return fail(`${bin} (${AGENT_CLI_LABEL[cli]}) was not found on PATH.`)
      file = found
    }
    args = agentArgs(spec)
  } else {
    const resolved = await resolveClaudePath(ctx.claudePath, homeDir)
    if (!resolved.path) return fail('claude was not found on PATH. Set its path in Settings.')
    try {
      if (!(await stat(resolved.path)).isFile()) return fail(`Not a file: ${resolved.path}`)
    } catch {
      return fail(`claude binary not found: ${resolved.path}`)
    }
    file = resolved.path
    args = agentArgs(spec)
  }

  const cmd = spawnCommandFor(ctx.platform, file, args, ctx.env.ComSpec)
  if (!cmd.ok) return fail(cmd.error)
  const env = buildPaneEnv({
    baseEnv: ctx.env,
    shell: spec.shell,
    cli,
    configDir: spec.configDir,
    homeDir,
    modDirs: ctx.modDirs
  })
  // Its own id, so an agent can name itself to `wraithgrid` (send, split, wait).
  env.WRAITHGRID_PANE = spec.paneId
  return {
    ok: true,
    req: {
      paneId: spec.paneId,
      file: cmd.file,
      args: cmd.args,
      cwd,
      env,
      cols: spec.cols,
      rows: spec.rows,
      // Lets the host tell `wraithgrid wait --until blocked` the CLI is asking for approval.
      approval: spec.shell ? undefined : AGENT_CLI_SPECS[cli].approval.source
    }
  }
}
