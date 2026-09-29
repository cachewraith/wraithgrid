import { useActions } from '../app/services'
import { Dialog } from './Dialog'
import { IconClose } from './icons'

const ROWS: { label: string; keys: string[] }[] = [
  { label: 'New pane', keys: ['Ctrl', 'Shift', 'N'] },
  { label: 'Close pane', keys: ['Ctrl', 'Shift', 'W'] },
  { label: 'Zoom pane / back to grid', keys: ['Ctrl', 'Shift', 'Z'] },
  { label: 'Focus pane left / up / right / down', keys: ['Ctrl', 'Alt', '←', '↑', '→', '↓'] },
  { label: 'Switch workspace', keys: ['Ctrl', 'Shift', '1', '…', '9'] },
  { label: 'Copy / paste in a terminal', keys: ['Ctrl', 'Shift', 'C', '/', 'V'] },
  { label: 'Show this sheet', keys: ['Ctrl', 'Shift', '/'] }
]

export function ShortcutsSheet() {
  const actions = useActions()
  return (
    <Dialog onClose={actions.closeModal} className="w4" labelledBy="sc-t">
      <div className="dlg-hd">
        <h2 id="sc-t">Keyboard shortcuts</h2>
        <button
          className="icon-btn"
          aria-label="Close (Esc)"
          title="Close (Esc)"
          onClick={actions.closeModal}
        >
          <IconClose />
        </button>
      </div>
      <div className="dlg-bd" style={{ gap: 0 }}>
        <div className="scl">
          {ROWS.map((r) => (
            <div key={r.label} className="sc-row">
              <span>{r.label}</span>
              <span className="keys">
                {r.keys.map((k, i) =>
                  k === '…' || k === '/' ? <span key={i}>{k}</span> : <kbd key={i}>{k}</kbd>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="dlg-ft">
        <span className="hint">Defaults. Custom bindings come later.</span>
        <button className="btn" onClick={actions.closeModal} data-autofocus>
          Done
        </button>
      </div>
    </Dialog>
  )
}
