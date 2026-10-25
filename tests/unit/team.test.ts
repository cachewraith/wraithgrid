import { describe, expect, it } from 'vitest'
import { teamAgentSchema, workspaceSchema } from '@shared/schema'
import type { Account, Pane, TeamAgent } from '@shared/types'
import { planTeam, teamBranch, teamPaneIds, teamWarnings } from '../../src/renderer/lib/team'
import { autoGrid } from '../../src/renderer/layout/tree'

const agent = (id: string, role: string, accountId: string | null): TeamAgent => ({
  id,
  role,
  accountId,
  model: null,
  effort: null,
  chatMode: null,
  prompt: '',
  folder: 'worktree'
})
const account = (id: string) => ({ id, name: id, cli: 'claude' }) as Account
const pane = (id: string, teamAgentId: string | null) => ({ id, teamAgentId }) as Pane

describe('project team (#79)', () => {
  it('names each agent its own branch', () => {
    expect(teamBranch('Reviewer')).toBe('team/reviewer')
    expect(teamBranch('  Unit tests! ')).toBe('team/unit-tests')
    expect(teamBranch('???')).toBe('team/agent')
  })

  it('starts the agents not open, focuses the open ones, skips a missing account', () => {
    const team = [
      agent('t1', 'Builder', 'a1'),
      agent('t2', 'Reviewer', 'a2'),
      agent('t3', 'Tests', 'gone')
    ]
    const steps = planTeam(team, [account('a1'), account('a2')], [pane('p9', 't2')])
    expect(steps.map((s) => s.kind)).toEqual(['start', 'focus', 'skip'])
    expect(steps[1]).toMatchObject({ paneId: 'p9' })
    expect(teamPaneIds(team, [pane('p1', null), pane('p9', 't2'), pane('p8', 't1')])).toEqual([
      'p8',
      'p9'
    ])
  })

  it('warns before starting about a missing account or one at its limit', () => {
    const team = [
      agent('t1', 'Builder', 'a1'),
      agent('t2', 'Reviewer', 'a2'),
      agent('t3', 'Tests', 'gone')
    ]
    const steps = planTeam(team, [account('a1'), account('a2')], [])
    const limits = {
      a1: { fiveHour: { utilization: 1, resetsAt: 2000 }, sevenDay: null, at: 0 },
      a2: { fiveHour: { utilization: 0.4, resetsAt: 2000 }, sevenDay: null, at: 0 }
    }
    expect(teamWarnings(steps, limits, 1000).map((w) => [w.agent.role, w.text])).toEqual([
      ['Builder', '5-hour limit 100%'],
      ['Tests', 'account missing · skipped']
    ])
    // Past its reset, the limit no longer counts.
    expect(teamWarnings(steps, limits, 3000)).toHaveLength(1)
  })

  it('lays the team out by its size: 2 side by side, 3 columns, 4 as 2×2', () => {
    expect(autoGrid(['a', 'b'])).toMatchObject({ type: 'split', dir: 'row' })
    expect(autoGrid(['a', 'b', 'c'])).toMatchObject({
      type: 'split',
      dir: 'row',
      sizes: [expect.any(Number), expect.any(Number), expect.any(Number)]
    })
    const four = autoGrid(['a', 'b', 'c', 'd'])
    expect(four).toMatchObject({ type: 'split', dir: 'col' })
    expect(four?.type === 'split' && four.children.map((c) => c.type)).toEqual(['split', 'split'])
  })

  it('saves agents with defaults, at most 8, and drops a bad team rather than the project', () => {
    expect(teamAgentSchema.parse({ id: 't1', role: ' Reviewer ', accountId: 'a1' })).toEqual({
      ...agent('t1', 'Reviewer', 'a1')
    })
    expect(teamAgentSchema.safeParse({ id: 't1', role: '', accountId: 'a1' }).success).toBe(false)
    const ws = { id: 'w', name: 'w', icon: '', color: '', panes: [], layout: null }
    expect(workspaceSchema.parse(ws).team).toEqual([])
    const nine = Array.from({ length: 9 }, (_, i) => agent(`t${i}`, `r${i}`, 'a1'))
    expect(workspaceSchema.parse({ ...ws, team: nine }).team).toEqual([])
    expect(workspaceSchema.parse({ ...ws, team: nine.slice(0, 8) }).team).toHaveLength(8)
  })
})
