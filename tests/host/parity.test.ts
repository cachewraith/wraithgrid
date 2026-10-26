// The Rust host must behave like the Node host (ADR 0004 §6): every scenario here runs
// against both, with the same expectations, and every screen fixture restored on attach must
// draw the same as the screen did live. Needs `bun run build` and the release binary
// (`bun run test:host` does both).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  APP_VERSION,
  Client,
  type HostProcess,
  RUST_BIN,
  draw,
  shPane,
  sleep,
  startHost,
  until,
  type Kind
} from './harness'

const KINDS: Kind[] = ['node', 'rust']
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'wgp-fixtures-'))

describe.skipIf(process.platform === 'win32' || !fs.existsSync(RUST_BIN))('host parity', () => {
  const hosts = new Map<Kind, HostProcess>()
  beforeAll(async () => {
    for (const k of KINDS) hosts.set(k, await startHost(k))
  }, 30_000)
  afterAll(async () => {
    for (const h of hosts.values()) await h.stop()
    fs.rmSync(FIXTURES, { recursive: true, force: true })
  })
  const host = (k: Kind): HostProcess => hosts.get(k)!

  describe.each(KINDS)('%s host', (kind) => {
    it('welcomes the right token and refuses others', async () => {
      const bad = await Client.connect(host(kind))
      bad.send({ t: 'hello', protocol: 1, appVersion: '1', token: 'nope' })
      expect(await bad.frame((f) => f.t === 'refused')).toEqual({
        t: 'refused',
        error: 'bad token'
      })
      await until(() => bad.closed, 3000, 'refused client to close')

      const cli = await Client.connect(host(kind))
      cli.send({ t: 'hello', protocol: 1, appVersion: '1', token: host(kind).token, role: 'cli' })
      expect(await cli.frame((f) => f.t === 'refused')).toEqual({
        t: 'refused',
        error: 'Command-line access is off. Turn it on in Wraithgrid: Settings → Command line.'
      })

      const gui = await Client.open(host(kind))
      expect(gui.frames[0]).toMatchObject({ t: 'welcome', protocol: 1, appVersion: APP_VERSION })
      expect(gui.frames[0]!.pid).toBe(host(kind).proc.pid)
      gui.close()
    })

    it('drops a client that sends something that is not a frame', async () => {
      const c = await Client.open(host(kind))
      c.send({ t: 'nope', id: 1 })
      await until(() => c.closed, 3000, 'invalid client to close')
      const d = await Client.open(host(kind))
      d.raw('not json\n')
      await until(() => d.closed, 3000, 'garbage client to close')
    })

    it('runs a pane with the GUI’s environment and TERM, reads it, lists it, kills it', async () => {
      const c = await Client.open(host(kind))
      const r = await c.request(
        shPane(
          'env1',
          'printf "hello\\nworld\\n"; echo "TERM=$TERM TMUX=[$TMUX] COLS=[$COLUMNS] KEEP=$KEEP"; sleep 30',
          { cols: 60, rows: 10 },
          { TMUX: '/tmp/x', COLUMNS: '33', KEEP: 'yes', TERM: 'dumb' }
        )
      )
      expect(r).toMatchObject({ ok: true })
      expect(typeof r.pid).toBe('number')
      const text = await until(async () => {
        const t = (await c.request({ t: 'read', paneId: 'env1' })) as { text: string }
        return t.text.includes('KEEP') ? t.text : null
      })
      // The env is the GUI's as given (pane-env.ts strips terminal variables); only TERM is set.
      expect(text).toBe('hello\nworld\nTERM=xterm-256color TMUX=[/tmp/x] COLS=[33] KEEP=yes')
      expect(c.output.get('env1')).toContain('hello\r\nworld\r\n')

      const list = (await c.request({ t: 'list' })) as { panes: Record<string, unknown>[] }
      expect(list.panes.find((p) => p.paneId === 'env1')).toMatchObject({
        paneId: 'env1',
        pid: r.pid,
        exit: null
      })
      c.send({ t: 'kill', paneId: 'env1' })
      await sleep(300)
      const after = (await c.request({ t: 'list' })) as { panes: { paneId: string }[] }
      expect(after.panes.map((p) => p.paneId)).not.toContain('env1')
      // A killed pane reports no exit.
      expect(c.frames.some((f) => f.t === 'exit' && f.paneId === 'env1')).toBe(false)
      c.close()
    })

    it('types into a pane, and a write right after create reaches it', async () => {
      const c = await Client.open(host(kind))
      c.send({ ...shPane('cat1', 'stty -echo; cat'), id: 900 })
      c.send({ t: 'write', paneId: 'cat1', data: 'typed early\r' })
      await c.frame((f) => f.t === 'reply' && f.id === 900)
      c.send({ t: 'write', paneId: 'cat1', data: 'ünïcødé 日本\r' })
      await until(() => c.output.get('cat1')?.includes('日本'), 5000, 'echo')
      expect(c.output.get('cat1')).toContain('typed early')
      c.send({ t: 'kill', paneId: 'cat1' })
      c.close()
    })

    it('resizes the pty and the screen', async () => {
      const c = await Client.open(host(kind))
      await c.request(
        shPane('size1', 'trap "stty size" WINCH; stty size; while :; do sleep 0.05; done', {
          cols: 40,
          rows: 12
        })
      )
      await until(() => c.output.get('size1')?.includes('12 40'), 5000, 'first size')
      c.send({ t: 'resize', paneId: 'size1', cols: 100, rows: 30 })
      await until(() => c.output.get('size1')?.includes('30 100'), 5000, 'new size')
      c.send({ t: 'kill', paneId: 'size1' })
      c.close()
    })

    it('reports exit codes and signals like node-pty', async () => {
      const c = await Client.open(host(kind))
      await c.request(shPane('code3', 'echo bye; exit 3'))
      expect(await c.frame((f) => f.t === 'exit' && f.paneId === 'code3')).toEqual({
        t: 'exit',
        paneId: 'code3',
        exitCode: 3,
        signal: 0
      })
      expect(c.output.get('code3')).toContain('bye')
      await c.request(shPane('sig15', 'kill -TERM $$'))
      expect(await c.frame((f) => f.t === 'exit' && f.paneId === 'sig15')).toEqual({
        t: 'exit',
        paneId: 'sig15',
        exitCode: 0,
        signal: 15
      })
      // The window saw it end: the pane is gone.
      expect(await c.request({ t: 'read', paneId: 'code3' })).toEqual({
        ok: false,
        error: 'No pane code3 is running.',
        missing: true
      })
      c.close()
    })

    it('keeps an exit nobody saw for the next attach, with its screen', async () => {
      const a = await Client.open(host(kind))
      await a.request(shPane('later', 'sleep 0.5; echo "last words"; exit 5'))
      a.close()
      await sleep(1500)
      const b = await Client.open(host(kind))
      const r = await b.request({ t: 'attach', paneId: 'later', cols: 40, rows: 12 })
      expect(r).toMatchObject({ ok: true, attached: true, exit: { exitCode: 5, signal: 0 } })
      const replay = b.frames.find((f) => f.t === 'data' && f.paneId === 'later')
      expect(replay).toMatchObject({ replay: true })
      expect(String(replay!.data)).toContain('last words')
      // The window has seen it now: gone.
      expect(await b.request({ t: 'attach', paneId: 'later', cols: 40, rows: 12 })).toEqual({
        ok: false,
        error: 'Not running',
        missing: true
      })
      b.close()
    })

    it('waits for a state, and times out with the state it saw', async () => {
      const c = await Client.open(host(kind))
      await c.request(shPane('w1', 'sleep 0.4'))
      expect(
        await c.request({ t: 'wait', paneId: 'w1', until: 'exited', timeoutMs: 5000 })
      ).toEqual({ ok: true, state: 'exited' })
      await c.request(shPane('w2', 'echo hi; sleep 30'))
      expect(
        await c.request({ t: 'wait', paneId: 'w2', until: 'idle', quietMs: 200, timeoutMs: 5000 })
      ).toEqual({ ok: true, state: 'idle' })
      expect(await c.request({ t: 'wait', paneId: 'w2', until: 'exited', timeoutMs: 300 })).toEqual(
        { ok: false, error: 'Timed out; the pane is idle.' }
      )
      expect(await c.request({ t: 'wait', paneId: 'nope', until: 'idle', timeoutMs: 300 })).toEqual(
        { ok: false, error: 'No pane nope is running.', missing: true }
      )
      c.send({ t: 'kill', paneId: 'w2' })
      c.close()
    })

    it('says blocked when the approval pattern is on screen', async () => {
      const c = await Client.open(host(kind))
      const req = shPane('ap1', 'echo "Do you want to proceed?"; sleep 30')
      ;(req.req as Record<string, unknown>).approval = 'do you want to proceed'
      await c.request(req)
      await until(() => c.output.get('ap1')?.includes('proceed'), 5000, 'prompt')
      const list = (await c.request({ t: 'list' })) as {
        panes: { paneId: string; state: string }[]
      }
      expect(list.panes.find((p) => p.paneId === 'ap1')?.state).toBe('blocked')
      c.send({ t: 'kill', paneId: 'ap1' })
      c.close()
    })

    it('relays window commands from the command line, and keeps the rest to the window', async () => {
      const gui = await Client.open(host(kind))
      gui.send({ t: 'config', cliAccess: true })
      await sleep(100)
      const cli = await Client.open(host(kind), 'cli')
      expect(await cli.request({ t: 'spawn', spec: {} })).toEqual({
        ok: false,
        error: 'Only the Wraithgrid window may do that.'
      })
      expect(await cli.request(shPane('nope', 'true'))).toEqual({
        ok: false,
        error: 'Only the Wraithgrid window may do that.'
      })
      const pending = cli.request({ t: 'gui', action: { kind: 'new', cwd: '/tmp' } })
      const relayed = await gui.frame((f) => f.t === 'gui')
      expect(relayed.action).toEqual({ kind: 'new', cwd: '/tmp' })
      gui.send({ t: 'guiReply', id: relayed.id, reply: { ok: true, paneId: 'p9' } })
      expect(await pending).toEqual({ ok: true, result: { ok: true, paneId: 'p9' } })
      const refused = cli.request({ t: 'gui', action: { kind: 'x' } })
      const second = await gui.frame((f) => f.t === 'gui' && f.id !== relayed.id)
      gui.send({ t: 'guiReply', id: second.id, reply: { ok: false, error: 'No.' } })
      expect(await refused).toEqual({ ok: false, error: 'No.' })
      expect(await gui.request({ t: 'spawn', spec: {} })).toEqual({
        ok: false,
        error: 'Remote panes are started through wraithgrid host-stdio.'
      })
      gui.send({ t: 'config', cliAccess: false })
      cli.close()
      gui.close()
    })
  })

  // ---- Screens restored on attach draw the same as they did live.
  const ESC = '\x1b'
  const lines = (n: number, f: (i: number) => string): string =>
    Array.from({ length: n }, (_, i) => f(i)).join('\r\n')
  const FIXTURE_SET: Record<string, string> = {
    plain: 'first line\r\nsecond line\r\n  indented\r\nlast',
    colours:
      lines(8, (i) => `${ESC}[3${i}mfg${i}${ESC}[0m ${ESC}[4${i}mbg${i}${ESC}[0m`) +
      `\r\n${ESC}[38;5;202m256${ESC}[48;5;22m on${ESC}[0m ${ESC}[38;2;10;200;30mtrue${ESC}[0m`,
    attributes: `${ESC}[1mbold${ESC}[0m ${ESC}[2mdim${ESC}[0m ${ESC}[3mitalic${ESC}[0m ${ESC}[4munder${ESC}[0m ${ESC}[7minverse${ESC}[0m ${ESC}[1;3;4;31mmixed${ESC}[0m`,
    wide: '日本語テキスト\r\n😀 emoji 🙂 ok\r\nmix 中文 and text',
    wrapped: `${'0123456789'.repeat(12)}\r\nnext`,
    'cursor and erase': `aaaaaaaaaa\r\nbbbbbbbbbb\r\ncccccccccc${ESC}[2;3H${ESC}[K${ESC}[1;5H${ESC}[1K${ESC}[3;1HX`,
    'scroll region': `top\r\n${ESC}[3;6r${ESC}[3;1H${lines(9, (i) => `region ${i}`)}${ESC}[r${ESC}[10;1Hbelow`,
    scrollback: lines(300, (i) => `scroll line ${i}`),
    'past the scrollback cap': lines(5100, (i) => `cap ${i}`),
    'cleared after scrollback': `${lines(60, (i) => `old ${i}`)}${ESC}[2J${ESC}[Htop line\r\nsecond`,
    'cursor above blank rows': `${lines(40, (i) => `log ${i}`)}\r\n\r\n\r\n${ESC}[3Aprompt> `,
    'modes and hidden cursor': `modes${ESC}[?2004h${ESC}[?1h${ESC}=${ESC}[?25l${ESC}[5;7H`,
    'alternate screen': `under${ESC}[?1049h${ESC}[2;3Halt screen text${ESC}[5;1H${ESC}[1mbold alt${ESC}[0m`
  }

  describe.each(Object.keys(FIXTURE_SET))('screen: %s', (name) => {
    it('restores on attach like it drew live, on both hosts', async () => {
      const file = path.join(FIXTURES, `${name.replace(/\W/g, '_')}.txt`)
      fs.writeFileSync(file, FIXTURE_SET[name]!)
      const size = { cols: 40, rows: 12 }
      const drawn: Record<string, Awaited<ReturnType<typeof draw>>> = {}
      for (const kind of KINDS) {
        const live = await Client.open(host(kind))
        const paneId = `fx${Math.random().toString(36).slice(2, 8)}`
        await live.request(
          shPane(paneId, `stty -onlcr; cat ${JSON.stringify(file)}; sleep 30`, size)
        )
        // Settled: the output stopped growing.
        let last = -1
        await until(
          async () => {
            const n = live.output.get(paneId)?.length ?? 0
            const done = n > 0 && n === last
            last = n
            await sleep(150)
            return done
          },
          15_000,
          'output to settle'
        )
        const truth = await draw(live.output.get(paneId)!, size.cols, size.rows)
        const other = await Client.open(host(kind))
        await other.request({ t: 'attach', paneId, ...size })
        const replay = other.frames
          .filter((f) => f.t === 'data' && f.paneId === paneId && f.replay)
          .map((f) => String(f.data))
          .join('')
        const restored = await draw(replay, size.cols, size.rows)
        drawn[`${kind}:truth`] = truth
        drawn[kind] = restored
        live.send({ t: 'kill', paneId })
        live.close()
        other.close()
      }
      for (const kind of KINDS) {
        const truth = drawn[`${kind}:truth`]!
        const restored = drawn[kind]!
        expect(restored.buffer, `${kind} buffer`).toBe(truth.buffer)
        expect(restored.cursor, `${kind} cursor`).toEqual(truth.cursor)
        expect(restored.modes, `${kind} modes`).toEqual(truth.modes)
        expect(restored.lines, `${kind} cells`).toEqual(truth.lines)
      }
    }, 60_000)
  })

  // xterm reflows the normal buffer on resize; the Rust host must keep the same text and
  // cursor through a window resizing a pane (background.spec found the gap).
  const RESIZES: Record<string, [number, number][]> = {
    'narrower then back': [
      [20, 12],
      [40, 12]
    ],
    'much narrower then wider': [
      [7, 6],
      [60, 15]
    ],
    'fewer rows then more': [
      [40, 4],
      [40, 20]
    ],
    'collapsed to 1x1 then back': [
      [1, 1],
      [40, 12]
    ],
    'wider then narrower': [
      [90, 12],
      [25, 12]
    ]
  }
  describe.each(Object.keys(RESIZES))('resize: %s', (name) => {
    it('keeps the same text, cells and cursor as the Node host', async () => {
      const file = path.join(FIXTURES, 'resize.txt')
      fs.writeFileSync(
        file,
        `short\r\n${ESC}[1mbold${ESC}[0m line\r\n${'long wrapped text '.repeat(6)}\r\n` +
          `${ESC}[32mgreen${ESC}[0m and more\r\n$ prompt`
      )
      const steps = RESIZES[name]!
      const result: Record<string, { text: string; drawn: Awaited<ReturnType<typeof draw>> }> = {}
      for (const kind of KINDS) {
        const c = await Client.open(host(kind))
        const paneId = `rz${kind}${Math.random().toString(36).slice(2, 6)}`
        await c.request(shPane(paneId, `stty -onlcr; cat ${JSON.stringify(file)}; sleep 30`))
        await until(() => c.output.get(paneId)?.includes('prompt'), 5000, 'output')
        await sleep(200)
        for (const [cols, rows] of steps) {
          c.send({ t: 'resize', paneId, cols, rows })
          await sleep(100)
        }
        const [cols, rows] = steps[steps.length - 1]!
        const text = (await c.request({ t: 'read', paneId, lines: 200 })) as { text: string }
        const other = await Client.open(host(kind))
        await other.request({ t: 'attach', paneId, cols, rows })
        const replay = other.frames
          .filter((f) => f.t === 'data' && f.paneId === paneId && f.replay)
          .map((f) => String(f.data))
          .join('')
        result[kind] = { text: text.text, drawn: await draw(replay, cols, rows) }
        c.send({ t: 'kill', paneId })
        c.close()
        other.close()
      }
      const node = result.node!
      const rust = result.rust!
      const nodeLines = node.text.split('\n')
      const rustLines = rust.text.split('\n')
      // Every line but the cursor's is the same, row for row and cell for cell.
      expect(rustLines.slice(0, -1)).toEqual(nodeLines.slice(0, -1))
      expect(rust.drawn.lines.slice(0, -1)).toEqual(node.drawn.lines.slice(0, -1))
      expect(rust.drawn.cursor[1]).toBe(node.drawn.cursor[1])
      // ADR 0004, known differences: xterm cuts the cursor's line when it reflows a much
      // narrower width; the Rust host keeps the whole line, with the cursor after its text.
      expect(rustLines.at(-1)!.startsWith(nodeLines.at(-1)!)).toBe(true)
      expect(rust.drawn.cursor[0]).toBe(rustLines.at(-1)!.length)
    })
  })

  // #134: a screen far over MAX_FRAME as one frame arrives in pieces every client can read.
  it('big screen: restored in frames under the 4 MB limit, drawn the same', async () => {
    const file = path.join(FIXTURES, 'big.txt')
    const row = (i: number): string =>
      Array.from(
        { length: 60 },
        (_, k) => `${ESC}[48;5;${(i + k) % 256}m${ESC}[38;5;${(k * 7) % 256}mab`
      ).join('') + `${ESC}[0m`
    fs.writeFileSync(file, lines(5000, row))
    const size = { cols: 200, rows: 50 }
    for (const kind of KINDS) {
      const live = await Client.open(host(kind))
      const paneId = `big${kind}`
      await live.request(shPane(paneId, `stty -onlcr; cat ${JSON.stringify(file)}; sleep 30`, size))
      let last = -1
      await until(
        async () => {
          const n = live.output.get(paneId)?.length ?? 0
          const done = n > 0 && n === last
          last = n
          await sleep(300)
          return done
        },
        30_000,
        'big output to settle'
      )
      const other = await Client.open(host(kind))
      await other.request({ t: 'attach', paneId, ...size }, 30_000)
      const parts = other.frames.filter((f) => f.t === 'data' && f.paneId === paneId && f.replay)
      const replay = parts.map((f) => String(f.data)).join('')
      expect(
        JSON.stringify(replay).length,
        `${kind} would have been one oversized frame`
      ).toBeGreaterThan(4 * 1024 * 1024)
      expect(parts.length, `${kind} pieces`).toBeGreaterThan(1)
      expect(other.maxLine, `${kind} largest frame`).toBeLessThan(4 * 1024 * 1024)
      const [truth, restored] = await Promise.all([
        draw(live.output.get(paneId)!, size.cols, size.rows),
        draw(replay, size.cols, size.rows)
      ])
      expect(restored.lines, `${kind} cells`).toEqual(truth.lines)
      expect(restored.cursor).toEqual(truth.cursor)
      live.send({ t: 'kill', paneId })
      live.close()
      other.close()
    }
  }, 120_000)

  // ADR 0004, known differences: vt100 keeps only the active buffer, so the normal buffer under
  // a full-screen program is not restored by the Rust host. Pinned so a change is noticed.
  it('alternate screen: leaving it after a restore shows the normal buffer (Node) or a blank (Rust)', async () => {
    const file = path.join(FIXTURES, 'alt_leave.txt')
    fs.writeFileSync(file, FIXTURE_SET['alternate screen']!)
    const size = { cols: 40, rows: 12 }
    const under: Record<string, string> = {}
    for (const kind of KINDS) {
      const live = await Client.open(host(kind))
      const paneId = `alt${kind}`
      await live.request(shPane(paneId, `stty -onlcr; cat ${JSON.stringify(file)}; sleep 30`, size))
      await until(() => live.output.get(paneId)?.includes('bold alt'), 5000, 'alt output')
      await sleep(300)
      const other = await Client.open(host(kind))
      await other.request({ t: 'attach', paneId, ...size })
      const replay = other.frames
        .filter((f) => f.t === 'data' && f.paneId === paneId && f.replay)
        .map((f) => String(f.data))
        .join('')
      const left = await draw(replay + '\x1b[?1049l', size.cols, size.rows)
      under[kind] = left.lines.join('\n')
      live.send({ t: 'kill', paneId })
      live.close()
      other.close()
    }
    expect(under.node).toContain('u|1|')
    expect(under.rust).not.toContain('u|1|')
  })
})
