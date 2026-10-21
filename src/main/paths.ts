import path from 'node:path'
import { expandHome } from '@shared/paths'

export const CONFIG_FILE_NAME = 'config.json'

/**
 * Requirements §9 names ~/.config/wraithgrid; Electron would default to the productName.
 * WRAITHGRID_USER_DATA_DIR lets tests run against a throwaway config dir.
 */
export function userDataDir(appData: string, env: NodeJS.ProcessEnv): string {
  return env.WRAITHGRID_USER_DATA_DIR || path.join(appData, 'wraithgrid')
}

export function configFilePath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE_NAME)
}

/** Where new accounts get their config dir: ~/.wraithgrid/accounts */
export function accountsRoot(homeDir: string): string {
  return path.join(homeDir, '.wraithgrid', 'accounts')
}

/** Where git worktrees created for new panes live, one folder per repo. */
export function worktreesRoot(homeDir: string): string {
  return path.join(homeDir, '.wraithgrid', 'worktrees')
}

/** Theme files people make or import: ~/.wraithgrid/themes/<id>.json */
export function themesRoot(homeDir: string): string {
  return path.join(homeDir, '.wraithgrid', 'themes')
}

/** Expands `~` and makes the path absolute. */
export function resolveUserPath(p: string, homeDir: string): string {
  return path.resolve(expandHome(p, homeDir))
}

/** True when `child` is strictly inside `parent` (not equal to it). */
export function isStrictlyInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
