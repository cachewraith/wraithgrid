import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FILE_LIST_TTL_MS,
  listProjectPaths,
  makeFileLister,
  rankPaths,
  withFolders
} from '../../src/main/chat/files'
import type { GitRunner } from '../../src/main/git'
import { fileQuery, splitMentions } from '../../src/renderer/lib/slash'

const notRepo: GitRunner = () => Promise.reject(new Error('fatal: not a git repository'))

function project(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-files-')))
  for (const d of ['src/main', 'node_modules/left-pad', '.git/refs', 'docs'])
    fs.mkdirSync(path.join(root, d), { recursive: true })
  for (const f of [
    'src/main/app.ts',
    'src/main/ipc.ts',
    'src/index.ts',
    'README.md',
    'node_modules/left-pad/index.js',
    '.git/HEAD',
    'docs/guide.md'
  ])
    fs.writeFileSync(path.join(root, f), '')
  return root
}

describe('@ query (#159)', () => {
  it('opens on an @ word at the start or after a space, up to the caret', () => {
    expect(fileQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(fileQuery('look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' })
    expect(fileQuery('look at @src/ma and', 15)).toEqual({ start: 8, query: 'src/ma' })
  })
  it('does not open for an email, after a space, or for a second @', () => {
    expect(fileQuery('me@example.com', 14)).toBeNull()
    expect(fileQuery('@src done', 9)).toBeNull()
    expect(fileQuery('@a@b', 4)).toBeNull()
  })
})

describe('sent mentions', () => {
  it('splits @paths out of the text; @someone stays plain', () => {
    expect(splitMentions('read @src/app.ts and @README.md, thanks @bob')).toEqual([
      { text: 'read ', mention: false },
      { text: '@src/app.ts', mention: true },
      { text: ' and ', mention: false },
      { text: '@README.md,', mention: true },
      { text: ' thanks @bob', mention: false }
    ])
    expect(splitMentions('@docs/')).toEqual([{ text: '@docs/', mention: true }])
    expect(splitMentions('mail me@x.com')).toEqual([{ text: 'mail me@x.com', mention: false }])
  })
})

describe('listing a project', () => {
  it('walks a folder that is not a repo, skipping .git and node_modules', async () => {
    const paths = await listProjectPaths(project(), notRepo)
    expect(paths.sort()).toEqual(
      [
        'README.md',
        'docs/',
        'docs/guide.md',
        'src/',
        'src/index.ts',
        'src/main/',
        'src/main/app.ts',
        'src/main/ipc.ts'
      ].sort()
    )
  })

  it('uses git ls-files in a repo (so .gitignore holds), adding the folders', async () => {
    const calls: string[][] = []
    const git: GitRunner = (args) => {
      calls.push(args)
      return Promise.resolve('src/a.ts\0src/lib/b.ts\0node_modules/x.js\0README.md\0')
    }
    expect(await listProjectPaths('/p', git)).toEqual([
      'src/',
      'src/lib/',
      'src/a.ts',
      'src/lib/b.ts',
      'README.md'
    ])
    expect(calls[0]).toEqual(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  })

  it('keeps what git listed before it outran the buffer', async () => {
    const git: GitRunner = () =>
      Promise.reject(
        Object.assign(new Error('stdout maxBuffer length exceeded'), { stdout: 'a.ts\0b.ts\0c.t' })
      )
    expect(await listProjectPaths('/p', git)).toEqual(['a.ts', 'b.ts'])
  })

  it('reuses a folder’s list for a few seconds', async () => {
    let t = 0
    let runs = 0
    const git: GitRunner = () => {
      runs++
      return Promise.resolve('a.ts\0')
    }
    const list = makeFileLister(git, () => t)
    await list('/p')
    await list('/p')
    expect(runs).toBe(1)
    t += FILE_LIST_TTL_MS
    await list('/p')
    expect(runs).toBe(2)
  })
})

describe('ranking', () => {
  const paths = withFolders([
    'src/main/app.ts',
    'src/main/apply.ts',
    'src/renderer/App.tsx',
    'src/shared/mapping.ts',
    'tests/unit/app.test.ts',
    'README.md',
    'package.json'
  ])

  it('lists the top level for a bare @, folders first', () => {
    expect(rankPaths(paths, '')).toEqual(['src/', 'tests/', 'package.json', 'README.md'])
  })

  it('puts file-name matches before path matches, shallow and short first', () => {
    expect(rankPaths(paths, 'app').slice(0, 4)).toEqual([
      'src/main/app.ts',
      'src/renderer/App.tsx',
      'tests/unit/app.test.ts',
      'src/main/apply.ts'
    ])
    expect(rankPaths(paths, 'src/ma').slice(0, 3)).toEqual([
      'src/main/',
      'src/main/app.ts',
      'src/main/apply.ts'
    ])
  })

  it('opens a folder: its own entries for `src/`', () => {
    expect(rankPaths(paths, 'src/')).toEqual(['src/main/', 'src/renderer/', 'src/shared/'])
  })

  it('caps the answer and matches nothing for nonsense', () => {
    expect(rankPaths(paths, 'a', 2)).toHaveLength(2)
    expect(rankPaths(paths, 'zzz')).toEqual([])
  })
})
