import { useState, type MouseEvent } from 'react'
import { useActions, useApp } from '../app/services'
import { activeWorkspace } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { PRESETS, detectPreset, type PresetId } from '../layout/presets'
import { paneIds } from '../layout/tree'
import {
  IconBack,
  IconKeyboard,
  IconPreset1,
  IconPreset2,
  IconPreset3,
  IconPreset4,
  IconMods,
  IconMore,
  IconSettings,
  IconUnzoom,
  IconZoom
} from './icons'
import { ContextMenu, type MenuPoint } from './ContextMenu'
import { UsageButton } from './UsageView'

const PRESET_ICON: Record<PresetId, () => React.JSX.Element> = {
  '1': () => <IconPreset1 />,
  '2': () => <IconPreset2 />,
  '4': () => <IconPreset4 />,
  '3': () => <IconPreset3 />
}

export function TopBar() {
  const actions = useActions()
  const ws = useApp(activeWorkspace)
  const view = useApp((s) => s.view)
  const zoomedId = useApp((s) => s.zoomedPaneId)

  const shown = paneIds(ws.layout)
  const hiddenCount = ws.panes.length - shown.length
  const zoomedPane = zoomedId ? ws.panes.find((p) => p.id === zoomedId) : undefined
  const preset = detectPreset(ws.layout)

  if (view === 'project') {
    return (
      <header className="top">
        <span className="top-title">{ws.name}</span>
        <span className="top-sub">Project</span>
        <div className="top-sp" />
        {ws.panes.length ? (
          <button className="btn" onClick={() => actions.setView('grid')}>
            Open chats
            <span className="top-cnt">{ws.panes.length}</span>
          </button>
        ) : null}
        <UtilityButtons />
      </header>
    )
  }

  if (view !== 'grid') {
    return (
      <header className="top">
        <button
          className="btn gh"
          onClick={() => actions.setView('grid')}
          style={{ padding: '0 8px' }}
        >
          <IconBack />
          {ws.name}
        </button>
        <div className="vsep" />
        <span className="top-title">
          {view === 'accounts'
            ? 'Accounts'
            : view === 'mods'
              ? 'Mods'
              : view === 'usage'
                ? 'Usage'
                : 'Settings'}
        </span>
        <div className="top-sp" />
        <UtilityButtons />
      </header>
    )
  }

  if (zoomedPane) {
    const cells = shown.slice(0, 8)
    const cols =
      cells.length >= 5 ? 4 : cells.length === 3 ? 3 : Math.max(1, Math.min(cells.length, 2))
    return (
      <header className="top">
        <span className="top-title">{zoomedPane.title}</span>
        <span className="top-sub">zoomed · {ws.name}</span>
        <div className="top-sp" />
        <div
          className="minimap"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          aria-hidden="true"
        >
          {(cells.length ? cells : [zoomedPane.id]).map((id) => (
            <span key={id} className={id === zoomedPane.id ? 'on' : ''} />
          ))}
        </div>
        <button
          className="btn pri"
          onClick={() => actions.toggleZoom()}
          title={`Back to grid (${SHORTCUT_HINT.zoom})`}
        >
          <IconUnzoom />
          Back to grid<kbd>{SHORTCUT_HINT.zoom}</kbd>
        </button>
        <div className="vsep" />
        <UtilityButtons />
      </header>
    )
  }

  const empty = !ws.layout
  return (
    <header className="top">
      <button
        className="top-link"
        title="Project overview: open chats and history"
        onClick={() => actions.openProject(ws.id)}
      >
        <IconBack />
        <span className="top-title">{ws.name}</span>
      </button>
      <span className="top-chip">
        {empty ? 'No chats yet' : `${ws.panes.length} ${ws.panes.length === 1 ? 'chat' : 'chats'}`}
      </span>
      {hiddenCount > 0 ? (
        <button
          className="hidden-chip"
          onClick={actions.showAllPanes}
          title="Show all panes in the grid"
        >
          +{hiddenCount} hidden
        </button>
      ) : null}
      <div className="top-sp" />
      {empty ? null : (
        <>
          <div className="seg" role="group" aria-label="Layout preset">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`seg-btn${preset === p.id ? ' on' : ''}`}
                aria-pressed={preset === p.id}
                aria-label={p.label}
                title={p.label}
                onClick={() => actions.applyPreset(p.id)}
              >
                {PRESET_ICON[p.id]()}
              </button>
            ))}
            <span className="seg-sep" aria-hidden="true" />
            <button
              className="seg-btn"
              onClick={() => actions.toggleZoom()}
              disabled={ws.panes.length === 0}
              aria-label={`Zoom focused pane (${SHORTCUT_HINT.zoom})`}
              title={`Zoom focused pane (${SHORTCUT_HINT.zoom})`}
            >
              <IconZoom />
            </button>
          </div>
        </>
      )}
      <UtilityButtons />
    </header>
  )
}

/** Shortcuts, Mods and Settings behind one button: they are also in the account menu. */
function UtilityButtons() {
  const actions = useActions()
  const [menu, setMenu] = useState<{ at: MenuPoint; width: number } | null>(null)
  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    // Right-aligned under the button.
    setMenu({ at: { x: r.right - 260, y: r.bottom + 6 }, width: 260 })
  }
  return (
    <>
      <UsageButton />
      <button
        className={`icon-btn top-more${menu ? ' open' : ''}`}
        aria-label="More"
        aria-haspopup="menu"
        title="More"
        onClick={open}
      >
        <IconMore />
      </button>
      {menu ? (
        <ContextMenu
          at={menu.at}
          width={menu.width}
          className="top-menu"
          label="More"
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Keyboard shortcuts',
              kbd: SHORTCUT_HINT.shortcuts,
              icon: <IconKeyboard small />,
              onSelect: () => actions.openModal({ kind: 'shortcuts' })
            },
            { label: 'Mods', icon: <IconMods small />, onSelect: () => actions.setView('mods') },
            {
              label: 'Settings',
              icon: <IconSettings small />,
              onSelect: () => actions.setView('settings')
            }
          ]}
        />
      ) : null}
    </>
  )
}
