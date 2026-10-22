import { useMemo, useState } from 'react'
import { useActions, useApp } from '../app/services'
import { chordKeys } from '../app/shortcuts'
import { Dialog } from './Dialog'
import { IconPlus, IconRename, IconSearch, IconTrash } from './icons'

type RowMode = { kind: 'rename'; id: string; name: string } | { kind: 'delete'; id: string } | null

export function WorkspaceSwitcher() {
  const actions = useActions()
  const config = useApp((s) => s.config)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [rowMode, setRowMode] = useState<RowMode>(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return config.workspaces
      .map((w, index) => ({ w, index }))
      .filter(({ w }) => !q || w.name.toLowerCase().includes(q))
  }, [config.workspaces, query])
  const selected = items[Math.min(cursor, items.length - 1)]
  const canDelete = config.workspaces.length > 1

  const accountsOf = (paneAccountIds: (string | null)[]) => {
    const ids = [...new Set(paneAccountIds.filter((x): x is string => !!x))]
    return ids.flatMap((id) => config.accounts.find((a) => a.id === id) ?? [])
  }

  const onListKey = (e: React.KeyboardEvent): void => {
    if (rowMode) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault()
      actions.switchWorkspace(selected.w.id)
    } else if (e.key === 'F2' && selected) {
      e.preventDefault()
      setRowMode({ kind: 'rename', id: selected.w.id, name: selected.w.name })
    } else if (
      e.key === 'Delete' &&
      selected &&
      canDelete &&
      (e.target as HTMLElement).tagName !== 'INPUT'
    ) {
      e.preventDefault()
      setRowMode({ kind: 'delete', id: selected.w.id })
    }
  }

  const saveRename = (): void => {
    if (rowMode?.kind === 'rename') actions.renameWorkspace(rowMode.id, rowMode.name)
    setRowMode(null)
  }
  const inlineKeys = (onEnter: () => void, onEsc: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      onEnter()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onEsc()
    }
  }

  return (
    <Dialog onClose={actions.closeModal} className="w6" label="Switch project">
      <div onKeyDown={onListKey}>
        <div className="srch">
          <IconSearch />
          <input
            placeholder="Switch project…"
            aria-label="Filter projects"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            data-autofocus
          />
          <kbd>Esc</kbd>
        </div>
        <div className="wsl" role="listbox" aria-label="Projects">
          {items.length === 0 ? (
            <div className="wsl-empty">No project matches “{query}”.</div>
          ) : null}
          {items.map(({ w, index }, i) => {
            if (rowMode?.kind === 'delete' && rowMode.id === w.id) {
              return (
                <div key={w.id} className="wsr del">
                  <span className="delmsg">
                    Delete <b>{w.name}</b>?{' '}
                    {w.panes.length ? `Its ${w.panes.length} panes close. ` : ''}Project folders and
                    accounts are not touched.
                  </span>
                  <button className="btn gh" onClick={() => setRowMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn dng"
                    autoFocus
                    onClick={() => {
                      actions.deleteWorkspace(w.id)
                      setRowMode(null)
                    }}
                  >
                    Delete
                  </button>
                </div>
              )
            }
            if (rowMode?.kind === 'rename' && rowMode.id === w.id) {
              return (
                <div key={w.id} className="wsr on">
                  <input
                    className="inpt sans"
                    value={rowMode.name}
                    onChange={(e) => setRowMode({ ...rowMode, name: e.target.value })}
                    onKeyDown={inlineKeys(saveRename, () => setRowMode(null))}
                    aria-label="Project name"
                    maxLength={64}
                    style={{ flex: 1, margin: 4 }}
                    autoFocus
                  />
                  <button className="btn gh" onClick={() => setRowMode(null)}>
                    Cancel
                  </button>
                  <button className="btn pri" onClick={saveRename} disabled={!rowMode.name.trim()}>
                    Save
                  </button>
                </div>
              )
            }
            const accs = accountsOf(w.panes.map((p) => p.accountId))
            const current = w.id === config.activeWorkspace
            const meta = w.panes.length
              ? `${w.panes.length} ${w.panes.length === 1 ? 'pane' : 'panes'}${accs.length ? ` · ${accs.map((a) => a.name).join(', ')}` : ''}`
              : 'No panes'
            return (
              <div
                key={w.id}
                className={`wsr${selected?.w.id === w.id ? ' on' : ''}`}
                onMouseEnter={() => setCursor(i)}
              >
                <button
                  className="go"
                  role="option"
                  aria-selected={selected?.w.id === w.id}
                  onClick={() => actions.switchWorkspace(w.id)}
                >
                  <span className="tx">
                    <span className="nm">
                      {w.name} {current ? <span className="cur-tag">current</span> : null}
                    </span>
                    <span className="mt">{meta}</span>
                  </span>
                  <span className="dots">
                    {accs.map((a) => (
                      <span
                        key={a.id}
                        className="dot"
                        style={{ background: a.color, width: 10, height: 10 }}
                      />
                    ))}
                  </span>
                </button>
                {index < 9 ? (
                  <span className="keys" style={{ margin: '0 6px' }}>
                    {chordKeys(['mod', 'shift', String(index + 1)]).map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                ) : null}
                <button
                  className="icon-btn"
                  aria-label={`Rename ${w.name}`}
                  title="Rename (F2)"
                  onClick={() => setRowMode({ kind: 'rename', id: w.id, name: w.name })}
                >
                  <IconRename />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Delete ${w.name}`}
                  title={canDelete ? 'Delete (Del)' : 'The last project cannot be deleted'}
                  disabled={!canDelete}
                  onClick={() => setRowMode({ kind: 'delete', id: w.id })}
                >
                  <IconTrash />
                </button>
              </div>
            )
          })}
        </div>
        <div className="dlg-ft">
          <span className="hint">↑↓ move · Enter open · F2 rename · Del delete</span>
          <button className="btn" onClick={() => actions.openModal({ kind: 'newProject' })}>
            <IconPlus />
            New project
          </button>
        </div>
      </div>
    </Dialog>
  )
}
