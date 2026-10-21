// A mod's id is `name@marketplace`; main and the Mods view both split it.

/** The marketplace half of a mod id, or '' when it names none. */
export function marketplaceOf(id: string): string {
  const at = id.lastIndexOf('@')
  return at > 0 ? id.slice(at + 1) : ''
}

/** The name half of a mod id. */
export function modNameOf(id: string): string {
  const at = id.lastIndexOf('@')
  return at > 0 ? id.slice(0, at) : id
}

/**
 * The mod name of a mod folder Wraithgrid downloaded (`~/.wraithgrid/mods/<name>`, as Settings
 * keeps it), or null for a folder of the user's own.
 */
export function downloadedModName(dir: string): string | null {
  const m = /^~[\\/]\.wraithgrid[\\/]mods[\\/]([A-Za-z0-9_][A-Za-z0-9_.-]{0,119})[\\/]?$/.exec(dir)
  return m?.[1] ?? null
}
