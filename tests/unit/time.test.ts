import { describe, expect, it } from 'vitest'
import { ago } from '../../src/renderer/lib/time'

describe('ago', () => {
  it('is as short as a chat history label', () => {
    const now = 10_000_000_000
    expect(ago(now - 10_000, now)).toBe('now')
    expect(ago(now - 4 * 60_000, now)).toBe('4m')
    expect(ago(now - 2 * 3_600_000, now)).toBe('2h')
    expect(ago(now - 3 * 86_400_000, now)).toBe('3d')
    expect(ago(now - 15 * 86_400_000, now)).toBe('2w')
    expect(ago(now + 5000, now)).toBe('now')
  })
})
