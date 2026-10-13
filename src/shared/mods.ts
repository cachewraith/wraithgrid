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
