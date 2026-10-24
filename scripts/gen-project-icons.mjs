#!/usr/bin/env node
// Project icons (#80): writes the small, curated part of the icon sets to
// src/renderer/lib/project-icons-extra.json. Material Icon Theme's file icons are imported
// whole (lazily) by the renderer; from devicon only the logos it lacks, and from Material
// Symbols only a short list of general icons, so the app doesn't ship 14 MB of SVG.
// Run again after changing the lists: `node scripts/gen-project-icons.mjs`.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import console from 'node:console'
import process from 'node:process'

const require = createRequire(import.meta.url)
const OUT = path.join(import.meta.dirname, '../src/renderer/lib/project-icons-extra.json')

/** Logos Material Icon Theme has no file icon for. */
const DEVICON = [
  'spring',
  'electron',
  'archlinux',
  'flutter',
  'apple',
  'windows8',
  'ubuntu',
  'debian',
  'fedora',
  'dotnetcore',
  'nextjs'
]

/** General icons (Material Symbols, rounded). */
const SYMBOLS = [
  'folder',
  'desktop-windows',
  'computer',
  'dns',
  'storage',
  'cloud',
  'terminal',
  'code',
  'api',
  'web',
  'sports-esports',
  'school',
  'book',
  'description',
  'shopping-cart',
  'home',
  'work',
  'science',
  'rocket-launch',
  'bug-report',
  'music-note',
  'palette',
  'star',
  'favorite',
  'bolt',
  'lock',
  'chat',
  'smart-toy',
  'monitoring'
]

function pick(pkg, names) {
  const set = require(`${pkg}/icons.json`)
  const icons = {}
  for (const n of names) {
    const icon = set.icons[n]
    if (!icon) throw new Error(`${pkg} has no icon "${n}"`)
    icons[n] = icon
  }
  return { width: set.width ?? 16, height: set.height ?? 16, icons }
}

const out = {
  dev: pick('@iconify-json/devicon', DEVICON),
  ms: pick('@iconify-json/material-symbols', SYMBOLS)
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`)
