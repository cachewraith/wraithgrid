import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyCodexRollout, copyTranscript } from '../../src/main/chat/transcript'

const SID = 'bb740a2b-b0b4-422a-b18f-89ef6a25b391'

function setup() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-tx-')), 'accounts')
  const a = path.join(root, 'work')
  const b = path.join(root, 'home')
  const proj = path.join(a, 'projects', '-home-me-proj')
  fs.mkdirSync(proj, { recursive: true })
  fs.mkdirSync(b, { recursive: true })
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), '{"type":"user"}\n')
  fs.mkdirSync(path.join(proj, SID, 'subagents'), { recursive: true })
  fs.writeFileSync(path.join(proj, SID, 'subagents', 'x.jsonl'), 'sub\n')
  return { root, a, b }
}

describe('copying a chat to another account', () => {
  it('copies the conversation (and its subagent files) to the same project folder', async () => {
    const { root, a, b } = setup()
    expect(await copyTranscript(a, b, SID, root)).toEqual({ ok: true })
    const dst = path.join(b, 'projects', '-home-me-proj')
    expect(fs.readFileSync(path.join(dst, `${SID}.jsonl`), 'utf8')).toBe('{"type":"user"}\n')
    expect(fs.readFileSync(path.join(dst, SID, 'subagents', 'x.jsonl'), 'utf8')).toBe('sub\n')
    // The original stays with the first account.
    expect(fs.existsSync(path.join(a, 'projects', '-home-me-proj', `${SID}.jsonl`))).toBe(true)
  })

  it('switching back overwrites the older copy with the newer conversation', async () => {
    const { root, a, b } = setup()
    await copyTranscript(a, b, SID, root)
    const inB = path.join(b, 'projects', '-home-me-proj', `${SID}.jsonl`)
    fs.appendFileSync(inB, '{"type":"assistant"}\n')
    expect(await copyTranscript(b, a, SID, root)).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(a, 'projects', '-home-me-proj', `${SID}.jsonl`), 'utf8')).toBe(
      '{"type":"user"}\n{"type":"assistant"}\n'
    )
  })

  it('refuses dirs outside the accounts folder, bad ids and the same account', async () => {
    const { root, a, b } = setup()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-tx-out-'))
    expect(await copyTranscript(a, outside, SID, root)).toMatchObject({ ok: false })
    expect(await copyTranscript(outside, b, SID, root)).toMatchObject({ ok: false })
    expect(await copyTranscript(root, b, SID, root)).toMatchObject({ ok: false })
    for (const bad of ['../x', 'a/b', '', '..', 'x'.repeat(200)])
      expect(await copyTranscript(a, b, bad, root)).toEqual({
        ok: false,
        error: 'Not a conversation id.'
      })
    expect(await copyTranscript(a, a, SID, root)).toMatchObject({ ok: false })
    expect(fs.existsSync(path.join(outside, 'projects'))).toBe(false)
  })

  it('says so when the conversation file is not there', async () => {
    const { root, a, b } = setup()
    expect(await copyTranscript(b, a, SID, root)).toEqual({
      ok: false,
      error: 'This conversation’s file was not found.'
    })
    expect(await copyTranscript(a, b, 'other-session', root)).toMatchObject({ ok: false })
  })
})

describe('copying a codex chat to another account (#60)', () => {
  const TID = '01a162ae-bfc7-7822-b8f5-0ca9e9ddd3b4'
  const REL = path.join('sessions', '2026', '10', '22', `rollout-2026-10-22T15-16-21-${TID}.jsonl`)
  function codexSetup() {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-cx-')), 'accounts')
    const a = path.join(root, 'org-codex')
    const b = path.join(root, 'infra-codex')
    fs.mkdirSync(path.dirname(path.join(a, REL)), { recursive: true })
    fs.mkdirSync(b, { recursive: true })
    fs.writeFileSync(path.join(a, REL), '{"type":"session_meta"}\n')
    // Another thread the same day must not be taken for it.
    fs.writeFileSync(
      path.join(a, 'sessions/2026/10/22/rollout-2026-10-22T09-00-00-other.jsonl'),
      ''
    )
    return { root, a, b }
  }

  it('copies the rollout file to the same dated folder in the other CODEX_HOME', async () => {
    const { root, a, b } = codexSetup()
    expect(await copyCodexRollout(a, b, TID, root)).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(b, REL), 'utf8')).toBe('{"type":"session_meta"}\n')
    expect(fs.existsSync(path.join(a, REL))).toBe(true)
    expect(fs.readdirSync(path.join(b, 'sessions/2026/10/22'))).toEqual([path.basename(REL)])
  })

  it('refuses dirs outside the accounts folder, bad ids, the same account and a missing file', async () => {
    const { root, a, b } = codexSetup()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-cx-out-'))
    expect(await copyCodexRollout(a, outside, TID, root)).toMatchObject({ ok: false })
    expect(await copyCodexRollout(a, b, '../etc', root)).toEqual({
      ok: false,
      error: 'Not a conversation id.'
    })
    expect(await copyCodexRollout(a, a, TID, root)).toMatchObject({ ok: false })
    expect(await copyCodexRollout(b, a, TID, root)).toEqual({
      ok: false,
      error: 'This conversation’s file was not found.'
    })
  })
})
