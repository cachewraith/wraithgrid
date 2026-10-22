// Prints a version's section of docs/WHATS-NEW.md as a GitHub release body, so the release
// page says what the app's About says. Exits 1 when the file has no section for it (the
// workflow then falls back to GitHub's generated notes). Run with bun:
//   bun scripts/release-notes.ts v1.12.0 > notes.md
import fs from 'node:fs'
import path from 'node:path'
import { parseWhatsNew } from '../src/shared/whats-new'

const tag = process.argv[2] ?? ''
const version = tag.replace(/^v/, '')
const md = fs.readFileSync(path.join(import.meta.dirname, '../docs/WHATS-NEW.md'), 'utf8')
const note = parseWhatsNew(md).find((n) => n.version === version)
if (!note) {
  console.error(`docs/WHATS-NEW.md has no section for ${version}`)
  process.exit(1)
}
const title = note.title.charAt(0).toUpperCase() + note.title.slice(1)
process.stdout.write(`## ${title}\n\n${note.notes}\n`)
