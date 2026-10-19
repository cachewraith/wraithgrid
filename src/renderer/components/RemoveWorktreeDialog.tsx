// Asked after closing the last pane on a Wraithgrid worktree: keep its folder, or remove it.
// The branch and its commits always stay; uncommitted files are named before they are lost.
import { useEffect, useState } from 'react'
import { useActions, useServices } from '../app/services'
import { Dialog } from './Dialog'

type Check = { branch: string | null; changed: number } | { error: string } | null

export function RemoveWorktreeDialog({ cwd, title }: { cwd: string; title: string }) {
  const { api } = useServices()
  const actions = useActions()
  const [check, setCheck] = useState<Check>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void api.git.checkWorktree(cwd).then((r) => {
      if (live) setCheck(r.ok ? { branch: r.branch, changed: r.changed } : { error: r.error })
    })
    return () => {
      live = false
    }
  }, [api, cwd])

  const dirty = check && 'changed' in check ? check.changed : 0
  const remove = async (): Promise<void> => {
    setBusy(true)
    const r = await api.git.removeWorktree(cwd, dirty > 0)
    setBusy(false)
    if (r.ok) actions.closeModal()
    else setError(r.error)
  }

  return (
    <Dialog onClose={actions.closeModal} className="w4" role="alertdialog" labelledBy="rmwt-t">
      <div className="dlg-hd">
        <h2 id="rmwt-t">Remove the worktree of “{title}”?</h2>
      </div>
      <div className="dlg-bd" style={{ gap: 10 }}>
        <p className="hint mono" style={{ margin: 0 }}>
          {cwd}
        </p>
        <p className="hint" style={{ fontSize: 13, color: 'var(--mu)', margin: 0 }}>
          {check === null
            ? 'Checking it for uncommitted work…'
            : 'error' in check
              ? check.error
              : `${check.branch ? `Branch ${check.branch} and its commits stay in the repository. ` : ''}${
                  dirty
                    ? `${dirty} ${dirty === 1 ? 'file is' : 'files are'} not committed and will be lost.`
                    : 'Everything in it is committed.'
                }`}
        </p>
        {error ? <div className="hint err">{error}</div> : null}
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Keep it
        </button>
        <button
          className="btn dng"
          onClick={() => void remove()}
          disabled={busy || !check || 'error' in check}
        >
          {dirty ? `Remove and lose ${dirty} ${dirty === 1 ? 'file' : 'files'}` : 'Remove worktree'}
        </button>
      </div>
    </Dialog>
  )
}
