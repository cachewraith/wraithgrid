// Signs a claude account in without a terminal: main runs claude's own `claude auth login`
// in the account's folder; this shows its link, takes the code the page may show, and says
// who is signed in at the end. Tokens never pass through Wraithgrid.
import { useEffect, useState } from 'react'
import type { LoginEvent } from '@shared/ipc-contract'
import { useActions, useApp, useServices } from '../app/services'
import { accountById } from '../app/store'
import { CopyButton } from './chat/Markdown'
import { Dialog } from './Dialog'

type Step =
  | { s: 'starting' }
  | { s: 'url'; url: string; sent: boolean }
  | { s: 'done'; email: string | null; plan: string | null }
  | { s: 'error'; error: string }

export function LoginDialog({ accountId }: { accountId: string }) {
  const { api } = useServices()
  const actions = useActions()
  const { closeModal, markSignedIn } = actions
  const account = useApp((s) => accountById(s.config, accountId))
  const [step, setStep] = useState<Step>({ s: 'starting' })
  const [code, setCode] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ended = false
    const off = api.login.onEvent((e: LoginEvent) => {
      if (e.accountId !== accountId) return
      if (e.state === 'url') setStep({ s: 'url', url: e.url, sent: false })
      else {
        ended = true
        if (e.ok) {
          markSignedIn(accountId)
          setStep({ s: 'done', email: e.email, plan: e.plan })
        } else setStep({ s: 'error', error: e.error ?? 'Sign-in did not finish.' })
      }
    })
    void api.login.start(accountId).then((r) => {
      if (!r.ok) {
        ended = true
        setStep({ s: 'error', error: r.error })
      }
    })
    return () => {
      off()
      if (!ended) api.login.cancel(accountId)
    }
  }, [api, accountId, attempt, markSignedIn])

  const name = account?.name ?? 'this account'
  const clean = code.trim()
  const submit = (): void => {
    if (step.s !== 'url' || !/^[\x21-\x7e]{1,2048}$/.test(clean)) return
    api.login.code(accountId, clean)
    setStep({ ...step, sent: true })
  }

  return (
    <Dialog onClose={closeModal} className="w4" labelledBy="login-t">
      <div className="dlg-hd">
        <h2 id="login-t">
          {step.s === 'done' ? `${name} is signed in` : `Sign in to Claude as ${name}`}
        </h2>
      </div>
      <div className="dlg-bd login-bd">
        {step.s === 'starting' ? <p className="hint">Starting the sign-in…</p> : null}
        {step.s === 'url' ? (
          <>
            <p className="hint">
              Your browser opens Claude’s sign-in page. If it didn’t, open it here.
            </p>
            <div className="login-link">
              <button
                className="btn"
                onClick={() => void api.shell.openExternal(step.url)}
                data-autofocus
              >
                Open sign-in page
              </button>
              <CopyButton text={step.url} label="Copy link" />
            </div>
            <label className="login-code">
              <span className="hint">If the page shows a code, paste it here.</span>
              <input
                className="inpt mono"
                value={code}
                placeholder="Code"
                aria-label="Sign-in code"
                spellCheck={false}
                disabled={step.sent}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </label>
            {step.sent ? <p className="hint">Checking the code…</p> : null}
          </>
        ) : null}
        {step.s === 'done' ? (
          <p className="hint">
            {[step.email ? `Signed in as ${step.email}` : 'Signed in', step.plan]
              .filter(Boolean)
              .join(' · ')}
            .
          </p>
        ) : null}
        {step.s === 'error' ? <div className="hint err">{step.error}</div> : null}
      </div>
      <div className="dlg-ft">
        {step.s === 'done' ? (
          <button className="btn pri" onClick={closeModal} data-autofocus>
            Done
          </button>
        ) : step.s === 'error' ? (
          <>
            <button
              className="btn gh"
              onClick={() => {
                closeModal()
                actions.loginInTerminal(accountId)
              }}
            >
              Use a terminal instead
            </button>
            <button
              className="btn pri"
              onClick={() => {
                setCode('')
                setStep({ s: 'starting' })
                setAttempt(attempt + 1)
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <button className="btn gh" onClick={closeModal}>
              Cancel
            </button>
            {step.s === 'url' ? (
              <button className="btn pri" onClick={submit} disabled={step.sent || !clean}>
                Continue
              </button>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  )
}
