import { describe, expect, it } from 'vitest'
import type { ChatModel } from '@shared/chat'
import { modelFamily, modelTabs, tabOf } from '../../src/renderer/lib/model-groups'

const m = (value: string, label: string): ChatModel => ({
  value,
  label,
  description: '',
  efforts: []
})

// claude's list as the app shows it (#160): newest first within each family.
const CLAUDE = [
  m('default', 'Default (recommended)'),
  m('opus', 'Opus 5.5'),
  m('sonnet', 'Sonnet 5.5'),
  m('fable', 'Fable 5.1'),
  m('haiku', 'Haiku 5.5'),
  m('claude-haiku-4-5', 'Haiku 4.5'),
  m('claude-sonnet-5', 'Sonnet 5'),
  m('claude-opus-5', 'Opus 5'),
  m('claude-fable-5', 'Fable 5'),
  m('claude-opus-4-8', 'Opus 4.8'),
  m('claude-opus-4-7', 'Opus 4.7'),
  m('claude-opus-4-6', 'Opus 4.6'),
  m('claude-sonnet-4-6', 'Sonnet 4.6')
]

describe('model tabs (#160)', () => {
  it('takes the family from the label; the default entry has none', () => {
    expect(modelFamily(CLAUDE[1]!)).toBe('Opus')
    expect(modelFamily(CLAUDE[0]!)).toBeNull()
    expect(modelFamily(m('gpt-5.5', 'gpt-5.5'))).toBeNull()
  })

  it('splits a long list into Latest (default + newest of each) and the families', () => {
    const tabs = modelTabs(CLAUDE)!
    expect(tabs.map((t) => [t.label, t.models.length])).toEqual([
      ['Latest', 5],
      ['Opus', 5],
      ['Sonnet', 3],
      ['Fable', 2],
      ['Haiku', 2]
    ])
    expect(tabs[0]!.models.map((x) => x.value)).toEqual([
      'default',
      'opus',
      'sonnet',
      'fable',
      'haiku'
    ])
  })

  it('keeps a short list, or one that does not group, flat', () => {
    expect(modelTabs(CLAUDE.slice(0, 5))).toBeNull()
    expect(modelTabs(Array.from({ length: 10 }, (_, i) => m(`gpt-${i}`, `gpt-${i}`)))).toBeNull()
  })

  it('puts one-word labels under Other', () => {
    const tabs = modelTabs([...CLAUDE, m('gpt-x', 'gpt-x')])!
    expect(tabs.at(-1)).toMatchObject({ id: 'other', models: [{ value: 'gpt-x' }] })
  })

  it('opens on the tab holding the chosen model', () => {
    const tabs = modelTabs(CLAUDE)!
    expect(tabOf(tabs, 'sonnet')).toBe('latest')
    expect(tabOf(tabs, 'claude-opus-4-7')).toBe('Opus')
  })
})
