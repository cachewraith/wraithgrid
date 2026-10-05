// Searching the bundled icons. Pure, so it is unit-testable without the icon data.
import { ICON_SETS, type IconSetName } from '@shared/icons'

export type IconSets = Record<IconSetName, Record<string, string>>

export interface IconHit {
  set: IconSetName
  name: string
}

/** Shown before anything is typed: things people name projects and accounts after. */
export const STARTER_ICONS: IconHit[] = [
  ...[
    'rocket-launch',
    'code',
    'terminal',
    'folder',
    'work',
    'home',
    'bug-report',
    'database',
    'cloud',
    'science',
    'school',
    'star',
    'favorite',
    'bolt',
    'settings',
    'build',
    'palette',
    'smart-toy',
    'psychology',
    'sports-esports',
    'pets',
    'coffee',
    'menu-book',
    'shield',
    'public',
    'storefront',
    'payments',
    'analytics',
    'smartphone',
    'auto-awesome'
  ].map((name) => ({ set: 'material' as const, name })),
  ...[
    'git-branch',
    'github',
    'boxes',
    'brain',
    'cpu',
    'server',
    'flask-conical',
    'leaf',
    'flame',
    'moon',
    'sun',
    'ghost',
    'cat',
    'gem',
    'crown',
    'feather',
    'anchor',
    'mountain'
  ].map((name) => ({ set: 'lucide' as const, name }))
]

/**
 * Icons whose name contains every word of the query. Best first: an exact name, then names
 * starting with the query, then the rest; shorter names first within each group.
 */
export function searchIcons(
  sets: IconSets,
  query: string,
  only: IconSetName | null,
  limit = 240
): IconHit[] {
  const words = query
    .toLowerCase()
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
  if (!words.length) {
    return STARTER_ICONS.filter((h) => (!only || h.set === only) && sets[h.set][h.name])
  }
  const joined = words.join('-')
  const hits: { hit: IconHit; rank: number }[] = []
  for (const set of ICON_SETS) {
    if (only && set !== only) continue
    for (const name of Object.keys(sets[set])) {
      if (!words.every((w) => name.includes(w))) continue
      const rank = name === joined ? 0 : name.startsWith(joined) ? 1 : 2
      hits.push({ hit: { set, name }, rank })
    }
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.hit.name.length - b.hit.name.length ||
      a.hit.name.localeCompare(b.hit.name)
  )
  return hits.slice(0, limit).map((h) => h.hit)
}

/** The SVG body for a bundled icon, or null. Own keys only, so no prototype lookups. */
export function iconBody(sets: IconSets, set: IconSetName, name: string): string | null {
  const table = sets[set]
  return Object.prototype.hasOwnProperty.call(table, name) ? table[name]! : null
}
