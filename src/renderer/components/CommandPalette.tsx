// One search box for everything: jump to any pane in any workspace, switch workspace, open
// a claude pane as an account, or run an app command. Type to filter, arrows and Enter.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { PANE_STATUS_LABEL } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { currentTheme, type AppState } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { matches } from '../lib/search'
import { AccountIcon, Avatar } from './AccountIcon'
import { Dialog } from './Dialog'
import {
  IconCompose,
  IconDiff,
  IconKeyboard,
  IconMoon,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSun,
  IconUserPlus
} from './icons'

interface Item {
  id: string
  group: 'Panes' | 'Commands' | 'Workspaces' | 'Accounts'
  label: string
  sub?: string
  icon: ReactNode
  hint?: string
  run: () => void
}

function buildItems(s: AppState): Item[] {
  const { config } = s
  const items: Item[] = []
  for (const ws of config.workspaces) {
    for (const p of ws.panes) {
      const account = config.accounts.find((a) => a.id === p.accountId)
      const status = s.runtime[p.id]?.status
      const branch = s.git[p.id]?.branch
      items.push({
        id: `pane:${p.id}`,
        group: 'Panes',
        label: p.title,
        sub: [account?.name ?? 'shell', ws.name, branch, status ? PANE_STATUS_LABEL[status] : null]
          .filter(Boolean)
          .join(' · '),
        icon: account ? (
          <AccountIcon account={account} size={18} />
        ) : (
          <Avatar icon="" name="$" color="var(--fa)" />
        ),
        run: () => s.revealPane(p.id)
      })
    }
  }
  const dark = currentTheme(s) === 'dark'
  items.push(
    {
      id: 'cmd:new-pane',
      group: 'Commands',
      label: 'New pane…',
      icon: <IconCompose />,
      hint: SHORTCUT_HINT.newPane,
      run: () => s.openModal({ kind: 'newPane', slotId: null })
    },
    {
      id: 'cmd:diff',
      group: 'Commands',
      label: s.diffOpen ? 'Hide changes' : 'Show changes (git diff)',
      icon: <IconDiff />,
      hint: SHORTCUT_HINT.diff,
      run: () => {
        s.toggleDiff()
        s.closeModal()
      }
    },
    {
      id: 'cmd:workspaces',
      group: 'Commands',
      label: 'Manage workspaces…',
      icon: <IconSidebar />,
      run: () => s.openModal({ kind: 'workspaces' })
    },
    {
      id: 'cmd:sidebar',
      group: 'Commands',
      label: config.settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
      icon: <IconSidebar />,
      run: () => {
        s.toggleSidebar()
        s.closeModal()
      }
    },
    {
      id: 'cmd:theme',
      group: 'Commands',
      label: dark ? 'Switch to light theme' : 'Switch to dark theme',
      icon: dark ? <IconSun /> : <IconMoon />,
      run: () => {
        s.updateSettings({ theme: dark ? 'light' : 'dark' })
        s.closeModal()
      }
    },
    {
      id: 'cmd:accounts',
      group: 'Commands',
      label: 'Accounts',
      icon: <IconUserPlus />,
      run: () => s.setView('accounts')
    },
    {
      id: 'cmd:settings',
      group: 'Commands',
      label: 'Settings',
      icon: <IconSettings />,
      run: () => s.setView('settings')
    },
    {
      id: 'cmd:shortcuts',
      group: 'Commands',
      label: 'Keyboard shortcuts',
      icon: <IconKeyboard />,
      hint: SHORTCUT_HINT.shortcuts,
      run: () => s.openModal({ kind: 'shortcuts' })
    }
  )
  config.workspaces.forEach((w, i) =>
    items.push({
      id: `ws:${w.id}`,
      group: 'Workspaces',
      label: w.name,
      sub: `${w.panes.length} ${w.panes.length === 1 ? 'pane' : 'panes'}`,
      icon: <Avatar icon={w.icon} name={w.name} color="var(--fa)" />,
      hint: i < 9 ? `Ctrl+Shift+${i + 1}` : undefined,
      run: () => s.switchWorkspace(w.id)
    })
  )
  const cwd = config.recentFolders[0] ?? config.settings.defaultCwd
  for (const a of config.accounts) {
    items.push({
      id: `acc:${a.id}`,
      group: 'Accounts',
      label: `New claude pane as ${a.name}`,
      sub: `in ${cwd}`,
      icon: <AccountIcon account={a} size={18} />,
      run: () => {
        s.createPane({ accountId: a.id, cwd, args: [], shell: false, slotId: null })
      }
    })
  }
  return items
}

export function CommandPalette() {
  const actions = useActions()
  // The whole state: rows show panes, statuses, branches and settings. Open only briefly.
  const state = useApp((s) => s)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const all = buildItems(state)
    return query.trim() ? all.filter((i) => matches(query, `${i.label} ${i.sub ?? ''}`)) : all
  }, [state, query])
  const at = Math.min(cursor, items.length - 1)

  const move = (to: number): void => {
    setCursor(to)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${to}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(Math.min(at + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(Math.max(at - 1, 0))
    } else if (e.key === 'Enter' && items[at]) {
      e.preventDefault()
      items[at].run()
    }
  }

  return (
    <Dialog onClose={actions.closeModal} className="w6 pal" label="Search panes and commands">
      <div onKeyDown={onKey}>
        <div className="srch">
          <IconSearch />
          <input
            value={query}
            placeholder="Search panes, workspaces, accounts and commands"
            aria-label="Search"
            aria-controls="cp-list"
            aria-activedescendant={items[at] ? `cp-${at}` : undefined}
            spellCheck={false}
            data-autofocus
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cp-list" id="cp-list" role="listbox" ref={listRef}>
          {items.length === 0 ? <div className="wsl-empty">Nothing matches “{query}”.</div> : null}
          {items.map((item, i) => {
            const head = i === 0 || items[i - 1]!.group !== item.group ? item.group : null
            return (
              <div key={item.id} role="presentation">
                {head ? <div className="cp-grp">{head}</div> : null}
                <div
                  id={`cp-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === at}
                  className={`cp-row${i === at ? ' on' : ''}`}
                  onMouseMove={() => i !== at && setCursor(i)}
                  onClick={() => item.run()}
                >
                  <span className="cp-ic">{item.icon}</span>
                  <span className="cp-tx">
                    <span className="cp-lb">{item.label}</span>
                    {item.sub ? <span className="cp-sb">{item.sub}</span> : null}
                  </span>
                  {item.hint ? <kbd>{item.hint}</kbd> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
