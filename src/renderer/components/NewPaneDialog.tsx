import { useState } from 'react'
import { formatArgs, parseArgs } from '@shared/args'
import { contractHome } from '@shared/paths'
import { AccountIcon } from './AccountIcon'
import { useActions, useApp, useServices } from '../app/services'
import { Dialog } from './Dialog'
import { IconCheck, IconClose, IconFolder } from './icons'

export function NewPaneDialog({ slotId }: { slotId: string | null }) {
  const { api } = useServices()
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const settings = useApp((s) => s.config.settings)
  const recent = useApp((s) => s.config.recentFolders)
  const home = useApp((s) => s.info.homeDir)
  const windows = useApp((s) => s.info.platform === 'win32')
  const shellPath = useApp((s) => s.config.settings.shellPath)
  const shellName = shellPath
    ? (shellPath.split(/[\\/]/).pop() ?? shellPath)
    : windows
      ? 'PowerShell'
      : '$SHELL'

  const initialAccount =
    accounts.find((a) => a.id === settings.defaultAccountId)?.id ?? accounts[0]?.id ?? null
  const [accountId, setAccountId] = useState<string | null>(initialAccount)
  const [folder, setFolder] = useState(recent[0] ?? settings.defaultCwd)
  const [argsText, setArgsText] = useState('')
  const [shell, setShell] = useState(accounts.length === 0)
  const [worktree, setWorktree] = useState(false)
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const account = accounts.find((a) => a.id === accountId)
  const args = parseArgs(argsText)
  const canCreate =
    folder.trim() !== '' && (shell || !!account) && (!worktree || branch.trim() !== '') && !busy
  const runIn = worktree && branch.trim() ? `~/.wraithgrid/worktrees/…/${branch.trim()}` : folder
  const willRun = shell
    ? `cd ${folder || '<folder>'} && ${shellName}`
    : `CLAUDE_CONFIG_DIR=${account?.configDir ?? '<account>'} claude${args.length ? ` ${formatArgs(args)}` : ''}   (in ${runIn || '<folder>'})`

  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(folder || settings.defaultCwd)
    if (picked) setFolder(contractHome(picked, home))
  }

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!canCreate) return
    let cwd = folder.trim()
    if (worktree) {
      setBusy(true)
      setError(null)
      const r = await api.git.addWorktree(cwd, branch.trim())
      setBusy(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      cwd = r.dir
    }
    actions.createPane({
      accountId: shell ? null : accountId,
      cwd,
      args: shell ? [] : args,
      shell,
      slotId
    })
  }

  return (
    <Dialog onClose={actions.closeModal} labelledBy="np-t">
      <form onSubmit={(e) => void submit(e)}>
        <div className="dlg-hd">
          <h2 id="np-t">New pane</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close dialog (Esc)"
            title="Close (Esc)"
            onClick={actions.closeModal}
          >
            <IconClose />
          </button>
        </div>
        <div className="dlg-bd">
          <div className="fld">
            <span className="lbl" id="np-acc">
              Account
            </span>
            {accounts.length === 0 ? (
              <div className="note">
                <span>
                  No accounts yet. A <code>claude</code> pane needs one.{' '}
                  <button
                    type="button"
                    className="btn gh"
                    onClick={() => actions.setAccountsMode('import')}
                  >
                    Import ~/.claude
                  </button>
                  <button
                    type="button"
                    className="btn gh"
                    onClick={() => actions.setAccountsMode('add')}
                  >
                    Add account
                  </button>
                </span>
              </div>
            ) : (
              <div className="apick" role="radiogroup" aria-labelledby="np-acc">
                {accounts.map((a) => {
                  const on = a.id === accountId && !shell
                  return (
                    <button
                      type="button"
                      key={a.id}
                      className={`aopt${on ? ' on' : ''}`}
                      role="radio"
                      aria-checked={on}
                      disabled={shell}
                      onClick={() => setAccountId(a.id)}
                    >
                      <AccountIcon account={a} size={22} />
                      <span className="tx">
                        <span className="nm">{a.name}</span>
                        <span className={`sb${a.signedIn ? '' : ' warn'}`}>
                          {a.signedIn ? a.configDir : 'Not signed in · run /login in the pane'}
                        </span>
                      </span>
                      {on ? <IconCheck className="ck" /> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="fld">
            <label className="lbl" htmlFor="np-dir">
              Working directory
            </label>
            <div className="inrow">
              <input
                id="np-dir"
                className="inpt"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                spellCheck={false}
                data-autofocus
              />
              <button type="button" className="btn" onClick={() => void browse()}>
                <IconFolder />
                Browse…
              </button>
            </div>
            {recent.length ? (
              <div className="recent" aria-label="Recent folders">
                <span className="hint" style={{ alignSelf: 'center', marginRight: 2 }}>
                  Recent
                </span>
                {recent.slice(0, 5).map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={`rchip${r === folder ? ' on' : ''}`}
                    onClick={() => setFolder(r)}
                    title={r}
                  >
                    {r}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="fld">
            <label className="lbl" htmlFor="np-args">
              Launch args <em>optional</em>
            </label>
            <input
              id="np-args"
              className="inpt"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="--resume"
              disabled={shell}
              spellCheck={false}
            />
            <div className="recent">
              <button
                type="button"
                className="rchip"
                disabled={shell}
                onClick={() => setArgsText('--resume')}
              >
                --resume
              </button>
              <button
                type="button"
                className="rchip"
                disabled={shell}
                onClick={() => setArgsText('-c')}
              >
                -c
              </button>
              <span className="hint" style={{ alignSelf: 'center' }}>
                Continue the last conversation with <span className="mono">-c</span>.
              </span>
            </div>
          </div>

          <div className="trow">
            <span className="tx">
              <span style={{ fontWeight: 600 }}>Work on a new branch (git worktree)</span>
              <span className="hint">
                A separate checkout, so this pane's edits don't collide with other panes in the same
                repo.
              </span>
            </span>
            <button
              type="button"
              className={`sw${worktree ? ' on' : ''}`}
              role="switch"
              aria-checked={worktree}
              aria-label="Work on a new branch (git worktree)"
              onClick={() => {
                setWorktree((v) => !v)
                setError(null)
              }}
            />
          </div>
          {worktree ? (
            <div className="fld">
              <label className="lbl" htmlFor="np-branch">
                New branch
              </label>
              <input
                id="np-branch"
                className="inpt"
                value={branch}
                maxLength={100}
                onChange={(e) => {
                  setBranch(e.target.value)
                  setError(null)
                }}
                placeholder="feat/rate-limit"
                spellCheck={false}
                autoFocus
              />
              <span className="hint">
                Branches off the folder's current commit, in{' '}
                <span className="mono">~/.wraithgrid/worktrees</span>.
              </span>
            </div>
          ) : null}
          {error ? (
            <div className="note" role="alert" style={{ color: 'var(--err)' }}>
              {error}
            </div>
          ) : null}

          <div className="trow">
            <span className="tx">
              <span style={{ fontWeight: 600 }}>Open a plain shell instead</span>
              <span className="hint">
                Runs <span className="mono">{shellName}</span> in the same folder, no{' '}
                <span className="mono">claude</span>.
              </span>
            </span>
            <button
              type="button"
              className={`sw${shell ? ' on' : ''}`}
              role="switch"
              aria-checked={shell}
              aria-label="Open a plain shell instead"
              onClick={() => setShell((v) => !v)}
            />
          </div>

          <div className="fld">
            <span className="lbl">Will run</span>
            <div className="cmd">{willRun}</div>
          </div>
        </div>
        <div className="dlg-ft">
          <span className="hint">Enter to create · Esc to cancel</span>
          <button type="button" className="btn gh" onClick={actions.closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={!canCreate}>
            {busy ? 'Creating worktree…' : 'Create pane'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
