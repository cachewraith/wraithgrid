import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { LoginEvent } from '@shared/ipc-contract'
import { loginCodeArgs } from '@shared/ipc-contract'
import type { ChatChild, ChatLaunch } from '../../src/main/chat/sessions'
import { Logins, loginUrl, parseAuthStatus } from '../../src/main/login'

// What claude 2.1.306 prints for `claude auth login` over pipes (query cut).
const OUTPUT =
  'Opening browser to sign in…\n' +
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x\n" +
  'Paste code here if prompted > '

function fakeChild(): ChatChild & {
  stdout: PassThrough
  exit(code: number): void
  input: string[]
  killed: boolean
} {
  const ev = new EventEmitter()
  const stdin = new PassThrough()
  const input: string[] = []
  stdin.on('data', (d: Buffer) => input.push(d.toString()))
  const c = {
    pid: 1,
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    input,
    killed: false,
    kill() {
      c.killed = true
      ev.emit('exit', null, 'SIGTERM')
      return true
    },
    once: (e: string, cb: (...a: never[]) => void) => ev.once(e, cb as never),
    exit: (code: number) => ev.emit('exit', code, null)
  }
  return c as never
}

const launch: ChatLaunch = { file: 'claude', args: [], cwd: '/', env: {} }
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('sign-in dialog (claude auth login)', () => {
  it('passes on only an https link of Anthropic’s', () => {
    expect(loginUrl(OUTPUT)).toBe('https://claude.com/cai/oauth/authorize?code=true&client_id=x')
    expect(loginUrl('visit: https://evil.example/claude.com')).toBeNull()
    expect(loginUrl('visit: http://claude.com/x')).toBeNull()
    expect(loginUrl('https://console.anthropic.com/oauth')).toBe(
      'https://console.anthropic.com/oauth'
    )
  })

  it('reads auth status', () => {
    expect(parseAuthStatus('{"loggedIn":true,"email":"a@b.c","subscriptionType":"max"}')).toEqual({
      loggedIn: true,
      email: 'a@b.c',
      plan: 'max'
    })
    expect(parseAuthStatus('nope')).toEqual({ loggedIn: false, email: null, plan: null })
  })

  it('a code is one printable token: no spaces or line breaks', () => {
    expect(loginCodeArgs.safeParse({ accountId: 'a1', code: 'abc#DEF-1' }).success).toBe(true)
    expect(loginCodeArgs.safeParse({ accountId: 'a1', code: 'a\nb' }).success).toBe(false)
    expect(loginCodeArgs.safeParse({ accountId: 'a1', code: 'a b' }).success).toBe(false)
  })

  it('link, code, then who is signed in; a failure says claude’s last line', async () => {
    const events: LoginEvent[] = []
    let child = fakeChild()
    let status = '{"loggedIn":true,"email":"a@b.c","subscriptionType":"pro"}'
    const logins = new Logins({
      spawn: () => child,
      run: async () => status,
      emit: (e) => events.push(e)
    })
    logins.start('a1', launch, launch)
    child.stdout.write(OUTPUT)
    await tick()
    expect(events).toEqual([{ accountId: 'a1', state: 'url', url: expect.any(String) }])
    expect(logins.code('a1', 'abc#1')).toBe(true)
    await tick()
    expect(child.input).toEqual(['abc#1\n'])
    child.exit(0)
    await tick()
    expect(events.at(-1)).toEqual({
      accountId: 'a1',
      state: 'done',
      ok: true,
      email: 'a@b.c',
      plan: 'pro',
      error: null
    })

    child = fakeChild()
    status = '{"loggedIn":false}'
    logins.start('a1', launch, launch)
    child.stdout.write(`${OUTPUT}Invalid code\n`)
    child.exit(1)
    await tick()
    await tick()
    expect(events.at(-1)).toMatchObject({ state: 'done', ok: false, error: 'Invalid code' })
  })

  it('cancel stops it quietly', async () => {
    const events: LoginEvent[] = []
    const child = fakeChild()
    const logins = new Logins({
      spawn: () => child,
      run: async () => '',
      emit: (e) => events.push(e)
    })
    logins.start('a1', launch, launch)
    logins.cancel('a1')
    await tick()
    expect(child.killed).toBe(true)
    expect(events).toEqual([])
    expect(logins.code('a1', 'x')).toBe(false)
  })
})
