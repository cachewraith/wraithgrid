import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_EARLIER, MAX_NOTE_CHARS, ReleaseNotesStore } from '../../src/main/release-notes'
import { parseRelease } from '../../src/main/update-check'
import {
  NOTES_FOOTER_MARKER,
  cleanReleaseBody,
  parseWhatsNew,
  releasePageUrl,
  type ReleaseNote
} from '../../src/shared/whats-new'

const MD = `# What's new in 1.12: attach files, delete chats

*v1.12.0 · 2026-10-22*

| Feature | How |
|---|---|
| Attach | The paperclip |

- Diagrams draw whole.

---

## Previously, in 1.11: chat, themes and usage

*v1.11.1 · 2026-10-22*

Chat panes.

---

## Previously, in 1.10: agents that keep running

*v1.10.0 · 2026-10-20*

Agents keep running.

---

## At a glance

Details that belong to 1.10.
`

describe('WHATS-NEW.md sections', () => {
  it('splits per version with title, date and notes; rules dropped', () => {
    const notes = parseWhatsNew(MD)
    expect(notes.map((n) => [n.version, n.title, n.date])).toEqual([
      ['1.12.0', 'attach files, delete chats', '2026-10-22'],
      ['1.11.1', 'chat, themes and usage', '2026-10-22'],
      ['1.10.0', 'agents that keep running', '2026-10-20']
    ])
    expect(notes[0]!.notes).toContain('| Attach | The paperclip |')
    expect(notes[0]!.notes).toContain('- Diagrams draw whole.')
    expect(notes[0]!.notes.split('\n')).not.toContain('---')
    expect(notes[1]!.notes).toBe('Chat panes.')
    // A heading without a version line belongs to the section above it.
    expect(notes[2]!.notes).toContain('## At a glance')
  })

  it('parses the real file: newest first, every section has notes', () => {
    const real = fs.readFileSync(path.join(__dirname, '../../docs/WHATS-NEW.md'), 'utf8')
    const notes = parseWhatsNew(real)
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n.notes.length).toBeGreaterThan(20)
  })

  it('cuts GitHub bodies at the footer marker and caps them', () => {
    const body = `Notes\r\n\r\n${NOTES_FOOTER_MARKER}\r\n## What's Changed\r\n* PR by @x`
    expect(cleanReleaseBody(body, 100)).toBe('Notes')
    expect(cleanReleaseBody('x'.repeat(50), 10)).toBe('x'.repeat(10))
    expect(
      parseRelease({ tag_name: 'v1.13.0', body: `New\n${NOTES_FOOTER_MARKER}\nfooter` })?.notes
    ).toBe('New')
  })

  it('builds release page links from the fixed repo', () => {
    expect(releasePageUrl('1.12.0')).toBe(
      'https://github.com/cachewraith/wraithgrid/releases/tag/v1.12.0'
    )
  })
})

describe('ReleaseNotesStore', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-notes-')), 'notes.json')
  const note = (version: string, notes = `notes ${version}`): ReleaseNote => ({
    version,
    title: '',
    date: null,
    notes
  })
  const store = (file: string, currentVersion: string, bundled: ReleaseNote[] = []) =>
    new ReleaseNotesStore({ file, currentVersion, bundled })

  it('says "updated" once, only after an older version ran', async () => {
    const file = tmp()
    const fresh = store(file, '1.11.1')
    await fresh.start()
    expect(fresh.view().updatedFrom).toBeNull() // a new install is not an update

    const updated = store(file, '1.12.0')
    await updated.start()
    expect(updated.view().updatedFrom).toBe('1.11.1')

    const again = store(file, '1.12.0')
    await again.start()
    expect(again.view().updatedFrom).toBeNull()
  })

  it('keeps notes found by a check for after the update; bundled notes win', async () => {
    const file = tmp()
    const before = store(file, '1.11.1', [note('1.11.1', 'bundled 1.11.1')])
    await before.start()
    await before.remember({
      version: '1.12.0',
      url: releasePageUrl('1.12.0'),
      notes: 'from GitHub',
      publishedAt: '2026-10-22T10:00:00Z'
    })
    // Not installed yet: About lists only versions up to the installed one.
    expect(before.view().installed?.notes).toBe('bundled 1.11.1')
    expect(before.view().earlier).toEqual([])

    const after = store(file, '1.12.0', [note('1.11.1', 'bundled 1.11.1')])
    await after.start()
    const v = after.view()
    expect(v.installed).toMatchObject({ version: '1.12.0', notes: 'from GitHub' })
    expect(v.earlier.map((n) => n.version)).toEqual(['1.11.1'])

    const bundledToo = store(file, '1.12.0', [note('1.12.0', 'bundled 1.12.0')])
    await bundledToo.start()
    expect(bundledToo.view().installed?.notes).toBe('bundled 1.12.0')
  })

  it('caps versions and characters, and ignores a broken file', async () => {
    const file = tmp()
    const s = store(file, '9.0.0')
    await s.start()
    for (let i = 0; i < 20; i++) {
      await s.remember({
        version: `1.${i}.0`,
        url: '',
        notes: 'y'.repeat(MAX_NOTE_CHARS + 50),
        publishedAt: null
      })
    }
    const v = s.view()
    expect(v.earlier).toHaveLength(MAX_EARLIER)
    expect(v.earlier[0]!.version).toBe('1.19.0')
    expect(v.earlier[0]!.notes).toHaveLength(MAX_NOTE_CHARS)
    expect(fs.statSync(file).size).toBeLessThan((MAX_EARLIER + 3) * (MAX_NOTE_CHARS + 200))

    fs.writeFileSync(file, '{not json')
    const broken = store(file, '9.0.0', [note('9.0.0')])
    await broken.start()
    expect(broken.view()).toMatchObject({ installed: { version: '9.0.0' }, earlier: [] })
  })
})
