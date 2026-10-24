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
// ChatGPT's monochrome knot identifies Codex accounts (pinned Simple Icons source;
// source/version and CC0 notice are recorded in docs/PROVIDER-LOGOS.md).
const chatgpt = fs.readFileSync(
  new URL('../src/renderer/lib/provider-logo-chatgpt.svg', import.meta.url),
  'utf8'
)
out.codex = {
  width: 24,
  height: 24,
  body: chatgpt.match(/<path[^>]*\/>/)[0].replace('<path ', '<path fill="currentColor" ')
}
fs.writeFileSync(
  new URL('../src/renderer/lib/provider-logos.json', import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`
)
