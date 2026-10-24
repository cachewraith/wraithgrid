#!/usr/bin/env node
// Offline provider subset (#78); source licences and brand review in docs/PROVIDER-LOGOS.md.
import fs from 'node:fs'
import { URL } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const dev = require('@iconify-json/devicon/icons.json')
const mit = require('@iconify-json/material-icon-theme/icons.json')
const picks = {
  claude: [dev, 'claude'],
  agy: [dev, 'antigravity'],
  cursor: [dev, 'cursor'],
  gemini: [mit, 'gemini-ai'],
  opencode: [mit, 'opencode']
}
const out = {}
for (const [cli, [set, name]] of Object.entries(picks)) {
  const icon = set.icons[name]
  if (!icon) throw new Error(`Missing provider logo: ${name}`)
  out[cli] = { width: set.width ?? 16, height: set.height ?? 16, ...icon }
  if (cli === 'cursor') out[cli].body = out[cli].body.replaceAll('#555', 'currentColor')
}
fs.writeFileSync(
  new URL('../src/renderer/lib/provider-logos.json', import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`
)
