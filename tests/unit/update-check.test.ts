import { describe, expect, it, vi } from 'vitest'
import {
  UpdateChecker,
  compareVersions,
  parseRelease,
  parseVersion,
  type Fetch
} from '../../src/main/update-check'

const v = (s: string) => parseVersion(s)!

describe('versions', () => {
  it('parses tags with or without a v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('1.2.3-beta.1+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: ['beta', '1']
    })
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3; rm -rf /')).toBeNull()
  })

  it('orders by semver precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
      '10.0.0'
    ]
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(v(ordered[i - 1]!), v(ordered[i]!))).toBeLessThan(0)
      expect(compareVersions(v(ordered[i]!), v(ordered[i - 1]!))).toBeGreaterThan(0)
    }
    expect(compareVersions(v('v1.2.3'), v('1.2.3'))).toBe(0)
  })
})

describe('parseRelease', () => {
  it('builds the release URL from the tag and ignores html_url', () => {
    const r = parseRelease({
      tag_name: 'v1.2.0',
      html_url: 'https://evil.example/phish',
      body: '## What changed\r\n* faster',
      published_at: '2026-09-01T10:00:00Z'
    })
    expect(r).toEqual({
      version: '1.2.0',
      url: 'https://github.com/cachewraith/wraithgrid/releases/tag/v1.2.0',
      notes: '## What changed\n* faster',
      publishedAt: '2026-09-01T10:00:00Z'
    })
  })

  it('rejects drafts, odd tags and junk', () => {
    expect(parseRelease({ tag_name: 'v1.2.0', draft: true })).toBeNull()
    expect(parseRelease({ tag_name: 'nightly' })).toBeNull()
    expect(parseRelease({ tag_name: '../../x' })).toBeNull()
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease({})).toBeNull()
  })

  it('caps long release notes', () => {
    const r = parseRelease({ tag_name: 'v2.0.0', body: 'x'.repeat(50_000) })
    expect(r!.notes.length).toBe(4000)
  })
})

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function checker(fetch: Fetch, current = '1.0.0', now = () => 1_000_000) {
  return new UpdateChecker({ currentVersion: current, fetch, now })
}

describe('UpdateChecker', () => {
  it('reports a newer release', async () => {
    const fetch = vi.fn<Fetch>(async () => reply(200, { tag_name: 'v1.1.0', body: 'notes' }))
    const r = await checker(fetch).check()
    expect(r.status).toBe('available')
    expect(r.status === 'available' && r.latest.version).toBe('1.1.0')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.github.com/repos/cachewraith/wraithgrid/releases/latest')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('says current when the release is the same or older', async () => {
    expect((await checker(async () => reply(200, { tag_name: 'v1.0.0' })).check()).status).toBe(
      'current'
    )
    expect(
      (await checker(async () => reply(200, { tag_name: 'v0.9.0' }), '1.0.0').check()).status
    ).toBe('current')
  })

  it('treats the final release as newer than a prerelease build', async () => {
    const r = await checker(async () => reply(200, { tag_name: 'v1.0.0' }), '1.0.0-rc.1').check()
    expect(r.status).toBe('available')
  })

  it.each([
    [404, 'No release has been published yet.'],
    [403, 'GitHub is rate-limiting update checks. Try again in a while.'],
    [429, 'GitHub is rate-limiting update checks. Try again in a while.'],
    [500, 'GitHub answered with status 500.']
  ])('explains HTTP %i', async (status, error) => {
    const r = await checker(async () => reply(status, {})).check()
    expect(r).toMatchObject({ status: 'error', error })
  })

  it('fails closed on a network error or a malformed answer', async () => {
    const offline = await checker(async () => {
      throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
    }).check()
    expect(offline).toMatchObject({
      status: 'error',
      error: 'Could not reach GitHub. Check your connection.'
    })
    const junk = await checker(async () => reply(200, '<html>')).check()
    expect(junk).toMatchObject({ status: 'error', error: 'GitHub sent an unexpected answer.' })
  })

  it('shares one request between concurrent calls and throttles repeats', async () => {
    let t = 1_000_000
    const fetch = vi.fn<Fetch>(async () => reply(200, { tag_name: 'v1.1.0' }))
    const c = checker(fetch, '1.0.0', () => t)
    const [a, b] = await Promise.all([c.check(), c.check()])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 5_000
    await c.check()
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 30_000
    await c.check()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
