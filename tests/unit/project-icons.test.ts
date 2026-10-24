import { describe, expect, it } from 'vitest'
import { PROJECT_ICON_ID, suggestProjectIcons } from '../../src/shared/project-icons'

describe('project icons (#80)', () => {
  it('suggests from the marker files, framework first', () => {
    expect(
      suggestProjectIcons({ 'composer.json': '{"require":{"laravel/framework":"^11"}}' })
    ).toEqual(['mit:laravel'])
    expect(suggestProjectIcons({ 'composer.json': '{}' })).toEqual(['mit:php'])
    expect(
      suggestProjectIcons({ 'pom.xml': '<artifactId>spring-boot-starter-web</artifactId>' })
    ).toEqual(['dev:spring', 'mit:java'])
    expect(suggestProjectIcons({ 'build.gradle.kts': 'plugins { kotlin("jvm") }' })).toEqual([
      'mit:kotlin',
      'mit:java'
    ])
    expect(
      suggestProjectIcons({
        'package.json':
          '{"dependencies":{"next":"15","react":"19"},"devDependencies":{"typescript":"5"}}',
        Dockerfile: 'FROM node'
      })
    ).toEqual(['dev:nextjs', 'mit:react', 'mit:typescript', 'mit:docker'])
    expect(suggestProjectIcons({ 'Cargo.toml': '' })).toEqual(['mit:rust'])
    expect(suggestProjectIcons({ 'requirements.txt': 'Django==5' })).toEqual([
      'mit:django',
      'mit:python'
    ])
  })

  it('gives nothing for an empty folder and survives a broken package.json', () => {
    expect(suggestProjectIcons({ 'composer.json': null, 'Cargo.toml': null })).toEqual([])
    expect(suggestProjectIcons({ 'package.json': '{not json' })).toEqual(['mit:nodejs'])
  })

  it('accepts only set:name ids from the bundled sets', () => {
    for (const ok of ['mit:laravel', 'dev:spring', 'ms:desktop-windows'])
      expect(PROJECT_ICON_ID.test(ok)).toBe(true)
    for (const bad of ['🚀', 'lucide:rocket', 'mit:../x', 'mit:<svg>', 'mit:'])
      expect(PROJECT_ICON_ID.test(bad)).toBe(false)
  })
})
