// Asked before a chat carries on as another claude account (#29): what changes (limits, no
// cache, approvals) and that the conversation is copied into that account's folder.
import { useState } from 'react'
import { useActions, useApp } from '../app/services'
import { accountById, findPane } from '../app/store'
import { Dialog } from './Dialog'

export function SwitchAccountDialog({ paneId, accountId }: { paneId: string; accountId: string }) {
  const actions = useActions()
  const pane = useApp((s) => findPane(s.config, paneId)?.pane ?? null)
  const from = useApp((s) => accountById(s.config, pane?.accountId ?? null))
  const to = useApp((s) => accountById(s.config, accountId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!pane || !from || !to) return null

  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const err = await actions.chatSwitchAccount(paneId, accountId)
    setBusy(false)
    if (err) setError(err)
    else actions.closeModal()
  }

  return (
    <Dialog onClose={actions.closeModal} className="w4" labelledBy="swacct-t">
      <div className="dlg-hd">
        <h2 id="swacct-t">Continue this conversation as {to.name}?</h2>
      </div>
      <div className="dlg-bd">
        <ul className="sw-notes">
          <li>
            From now on {to.name}’s plan and limits are used; earlier turns stay counted to{' '}
            {from.name}.
          </li>
          <li>
            The first answer reads the whole conversation again: nothing is cached for {to.name}{' '}
            yet.
          </li>
          <li>
            The conversation is copied into {to.name}’s folder, so {to.name} can see it. {from.name}{' '}
            keeps its own copy.
          </li>
          <li>
            {to.name} has its own “Always allow” rules and settings, so it may ask for approvals{' '}
            {from.name} did not.
          </li>
        </ul>
        {error ? (
          <p className="hint err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Cancel
        </button>
        <button className="btn pri" disabled={busy} onClick={() => void go()}>
          {busy ? 'Switching…' : `Continue as ${to.name}`}
        </button>
      </div>
    </Dialog>
  )
}
