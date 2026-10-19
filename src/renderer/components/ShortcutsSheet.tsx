import type { ShortcutId } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { IS_MAC, bindingKeys, chordKeys, currentBinding } from '../app/shortcuts'
import { Dialog } from './Dialog'
import { IconClose } from './icons'

// `mod` is Ctrl, or ⌘ on macOS. A row with an `id` shows its binding as rebound in Settings.
const ROWS: { label: string; id?: ShortcutId; keys?: string[] }[] = [
  { label: 'Search panes and commands', id: 'palette' },
  { label: 'New pane', id: 'newPane' },
  { label: 'Close pane', id: 'closePane' },
  { label: 'Zoom pane / back to grid', id: 'toggleZoom' },
  {
    label: 'Focus pane left / up / right / down',
    keys: chordKeys(['mod', 'alt', '←', '↑', '→', '↓'])
  },
  { label: 'Switch workspace', keys: chordKeys(['mod', 'shift', '1', '…', '9']) },
  { label: 'Show / hide the git diff', id: 'diff' },
  { label: 'Terminal text bigger / smaller / reset', keys: chordKeys(['mod', '+', '-', '0']) },
  { label: 'New line in claude', keys: ['Shift', 'Enter'] },
  {
    label: 'Copy / paste in a terminal',
    keys: IS_MAC ? ['⌘', 'C', '/', 'V'] : ['Ctrl', 'Shift', 'C', '/', 'V']
  },
  { label: 'Show this sheet', id: 'shortcuts' }
]

export function ShortcutsSheet() {
  const actions = useActions()
  // Re-read the bindings when they are changed in Settings.
  useApp((s) => s.config.settings.shortcuts)
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
                {(r.id ? bindingKeys(currentBinding(r.id)) : r.keys!).map((k, i) =>
                  k === '…' || k === '/' ? <span key={i}>{k}</span> : <kbd key={i}>{k}</kbd>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="dlg-ft">
        <span className="hint">Change them in Settings → Keyboard shortcuts.</span>
        <button className="btn" onClick={actions.closeModal} data-autofocus>
          Done
        </button>
      </div>
    </Dialog>
  )
}
