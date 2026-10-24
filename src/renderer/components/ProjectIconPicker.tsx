// Change a project's icon (#80): search, Tech / General tabs, icons suggested from the
// project's folder, Remove icon. Arrows move through the grid, Enter picks, Esc closes.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useActions, useApp, useServices } from '../app/services'
import { iconLabel, iconNames, loadMaterialIconTheme, useIconSets } from '../lib/project-icons'
import { Dialog } from './Dialog'
import { IconSearch } from './icons'
import { ProjectIcon } from './ProjectIcon'

const COLS = 7
/** Enough to browse; typing finds the rest. */
const MAX_SHOWN = 140

export function ProjectIconPicker({ wsId }: { wsId: string }) {
  const actions = useActions()
  const { api } = useServices()
  const ws = useApp((s) => s.config.workspaces.find((w) => w.id === wsId) ?? null)
  const [tab, setTab] = useState<'tech' | 'general'>('tech')
  const [query, setQuery] = useState('')
  const [suggested, setSuggested] = useState<string[]>([])
  const gridRef = useRef<HTMLDivElement>(null)
  useIconSets()

  useEffect(() => {
    void loadMaterialIconTheme()
    void api.project.suggestIcons(wsId).then((ids) => setSuggested(ids ?? []))
  }, [api, wsId])

  // Listed on every render: cheap, and re-lists once Material Icon Theme is in.
  const q = query.trim().toLowerCase().replace(/\s+/g, '-')
  const all = iconNames(tab)
  const shown = (q ? all.filter((id) => id.split(':')[1]!.includes(q)) : all).slice(0, MAX_SHOWN)

  if (!ws) return null
  const pick = (icon: string): void => {
    actions.setWorkspaceIcon(wsId, icon)
    actions.closeModal()
  }
  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key]
    if (!step) return
    const buttons = [...(gridRef.current?.querySelectorAll('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[Math.min(Math.max(i + step, 0), buttons.length - 1)]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }
  const cell = (id: string) => (
    <button
      key={id}
      className={`pip-cell${ws.icon === id ? ' on' : ''}`}
      title={iconLabel(id)}
      aria-label={iconLabel(id)}
      aria-pressed={ws.icon === id}
      onClick={() => pick(id)}
    >
      <ProjectIcon icon={id} size={20} />
    </button>
  )

  return (
    <Dialog onClose={actions.closeModal} className="pip" label={`Icon for ${ws.name}`}>
      <label className="pip-search">
        <IconSearch small />
        <input
          data-autofocus
          type="search"
          placeholder="Search icons"
          aria-label="Search icons"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              gridRef.current?.querySelector('button')?.focus()
            }
          }}
        />
      </label>
      <div className="pip-tabs" role="tablist">
        {(['tech', 'general'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'on' : ''}
            onClick={() => setTab(t)}
          >
            {t === 'tech' ? 'Tech' : 'General'}
          </button>
        ))}
      </div>
      <div className="pip-body" ref={gridRef} onKeyDown={move}>
        {suggested.length && !query ? (
          <>
            <div className="pip-sec">Suggested from the folder</div>
            <div className="pip-grid" aria-label="Suggested icons">
              {suggested.map(cell)}
            </div>
          </>
        ) : null}
        <div className="pip-sec">{tab === 'tech' ? 'Tech' : 'General'}</div>
        <div className="pip-grid" aria-label="Icons">
          {shown.map(cell)}
        </div>
        {shown.length === 0 ? <p className="pip-empty">No icon matches “{query}”.</p> : null}
      </div>
      <div className="pip-ft">
        <button className="btn gh" onClick={() => pick('')} disabled={!ws.icon}>
          Remove icon
        </button>
        <span>{ws.icon ? iconLabel(ws.icon) : 'folder'}</span>
      </div>
    </Dialog>
  )
}
