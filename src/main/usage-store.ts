// Records chat-turn usage and plan limits as the chat events pass through main, into
// userData/usage.json (90 days, written a moment after the last change). Nothing is sent
// anywhere: the CLI already reported these numbers.
import { readFile } from 'node:fs/promises'
import type { ChatEvent } from '@shared/chat'
import { EMPTY_USAGE, addTurn, pruneUsage, usageDataSchema, type UsageData } from '@shared/usage'
import { writeFileAtomic } from './config-store'

export interface PaneOwner {
  accountId: string | null
  workspaceId: string | null
  title: string
}

export interface UsageStoreDeps {
  file: string
  /** Who a pane belongs to right now, from main's config copy. */
  owner(paneId: string): PaneOwner | null
  now?: () => number
  saveDelayMs?: number
  write?: (file: string, text: string) => Promise<void>
}

export class UsageStore {
  private data: UsageData = EMPTY_USAGE
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number

  constructor(private readonly deps: UsageStoreDeps) {
    this.now = deps.now ?? Date.now
  }

  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.deps.file, 'utf8'))
      const r = usageDataSchema.safeParse(raw)
      if (r.success) this.data = pruneUsage(r.data, this.now())
    } catch {
      // No file yet, or a broken one: start empty (the next save replaces it).
    }
  }

  get(): UsageData {
    return pruneUsage(this.data, this.now())
  }

  onChatEvent(paneId: string, e: ChatEvent): void {
    if (e.t === 'limits') {
      const owner = this.deps.owner(paneId)
      if (!owner?.accountId) return
      this.data = { ...this.data, limits: { ...this.data.limits, [owner.accountId]: e.limits } }
      this.scheduleSave()
    } else if (e.t === 'turnEnd' && e.usage) {
      const owner = this.deps.owner(paneId)
      this.data = addTurn(this.data, {
        at: this.now(),
        accountId: owner?.accountId ?? null,
        workspaceId: owner?.workspaceId ?? null,
        paneId,
        title: owner?.title ?? '',
        usage: e.usage
      })
      this.scheduleSave()
    }
  }

  /** Writes now if a save is pending (quit). */
  async flush(): Promise<void> {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    await this.save()
  }

  private scheduleSave(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, this.deps.saveDelayMs ?? 1500)
  }

  private async save(): Promise<void> {
    const text = JSON.stringify(pruneUsage(this.data, this.now()))
    await (this.deps.write ?? writeFileAtomic)(this.deps.file, text).catch(() => {})
  }
}
