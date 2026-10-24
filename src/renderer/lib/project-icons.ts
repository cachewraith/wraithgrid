// Project icons (#80): the bundled sets, offline. Material Icon Theme (MIT) is imported whole
// but only once something asks for it (its own chunk); devicon's extra logos and a short list
// of Material Symbols come from project-icons-extra.json (scripts/gen-project-icons.mjs).
// SVG bodies come from these packages only, never from config: an id is just `set:name`.
import { useSyncExternalStore } from 'react'
import { DEFAULT_PROJECT_ICON, PROJECT_ICON_ID } from '@shared/project-icons'
import extra from './project-icons-extra.json'

interface IconData {
  body: string
  width?: number
  height?: number
}
interface IconSet {
  width: number
  height: number
  icons: Record<string, IconData>
}
export interface ProjectIconSvg {
  body: string
  width: number
  height: number
}

const sets: Record<string, IconSet | null> = {
  dev: extra.dev as IconSet,
  ms: extra.ms as IconSet,
  mit: null
}
let loading: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()

/** Loads Material Icon Theme once; listeners re-render when it's in. */
export function loadMaterialIconTheme(): Promise<void> {
  loading ??= import('@iconify-json/material-icon-theme/icons.json').then((m) => {
    const set = (m.default ?? m) as unknown as IconSet
    sets.mit = { ...set, width: set.width ?? 16, height: set.height ?? 16 }
    version++
    listeners.forEach((cb) => cb())
  })
  return loading
}

/** The icon's SVG, null if unknown (draw the folder), undefined while its set loads. */
export function projectIconSvg(id: string): ProjectIconSvg | null | undefined {
  if (!PROJECT_ICON_ID.test(id)) return null
  const [setName, name] = id.split(':') as [string, string]
  const set = sets[setName]
  if (set === null) {
    void loadMaterialIconTheme()
    return undefined
  }
  const icon = set?.icons[name]
  if (!icon) return null
  return { body: icon.body, width: icon.width ?? set.width, height: icon.height ?? set.height }
}

/** Re-renders a component once Material Icon Theme has loaded. */
export function useIconSets(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
}

/** Names a picker can list, per tab. `mit` excludes its folder-* variants. */
export function iconNames(tab: 'tech' | 'general'): string[] {
  if (tab === 'general') return Object.keys(sets.ms!.icons).map((n) => `ms:${n}`)
  const mit = sets.mit ? Object.keys(sets.mit.icons).filter((n) => !n.startsWith('folder-')) : []
  return [
    ...Object.keys(sets.dev!.icons).map((n) => `dev:${n}`),
    ...mit.map((n) => `mit:${n}`)
  ].sort((a, b) => a.split(':')[1]!.localeCompare(b.split(':')[1]!))
}

/** What the picker shows for an id: its name without the set. */
export function iconLabel(id: string): string {
  return (id.split(':')[1] ?? id).replace(/-/g, ' ')
}

export { DEFAULT_PROJECT_ICON }
