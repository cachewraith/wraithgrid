// Loads the bundled icon data once, on first use, as its own chunk.
import { useEffect, useState } from 'react'
import type { IconSets } from './icon-search'

let loaded: IconSets | null = null
let loading: Promise<IconSets> | null = null

export function loadIconSets(): Promise<IconSets> {
  loading ??= import('virtual:icon-sets').then((m) => (loaded = m.default))
  return loading
}

/** The icon sets, or null until they have loaded (then the component re-renders). */
export function useIconSets(enabled = true): IconSets | null {
  const [sets, setSets] = useState<IconSets | null>(loaded)
  useEffect(() => {
    if (!enabled || sets) return
    let live = true
    void loadIconSets().then((s) => live && setSets(s))
    return () => {
      live = false
    }
  }, [enabled, sets])
  return sets
}
