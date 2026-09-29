import { useActions, useApp, useServices } from '../app/services'
import { activeWorkspace } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { PRESETS, type PresetId } from '../layout/presets'
import { emptySlotIds } from '../layout/tree'
import { IconPlus } from './icons'

const MINI: Record<PresetId, { cols: string; rows?: string; cells: number }> = {
  '1': { cols: '1fr', cells: 1 },
  '2': { cols: '1fr 1fr', cells: 2 },
  '4': { cols: '1fr 1fr', rows: '1fr 1fr', cells: 4 },
  '3': { cols: '1fr 1fr 1fr', cells: 3 }
}

export function EmptyState() {
  const { store } = useServices()
  const actions = useActions()
  const name = useApp((s) => activeWorkspace(s).name)

  // A preset creates the slots, then asks for the first pane's account and folder.
  const startFrom = (id: PresetId): void => {
    actions.applyPreset(id)
    const slot = emptySlotIds(activeWorkspace(store.getState()).layout)[0] ?? null
    actions.openModal({ kind: 'newPane', slotId: slot })
  }

  return (
    <div className="empty">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <rect
          x="4"
          y="4"
          width="26"
          height="26"
          rx="6"
          fill="none"
          stroke="var(--acc)"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <rect
          x="34"
          y="4"
          width="26"
          height="26"
          rx="6"
          fill="none"
          stroke="var(--empty-line)"
          strokeWidth="2"
        />
        <rect
          x="4"
          y="34"
          width="26"
          height="26"
          rx="6"
          fill="none"
          stroke="var(--empty-line)"
          strokeWidth="2"
        />
        <rect
          x="34"
          y="34"
          width="26"
          height="26"
          rx="6"
          fill="none"
          stroke="var(--empty-line)"
          strokeWidth="2"
        />
        <path d="M17 12v10M12 17h10" stroke="var(--acct)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <h1>{name} has no panes yet</h1>
      <p>
        Each pane runs <code>claude</code> in one project folder, signed in with the account you
        pick.
      </p>
      <button
        className="btn pri lg"
        title={`New pane (${SHORTCUT_HINT.newPane})`}
        onClick={() => actions.openModal({ kind: 'newPane', slotId: null })}
      >
        <IconPlus />
        New pane<kbd>{SHORTCUT_HINT.newPane}</kbd>
      </button>
      <div className="qs-lbl">Or start from a layout</div>
      <div className="qs">
        {PRESETS.map((p) => {
          const m = MINI[p.id]
          return (
            <button key={p.id} className="qs-card" onClick={() => startFrom(p.id)}>
              <span
                className="mini"
                style={{ gridTemplateColumns: m.cols, gridTemplateRows: m.rows }}
              >
                {Array.from({ length: m.cells }, (_, i) => (
                  <span key={i} />
                ))}
              </span>
              {p.label}
            </button>
          )
        })}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        A preset creates the slots; you choose the account and folder for each one.
      </p>
    </div>
  )
}
