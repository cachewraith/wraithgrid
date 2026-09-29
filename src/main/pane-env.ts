import path from 'node:path'
import { expandHome } from '@shared/paths'

export interface PaneEnvInput {
  baseEnv: NodeJS.ProcessEnv
  /** Plain shell panes never get CLAUDE_CONFIG_DIR from Wraithgrid. */
  shell: boolean
  /** The account's config dir, possibly starting with `~`. */
  configDir: string | null
  homeDir: string
}

/**
 * The one place that decides a pane's environment, including CLAUDE_CONFIG_DIR
 * (requirements §13: isolate it so a CLI change touches one function).
 */
export function buildPaneEnv({
  baseEnv,
  shell,
  configDir,
  homeDir
}: PaneEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    // Electron's own switches must not leak into child tools (e.g. ELECTRON_RUN_AS_NODE).
    if (value === undefined || key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  if (!shell && configDir) {
    env.CLAUDE_CONFIG_DIR = path.resolve(expandHome(configDir, homeDir))
  }
  return env
}
