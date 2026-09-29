import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ClaudeDetectResult } from '@shared/ipc-contract'
import { resolveUserPath } from './paths'
import { spawnCommandFor } from './platform'

const VERSION_TIMEOUT_MS = 3000

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    if (!s.isFile()) return false
    await access(p, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** A `which` lookup in JS: the first executable `name` on PATH, or null. */
export async function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  const exts =
    platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').concat(['']) : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      if (await isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/** The binary a claude pane will spawn. The settings override wins over PATH. */
export async function resolveClaudePath(
  override: string,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ path: string | null; source: 'override' | 'path' | null }> {
  if (override.trim())
    return { path: resolveUserPath(override.trim(), homeDir), source: 'override' }
  const found = await findOnPath('claude', env)
  return { path: found, source: found ? 'path' : null }
}

function runVersion(bin: string): Promise<string> {
  const cmd = spawnCommandFor(process.platform, bin, ['--version'], process.env.ComSpec)
  if (!cmd.ok) return Promise.reject(new Error(cmd.error))
  const verbatim = typeof cmd.args === 'string'
  return new Promise((resolve, reject) => {
    execFile(
      cmd.file,
      verbatim ? [cmd.args as string] : (cmd.args as string[]),
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, windowsVerbatimArguments: verbatim },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.toString().trim().split('\n')[0] ?? '')
      }
    )
  })
}

/** Resolves the binary and checks that it runs (`claude --version`, 3 s timeout). */
export async function detectClaude(
  override: string,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ClaudeDetectResult> {
  const { path: bin, source } = await resolveClaudePath(override, homeDir, env)
  if (!bin) {
    return {
      path: null,
      source: null,
      version: null,
      ok: false,
      error: 'claude was not found on PATH'
    }
  }
  if (!(await isExecutableFile(bin))) {
    return { path: bin, source, version: null, ok: false, error: 'Not an executable file' }
  }
  try {
    const version = await runVersion(bin)
    return { path: bin, source, version: version || null, ok: true }
  } catch (err) {
    const killed = (err as { killed?: boolean }).killed
    return {
      path: bin,
      source,
      version: null,
      ok: false,
      error: killed ? '`--version` timed out after 3 s' : '`--version` failed'
    }
  }
}
