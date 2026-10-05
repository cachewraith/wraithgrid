import { useActions } from '../app/services'
import { IS_MAC, chordKeys } from '../app/shortcuts'
import { Dialog } from './Dialog'
import { IconClose } from './icons'

// `mod` is Ctrl, or ⌘ on macOS.
const ROWS: { label: string; keys: string[] }[] = [
  { label: 'Search panes and commands', keys: chordKeys(['mod', 'shift', 'P']) },
  { label: 'New pane', keys: chordKeys(['mod', 'shift', 'N']) },
  { label: 'Close pane', keys: chordKeys(['mod', 'shift', 'W']) },
  { label: 'Zoom pane / back to grid', keys: chordKeys(['mod', 'shift', 'Z']) },
  {
    label: 'Focus pane left / up / right / down',
    keys: chordKeys(['mod', 'alt', '←', '↑', '→', '↓'])
  },
  { label: 'Switch workspace', keys: chordKeys(['mod', 'shift', '1', '…', '9']) },
  { label: 'Show / hide the git diff', keys: chordKeys(['mod', 'shift', 'D']) },
  { label: 'Terminal text bigger / smaller / reset', keys: chordKeys(['mod', '+', '-', '0']) },
  { label: 'New line in claude', keys: ['Shift', 'Enter'] },
  {
    label: 'Copy / paste in a terminal',
    keys: IS_MAC ? ['⌘', 'C', '/', 'V'] : ['Ctrl', 'Shift', 'C', '/', 'V']
  },
  { label: 'Show this sheet', keys: chordKeys(['mod', 'shift', '/']) }
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
