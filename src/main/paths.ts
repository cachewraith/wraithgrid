import path from 'node:path'
import { expandHome } from '@shared/paths'

export const CONFIG_FILE_NAME = 'config.json'

export function configFilePath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE_NAME)
}

/** Where new accounts get their config dir: ~/.wraithgrid/accounts */
export function accountsRoot(homeDir: string): string {
  return path.join(homeDir, '.wraithgrid', 'accounts')
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
