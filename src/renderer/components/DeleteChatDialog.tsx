// Asked before a chat is deleted from its project: an open one is stopped, and its saved view
// goes either way. claude's own session files stay where claude keeps them.
import { useActions, useApp } from '../app/services'
import { findPane } from '../app/store'
import { Dialog } from './Dialog'

export function DeleteChatDialog({ wsId, paneId }: { wsId: string; paneId: string }) {
  const actions = useActions()
  const open = useApp((s) => findPane(s.config, paneId)?.pane ?? null)
  const closed = useApp(
    (s) =>
      s.config.workspaces.find((w) => w.id === wsId)?.history.find((h) => h.pane.id === paneId)
        ?.pane ?? null
  )
  const busy = useApp((s) => {
    const st = s.runtime[paneId]?.status
    return st === 'running' || st === 'starting' || st === 'approval' || st === 'background'
  })
  const title = (open ?? closed)?.title ?? 'this chat'

  return (
    <Dialog onClose={actions.closeModal} className="w4" role="alertdialog" labelledBy="delchat-t">
      <div className="dlg-hd">
        <h2 id="delchat-t">Delete “{title}”?</h2>
      </div>
      <div className="dlg-bd">
        <p className="hint" style={{ fontSize: 13, color: 'var(--mu)', margin: 0 }}>
          {open
            ? `${busy ? 'It is still working and will be stopped. ' : ''}The chat closes and does not go to History.`
            : 'It is removed from History and can no longer be reopened here.'}
        </p>
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Keep it
        </button>
        <button
          className="btn dng"
          onClick={() => {
            actions.closeModal()
            actions.deleteChat(wsId, paneId)
          }}
        >
          Delete chat
        </button>
      </div>
    </Dialog>
  )
}
