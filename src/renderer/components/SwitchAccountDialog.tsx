// Account switches keep the same-CLI copy flow (#29, #60); cross-CLI switches preview
// the text handoff and explain History and defaults before any state changes (#78).
import { useState, useSyncExternalStore, useCallback } from 'react'
import { useActions, useApp, useServices } from '../app/services'
import { accountById, findPane } from '../app/store'
import { Dialog } from './Dialog'
import { AGENT_PROVIDER_LABEL, AGENT_CLI_SPECS } from '@shared/agent-clis'
import { buildHandoff } from '../lib/chat-handoff'
import { ProviderLogo } from './ProviderLogo'

export function SwitchAccountDialog({ paneId, accountId }: { paneId: string; accountId: string }) {
  const actions = useActions()
  const { chat } = useServices()
  const thread = useSyncExternalStore(
    useCallback((cb) => chat.subscribe(paneId, cb), [chat, paneId]),
    () => chat.thread(paneId)
  )
  const pane = useApp((s) => findPane(s.config, paneId)?.pane ?? null)
  const from = useApp((s) => accountById(s.config, pane?.accountId ?? null))
  const to = useApp((s) => accountById(s.config, accountId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!pane || !from || !to) return null

  const cross = from.cli !== to.cli
  const terminal = !AGENT_CLI_SPECS[to.cli].chat
  const shared = !cross && AGENT_CLI_SPECS[to.cli].signIn === 'shared'
  const target = AGENT_PROVIDER_LABEL[to.cli]
  const source = AGENT_PROVIDER_LABEL[from.cli]
  const handoff = cross ? buildHandoff(thread.items, from.cli, from.name) : null

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
        <h2 id="swacct-t">
          {cross ? (
            <>
              <ProviderLogo cli={to.cli} /> {terminal ? 'Open' : 'Continue in'} {target} as{' '}
              {to.name}?
            </>
          ) : (
            <>Continue this conversation as {to.name}?</>
          )}
        </h2>
      </div>
      <div className="dlg-bd">
        {cross ? (
          terminal ? (
            <p>
              A fresh {target} terminal pane opens in the same folder. No conversation is carried
              over.
            </p>
          ) : (
            <>
              <p>
                {target} can’t read {source}’s conversation, so it starts a new chat in this pane
                with a summary of what was said.
              </p>
              <ul className="sw-notes">
                <li>
                  <b>{handoff!.messages} messages</b> carry over as text (your messages and the
                  answers; no tool output or thinking).
                </li>
                <li>
                  This {source} chat moves to <b>History</b>; you can reopen it there.
                </li>
                <li>Model, effort and mode reset to {target}’s defaults.</li>
              </ul>
              <div className="handoff-preview">
                <div>
                  {target}’s first message{' '}
                  <span className="mono">{handoff!.text.length.toLocaleString()} chars</span>
                </div>
                <pre>{handoff!.text}</pre>
              </div>
            </>
          )
        ) : shared ? (
          <ul className="sw-notes">
            <li>
              {source} shares its sign-in across accounts on this machine. Choosing {to.name} keeps
              that same login.
            </li>
            <li>
              This pane continues the same conversation with its current model, effort and mode.
            </li>
          </ul>
        ) : (
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
              The conversation is copied into {to.name}’s folder, so {to.name} can see it.{' '}
              {from.name} keeps its own copy.
            </li>
            <li>
              {to.name} has its own “Always allow” rules and settings, so it may ask for approvals{' '}
              {from.name} did not.
            </li>
          </ul>
        )}
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
          {busy
            ? 'Switching…'
            : cross
              ? terminal
                ? `Open ${target} terminal`
                : `Continue in ${target} →`
              : `Continue as ${to.name}`}
        </button>
      </div>
    </Dialog>
  )
}
