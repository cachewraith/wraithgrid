// Theme files in ~/.wraithgrid/themes: listed, imported (validated, then written back in a
// normal form, never copied byte for byte), deleted. Only files directly in that folder.
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BUILT_IN_THEMES,
  THEMES_FILE_MAX,
  THEMES_MAX,
  parseThemeFile,
  themeSlug,
  type AppTheme,
  type ThemeFile,
  type ThemeParse
} from '@shared/themes'
import { isStrictlyInside } from './paths'

export interface ThemeProblem {
  file: string
  error: string
}

export interface ThemeList {
  themes: AppTheme[]
  problems: ThemeProblem[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const BUILT_IN_IDS = new Set(BUILT_IN_THEMES.map((t) => t.id))

async function readTheme(file: string): Promise<ThemeParse> {
  const st = await stat(file)
  if (!st.isFile()) return { ok: false, error: 'not a file' }
  if (st.size > THEMES_FILE_MAX) return { ok: false, error: 'larger than 64 KB' }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  return parseThemeFile(raw)
}

export async function listThemes(dir: string): Promise<ThemeList> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return { themes: [], problems: [] }
  }
  const themes: AppTheme[] = []
  const problems: ThemeProblem[] = []
  // Sorted by id: `ocean` before `ocean-2` (by file name `-` sorts before `.`).
  const ids = names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .sort()
    .slice(0, THEMES_MAX)
  for (const id of ids) {
    const name = `${id}.json`
    if (!ID.test(id)) {
      problems.push({ file: name, error: 'file name must be lowercase letters, digits and -' })
      continue
    }
    if (BUILT_IN_IDS.has(id)) {
      problems.push({ file: name, error: 'a built-in theme has this name' })
      continue
    }
    try {
      const r = await readTheme(path.join(dir, name))
      if (r.ok) themes.push({ ...r.theme, id, builtIn: false })
      else problems.push({ file: name, error: r.error })
    } catch (err) {
      problems.push({ file: name, error: (err as Error).message })
    }
  }
  return { themes, problems }
}

export type ThemeImportResult = { ok: true; id: string } | { ok: false; error: string }

/** Validates `src` and writes it into `dir` under a free id made from its name. */
export async function importTheme(src: string, dir: string): Promise<ThemeImportResult> {
  let r: ThemeParse
  try {
    r = await readTheme(src)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  if (!r.ok) return { ok: false, error: `${path.basename(src)}: ${r.error}` }
  return writeNewTheme(r.theme, dir)
}

/** Saves a theme made in the editor: checked like a file, then written under a free id. */
export async function saveTheme(raw: unknown, dir: string): Promise<ThemeImportResult> {
  const r = parseThemeFile(raw)
  if (!r.ok) return { ok: false, error: r.error }
  const text = JSON.stringify(r.theme)
  if (text.length > THEMES_FILE_MAX) return { ok: false, error: 'larger than 64 KB' }
  return writeNewTheme(r.theme, dir)
}

async function writeNewTheme(theme: ThemeFile, dir: string): Promise<ThemeImportResult> {
  await mkdir(dir, { recursive: true })
  const taken = new Set([
    ...BUILT_IN_IDS,
    ...(await readdir(dir)).map((n) => n.replace(/\.json$/, ''))
  ])
  const slug = themeSlug(theme.name).slice(0, 36)
  let id = slug
  for (let i = 2; taken.has(id); i++) id = `${slug}-${i}`
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(theme, null, 2)}\n`)
  return { ok: true, id }
}

export async function deleteTheme(id: string, dir: string): Promise<boolean> {
  if (!ID.test(id) || BUILT_IN_IDS.has(id)) return false
  const file = path.join(dir, `${id}.json`)
  if (!isStrictlyInside(file, dir)) return false
  await unlink(file)
  return true
}
