// Sends each pane's process work to the host that runs it: this computer's, or a remote
// machine's over ssh (H5). Which one comes from the config: the pane's workspace machine.
import type { Machine } from '@shared/types'
import type { SpawnRequest, SpawnResult } from '../host/pty-manager'
import type { AttachResult, PaneHost, ProbeResult } from './pane-host'
import type { SpawnSpec } from './spawn-resolve'

export interface PaneRouterDeps {
  local: PaneHost
  /** A PaneHost that reaches `machine` (over ssh). */
  remote: (machine: Machine) => PaneHost
  machine: (id: string) => Machine | undefined
  /** The machine a pane runs on; null: this computer. */
  machineOf: (paneId: string) => string | null
}

export class PaneRouter {
  private readonly remotes = new Map<string, { host: PaneHost; sshHost: string }>()

  constructor(private readonly deps: PaneRouterDeps) {}

  create(req: SpawnRequest): Promise<SpawnResult> {
    return this.deps.local.create(req)
  }

  async spawnOn(machineId: string, spec: SpawnSpec): Promise<SpawnResult> {
    const host = this.remoteHost(machineId)
    if (!host) return { ok: false, error: 'This workspace’s machine was removed.' }
    return host.spawn(spec)
  }

  attach(paneId: string, cols: number, rows: number): Promise<AttachResult | null> {
    return this.hostOf(paneId)?.attach(paneId, cols, rows) ?? Promise.resolve(null)
  }

  write(paneId: string, data: string): void {
    this.hostOf(paneId)?.write(paneId, data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.hostOf(paneId)?.resize(paneId, cols, rows)
  }

  kill(paneId: string): void {
    this.hostOf(paneId)?.kill(paneId)
  }

  /** Connects to a machine once, to show in Settings whether it works. */
  probe(machine: Machine): Promise<ProbeResult> {
    const host = this.deps.remote(machine)
    return host.probe().finally(() => void host.detach())
  }

  /** Leaves every machine's agents running: quitting here never stops another computer's. */
  async detachRemotes(): Promise<void> {
    const all = [...this.remotes.values()]
    this.remotes.clear()
    await Promise.all(all.map((r) => r.host.detach()))
  }

  private hostOf(paneId: string): PaneHost | null {
    const machineId = this.deps.machineOf(paneId)
    return machineId ? this.remoteHost(machineId) : this.deps.local
  }

  private remoteHost(machineId: string): PaneHost | null {
    const machine = this.deps.machine(machineId)
    if (!machine) return null
    const cur = this.remotes.get(machineId)
    if (cur && cur.sshHost === machine.sshHost) return cur.host
    // A machine pointed at another host: drop the old link (its agents keep running).
    if (cur) void cur.host.detach()
    const host = this.deps.remote(machine)
    this.remotes.set(machineId, { host, sshHost: machine.sshHost })
    return host
  }
}
