// Search over the mod catalog (a few thousand entries from the account's marketplaces).
// The same mod is often listed by two marketplaces: one row per name is shown, the one
// with an install count first, so the list reads as mods, not as listings.
import type { CatalogMod } from '@shared/ipc-contract'

/** One entry per mod name: the listing with the most installs. Order is kept. */
export function uniqueMods(mods: CatalogMod[]): CatalogMod[] {
  const best = new Map<string, CatalogMod>()
  for (const m of mods) {
    const seen = best.get(m.name)
    if (!seen || (m.installs ?? -1) > (seen.installs ?? -1)) best.set(m.name, m)
  }
  return [...best.values()]
}

/**
 * Mods matching every word of `query`, best first: a name that starts with the query, then a
 * name that holds it, then a description match; most installed first within each. An empty
 * query lists the most installed.
 */
export function searchMods(mods: CatalogMod[], query: string): CatalogMod[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const whole = words.join(' ')
  const ranked = uniqueMods(mods).flatMap((m): { m: CatalogMod; rank: number }[] => {
    const name = m.name.toLowerCase().replace(/[-_]+/g, ' ')
    if (words.length === 0) return [{ m, rank: 0 }]
    if (name.startsWith(whole)) return [{ m, rank: 0 }]
    // "status line" also finds `statusline`.
    if (words.every((w) => name.includes(w)) || name.replace(/ /g, '').includes(words.join('')))
      return [{ m, rank: 1 }]
    const text = `${name} ${m.description.toLowerCase()}`
    return words.every((w) => text.includes(w)) ? [{ m, rank: 2 }] : []
  })
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.m.installs ?? 0) - (a.m.installs ?? 0) ||
        a.m.name.localeCompare(b.m.name)
    )
    .map((r) => r.m)
}

/** 1290640 → "1.3M", 4520 → "4.5k". */
export function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}
