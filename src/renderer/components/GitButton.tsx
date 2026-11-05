// The top bar's Git button (#162): the focused pane's branch and changed-file count, always in
// sight, and the git actions behind one click: changes, commit / pull / push (done in the
// Changes panel with its usual confirms), switch branch, and a new pane on a branch of its own.
import { useState, type MouseEvent } from 'react'
import { useActions, useApp } from '../app/services'
import { findPane } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { ContextMenu, type MenuItem, type MenuPoint } from './ContextMenu'
import { IconBranch, IconDiff, IconPlus } from './icons'

const WIDTH = 270

export function GitButton() {
  const actions = useActions()
  const paneId = useApp((s) => s.focusedPaneId)
  const git = useApp((s) => (s.focusedPaneId ? s.git[s.focusedPaneId] : undefined))
  // Worktrees are made on this computer: not for a pane on an ssh machine.
  const remote = useApp(
    (s) => !!(s.focusedPaneId && findPane(s.config, s.focusedPaneId)?.ws.machineId)
  )
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  if (!paneId || !git?.repo) return null

  const branch = git.branch ?? 'detached'
  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ x: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)), y: r.bottom + 6 })
  }
  const at = menu ? { x: menu.x, y: menu.y } : null
  const items: MenuItem[] = [
    {
      label: 'Show changes',
      icon: <IconDiff small />,
      kbd: SHORTCUT_HINT.diff,
      sub: git.changed ? `${git.changed} changed` : 'nothing changed',
      onSelect: () => actions.toggleDiff(true)
    },
    {
      label: 'Commit…',
      disabled: !git.changed,
      onSelect: () => actions.askGit(paneId, 'commit')
    },
    {
      label: `Pull${git.behind ? ` (${git.behind} behind)` : ''}`,
      disabled: !git.branch,
      onSelect: () => actions.askGit(paneId, 'pull')
    },
    {
      label: `Push${git.ahead ? ` (${git.ahead} ahead)` : ''}`,
      disabled: !git.branch,
      onSelect: () => actions.askGit(paneId, 'push')
    },
    {
      label: 'Switch branch…',
      icon: <IconBranch small />,
      divider: true,
      onSelect: () => actions.openModal({ kind: 'branches', paneId, at })
    },
    ...(remote
      ? []
      : [
          {
            label: 'New pane on a new branch…',
            icon: <IconPlus small />,
            sub: 'its own folder (git worktree)',
            onSelect: () => actions.openModal({ kind: 'newPane', slotId: null, branchFrom: paneId })
          },
          {
            label: 'Open a branch in a new pane…',
            icon: <IconPlus small />,
            onSelect: () => actions.openModal({ kind: 'branches', paneId, at, mode: 'open' })
          }
        ])
  ]
  return (
    <>
      <button
        className={`top-git${git.changed ? ' dirty' : ''}${menu ? ' open' : ''}`}
        aria-label={`Git: ${branch}${git.changed ? `, ${git.changed} changed` : ''}`}
        aria-haspopup="menu"
        title={[
          branch,
          git.changed ? `${git.changed} changed` : null,
          git.ahead ? `${git.ahead} ahead` : null,
          git.behind ? `${git.behind} behind` : null
        ]
          .filter(Boolean)
          .join(' · ')}
        onClick={open}
      >
        <IconBranch small />
        <span className="top-git-b">{branch}</span>
        {git.changed ? <span className="top-git-n">· {git.changed}</span> : null}
      </button>
      {menu ? (
        <ContextMenu
          at={menu}
          width={WIDTH}
          label="Git"
          onClose={() => setMenu(null)}
          items={items}
        />
      ) : null}
    </>
  )
}
