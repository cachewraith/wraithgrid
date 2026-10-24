// Project icons (#80). An icon is `<set>:<name>`: `mit` Material Icon Theme (file icons),
// `dev` devicon (logos it lacks), `ms` Material Symbols (general). Stored in `workspace.icon`;
// anything else (old emoji, removed sets) draws the folder icon.

export const PROJECT_ICON_ID = /^(mit|dev|ms):[a-z0-9-]{1,48}$/

export const DEFAULT_PROJECT_ICON = 'ms:folder'

/** The files in a project's folder that say what it is (top level only, read in main). */
export const PROJECT_MARKER_FILES = [
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pubspec.yaml',
  'Gemfile',
  'Dockerfile',
  'compose.yaml',
  'docker-compose.yml'
] as const

export type MarkerFile = (typeof PROJECT_MARKER_FILES)[number]

/** package.json dependencies → icon, first match wins (frameworks before their base). */
const NODE_DEPS: [string, string][] = [
  ['next', 'dev:nextjs'],
  ['nuxt', 'mit:nuxt'],
  ['@angular/core', 'mit:angular'],
  ['svelte', 'mit:svelte'],
  ['astro', 'mit:astro'],
  ['electron', 'dev:electron'],
  ['@tauri-apps/api', 'mit:tauri'],
  ['vue', 'mit:vue'],
  ['react', 'mit:react'],
  ['vite', 'mit:vite']
]

/**
 * Icons that fit a project, best first, from its marker files' contents (null = no such
 * file). Pure; main reads the files.
 */
export function suggestProjectIcons(files: Partial<Record<MarkerFile, string | null>>): string[] {
  const out: string[] = []
  const add = (id: string): void => {
    if (!out.includes(id)) out.push(id)
  }
  const has = (f: MarkerFile): boolean => typeof files[f] === 'string'
  const text = (f: MarkerFile): string => files[f] ?? ''

  if (has('composer.json'))
    add(/laravel\/framework/.test(text('composer.json')) ? 'mit:laravel' : 'mit:php')
  const jvm = text('pom.xml') + text('build.gradle') + text('build.gradle.kts')
  if (/spring-boot|org\.springframework/.test(jvm)) add('dev:spring')
  if (/kotlin/.test(text('build.gradle.kts')) || /kotlin/.test(text('build.gradle')))
    add('mit:kotlin')
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) add('mit:java')
  if (has('package.json')) {
    let deps: Record<string, unknown> = {}
    try {
      const pkg = JSON.parse(text('package.json')) as Record<string, unknown>
      const obj = (v: unknown): Record<string, unknown> =>
        v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      deps = { ...obj(pkg.devDependencies), ...obj(pkg.dependencies) }
    } catch {
      // Not JSON: still a node project.
    }
    for (const [dep, id] of NODE_DEPS) if (dep in deps) add(id)
    add('typescript' in deps ? 'mit:typescript' : 'mit:nodejs')
  }
  if (has('Cargo.toml')) add('mit:rust')
  if (has('go.mod')) add('mit:go')
  if (/django/i.test(text('pyproject.toml') + text('requirements.txt'))) add('mit:django')
  if (has('pyproject.toml') || has('requirements.txt')) add('mit:python')
  if (has('pubspec.yaml')) add('dev:flutter')
  if (/rails/.test(text('Gemfile'))) add('mit:ruby')
  if (has('Dockerfile') || has('compose.yaml') || has('docker-compose.yml')) add('mit:docker')
  return out
}
