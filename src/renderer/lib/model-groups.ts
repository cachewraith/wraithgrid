// The model picker's tabs (#160): a long list from the CLI (claude offers a dozen) splits into
// "Latest" and one tab per family, so the menu stays short at any zoom. Families come from the
// CLI's own labels (`Opus 5.5` → Opus); a short list, or one that doesn't group, stays flat. Pure.
import type { ChatModel } from '@shared/chat'

/** Fewer models than this stay one list. */
export const MODEL_TABS_MIN = 9
const FAMILIES_MAX = 6

export interface ModelTab {
  id: string
  label: string
  models: ChatModel[]
}

/** `Opus` of `Opus 5.5`; null for the CLI's default entry or a one-word label. */
export function modelFamily(m: ChatModel): string | null {
  if (m.value === 'default') return null
  const words = m.label.trim().split(/\s+/)
  return words.length > 1 ? words[0]! : null
}

/**
 * Latest (the default entry, then each family's first model: the CLI lists newest first),
 * then one tab per family in the CLI's order; null when the list should stay flat.
 */
export function modelTabs(models: ChatModel[]): ModelTab[] | null {
  if (models.length < MODEL_TABS_MIN) return null
  const families = new Map<string, ChatModel[]>()
  const other: ChatModel[] = []
  for (const m of models) {
    const f = modelFamily(m)
    if (f) families.set(f, [...(families.get(f) ?? []), m])
    else if (m.value !== 'default') other.push(m)
  }
  if (families.size < 2 || families.size > FAMILIES_MAX) return null
  const def = models.find((m) => m.value === 'default')
  const latest = [...(def ? [def] : []), ...[...families.values()].map((list) => list[0]!)]
  return [
    { id: 'latest', label: 'Latest', models: latest },
    ...[...families].map(([f, list]) => ({ id: f, label: f, models: list })),
    ...(other.length ? [{ id: 'other', label: 'Other', models: other }] : [])
  ]
}

/** The tab to open on: Latest when the chosen model is there, else its family's. */
export function tabOf(tabs: ModelTab[], value: string): string {
  return (tabs.find((t) => t.models.some((m) => m.value === value)) ?? tabs[0]!).id
}
