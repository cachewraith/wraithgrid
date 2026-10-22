import { describe, expect, it } from 'vitest'
import {
  crumbs,
  joinPath,
  looksLikePath,
  middleTruncate,
  splitFolder
} from '../../src/renderer/lib/folder-path'

describe('folder picker paths', () => {
  it('tells a typed path from a filter', () => {
    for (const p of ['~', '~/code', '/etc', 'C:\\work', 'd:/x']) expect(looksLikePath(p)).toBe(true)
    for (const f of ['api', '.git', 'code/api', '~x']) expect(looksLikePath(f)).toBe(false)
  })

  it('builds breadcrumbs for home, root and drive paths', () => {
    expect(crumbs('~/code/api')).toEqual([
      { label: '~', path: '~' },
      { label: 'code', path: '~/code' },
      { label: 'api', path: '~/code/api' }
    ])
    expect(crumbs('/etc/nginx').map((c) => c.path)).toEqual(['/', '/etc', '/etc/nginx'])
    expect(crumbs('/')).toEqual([{ label: '/', path: '/' }])
    expect(crumbs('C:\\work\\api').map((c) => c.path)).toEqual([
      'C:\\',
      'C:\\work',
      'C:\\work\\api'
    ])
  })

  it('joins and splits with the path’s own separator', () => {
    expect(joinPath('~/code', 'api')).toBe('~/code/api')
    expect(joinPath('/', 'etc')).toBe('/etc')
    expect(joinPath('C:\\work', 'api')).toBe('C:\\work\\api')
    expect(splitFolder('~/code/api')).toEqual({ name: 'api', parent: '~/code' })
    expect(splitFolder('~')).toEqual({ name: '~', parent: '' })
  })

  it('cuts long paths in the middle', () => {
    expect(middleTruncate('~/short', 20)).toBe('~/short')
    const t = middleTruncate('~/a/very/long/path/to/the/project', 16)
    expect(t).toHaveLength(16)
    expect(t.startsWith('~/a/ver')).toBe(true)
    expect(t.endsWith('project')).toBe(true)
  })
})
