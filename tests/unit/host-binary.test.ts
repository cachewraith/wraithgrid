import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hostBinary } from '../../src/main/host-start'

// Where the window and `wraithgrid host-stdio` find the host (ADR 0004 phase 4b): from the
// folder of the built main code, packaged or not.
describe('the host binary', () => {
  let root = ''
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const make = (...parts: string[]): string => {
    const f = path.join(root, ...parts)
    mkdirSync(path.dirname(f), { recursive: true })
    writeFileSync(f, '')
    return f
  }

  it('packaged: in resources, three folders up from app.asar/out/main', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'wg-bin-'))
    const bin = make('resources', 'wraithgrid-host')
    const outDir = path.join(root, 'resources', 'app.asar', 'out', 'main')
    expect(hostBinary(outDir, 'linux')).toBe(bin)
    const exe = make('resources', 'wraithgrid-host.exe')
    expect(hostBinary(outDir, 'win32')).toBe(exe)
  })

  it('development: the cargo release build beside out/, or none', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'wg-bin-'))
    const outDir = path.join(root, 'out', 'main')
    expect(hostBinary(outDir, 'darwin')).toBeNull()
    const bin = make('host-rs', 'target', 'release', 'wraithgrid-host')
    expect(hostBinary(outDir, 'darwin')).toBe(bin)
  })
})
