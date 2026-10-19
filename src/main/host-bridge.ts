// `wraithgrid host-stdio` (H5): runs on a remote machine, started by the GUI over `ssh`, and
// joins the ssh channel to that machine's background host. ssh already proved who the user
// is, so the bridge puts in the host's token itself. It also turns `spawn` frames into
// `create` ones, resolving the CLI, folder and env on this machine.
import type { Duplex, Readable, Writable } from 'node:stream'
import { FrameReader, encodeFrame, type ClientFrame } from '../host/protocol'
import { spawnSpecSchema, type ResolveResult, type SpawnSpec } from './spawn-resolve'

export interface BridgeDeps {
  input: Readable
  output: Writable
  connectHost: () => Promise<Duplex>
  startHost: () => Promise<void>
  readToken: () => Promise<string>
  resolve: (spec: SpawnSpec) => Promise<ResolveResult>
  startTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function ensureHost(d: BridgeDeps): Promise<Duplex> {
  try {
    return await d.connectHost()
  } catch {
    // None runs on this machine yet.
  }
  await d.startHost()
  const sleep = d.sleep ?? defaultSleep
  const deadline = Date.now() + (d.startTimeoutMs ?? 10_000)
  for (;;) {
    await sleep(100)
    try {
      return await d.connectHost()
    } catch (err) {
      if (Date.now() > deadline) throw err
    }
  }
}

/** Resolves when either side closes. */
export async function runBridge(d: BridgeDeps): Promise<void> {
  const host = await ensureHost(d)
  const token = await d.readToken()
  host.on('error', () => {})
  // Frame by frame, so a reply the bridge writes itself never lands inside a host frame.
  const fromHost = new FrameReader(
    (frame) => d.output.write(JSON.stringify(frame) + '\n'),
    () => host.destroy()
  )
  host.setEncoding?.('utf8')
  host.on('data', (chunk: string | Buffer) => fromHost.push(String(chunk)))

  // One frame at a time, in order: a `spawn` waits for its lookup before later frames go.
  let chain = Promise.resolve()
  let greeted = false
  const forward = async (raw: unknown): Promise<void> => {
    const f = raw as { t?: unknown; id?: unknown; spec?: unknown }
    if (!greeted) {
      greeted = true
      if (f.t !== 'hello') return void host.destroy()
      host.write(encodeFrame({ ...(raw as ClientFrame & { t: 'hello' }), token, role: 'gui' }))
      return
    }
    if (f.t !== 'spawn') return void host.write(JSON.stringify(raw) + '\n')
    const id = typeof f.id === 'number' ? f.id : -1
    const spec = spawnSpecSchema.safeParse(f.spec)
    const resolved: ResolveResult = spec.success
      ? await d.resolve(spec.data)
      : { ok: false, error: 'Invalid pane request' }
    if (resolved.ok) host.write(encodeFrame({ t: 'create', id, req: resolved.req }))
    else
      d.output.write(encodeFrame({ t: 'reply', id, reply: { ok: false, error: resolved.error } }))
  }
  const reader = new FrameReader(
    (raw) => {
      chain = chain.then(() => forward(raw)).catch(() => {})
    },
    () => host.destroy()
  )
  d.input.setEncoding?.('utf8')
  d.input.on('data', (chunk: string | Buffer) => reader.push(String(chunk)))

  await new Promise<void>((resolve) => {
    host.once('close', resolve)
    d.input.once('end', () => {
      host.end()
      resolve()
    })
  })
}
