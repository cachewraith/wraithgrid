// New chat / New pane: Account → Folder → Start, the rest under More options. The folder is
// picked in the app's own picker (FolderPicker); main lists and checks folders.
import { useEffect, useState } from 'react'
import { formatArgs, parseArgs } from '@shared/args'
import { contractHome } from '@shared/paths'
import { AGENT_CLI_LABEL, AGENT_CLI_SPECS, type AgentCli } from '@shared/agent-clis'
import { Initial } from './AccountIcon'
import { useActions, useApp, useServices } from '../app/services'
import { Dialog } from './Dialog'
import { IconBranch, IconCheck, IconChevron, IconClose, IconFolder } from './icons'
import { FolderPicker } from './FolderPicker'
import { IS_MAC } from '../app/shortcuts'
import { middleTruncate, splitFolder } from '../lib/folder-path'

/** How the preview shows the CLI's config dir variable (some CLIs have none). */
const cliEnvPrefix = (cli: AgentCli, dir: string): string => {
  const v = AGENT_CLI_SPECS[cli].configDirVar
  return v ? `${v}=${dir} ` : ''
}

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
  // Opens as a chat: the dialog says so (a shell, or Terminal as the default, is a pane).
  const chatLike = !shell && settings.newPaneView === 'chat'
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [more, setMore] = useState(accounts.length === 0)
  const plans = useApp((s) => s.accountInfo)
  const pinned = settings.pinnedFolders
  // The chosen folder, checked in main: exists, and its git branch.
  const [checked, setChecked] = useState<{
    folder: string
    ok: boolean
    branch: string | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    let live = true
    const f = folder.trim()
    if (!f) return
    void api.fs.listFolder(f).then((r) => {
      if (live)
        setChecked({
          folder: f,
          ok: r.ok,
          branch: r.ok ? r.branch : null,
          error: r.ok ? null : r.error
        })
    })
    return () => {
      live = false
    }
  }, [api, folder])
  const folderState = checked?.folder === folder.trim() ? checked : null

  const account = accounts.find((a) => a.id === accountId)
  const cli = account?.cli ?? 'claude'
  const args = parseArgs(argsText)
  const canCreate =
    folder.trim() !== '' &&
    folderState?.ok !== false &&
    (shell || !!account) &&
    (!worktree || branch.trim() !== '') &&
    !busy
  const runIn = worktree && branch.trim() ? `~/.wraithgrid/worktrees/…/${branch.trim()}` : folder
  const willRun = shell
    ? `cd ${folder || '<folder>'} && ${shellName}`
    : `${cliEnvPrefix(cli, account?.configDir ?? '<account>')}${AGENT_CLI_SPECS[cli].bin}${args.length ? ` ${formatArgs(args)}` : ''}   (in ${runIn || '<folder>'})`

  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(folder || settings.defaultCwd)
    if (picked) {
      setFolder(contractHome(picked, home))
      setPicking(false)
    }
  }
  const togglePin = (p: string): void =>
    actions.updateSettings({
      pinnedFolders: pinned.includes(p)
        ? pinned.filter((x) => x !== p)
        : [p, ...pinned].slice(0, 20)
    })
  const { name: folderName, parent: folderParent } = splitFolder(folder.trim() || '~')

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

  if (picking)
    return (
      <Dialog onClose={actions.closeModal} labelledBy="np-t" className="pinned np">
        <div className="dlg-hd">
          <h2 id="np-t">Choose a folder</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Back to New chat"
            title="Back (Esc)"
            onClick={() => setPicking(false)}
          >
            <IconClose />
          </button>
        </div>
        <FolderPicker
          start={folder.trim() || settings.defaultCwd}
          recent={recent}
          pinned={pinned}
          mac={IS_MAC}
          onPick={(p) => {
            setFolder(p)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
          onTogglePin={togglePin}
          onSystem={() => void browse()}
        />
      </Dialog>
    )

  return (
    <Dialog onClose={actions.closeModal} labelledBy="np-t" className="pinned np">
      <form onSubmit={(e) => void submit(e)}>
        <div className="dlg-hd">
          <h2 id="np-t">{chatLike ? 'New chat' : 'New pane'}</h2>
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
                  No accounts yet. An agent pane needs one.{' '}
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
              <div className="np-accts" role="radiogroup" aria-labelledby="np-acc">
                {accounts.map((a) => {
                  const on = a.id === accountId && !shell
                  const plan = plans[a.id]?.info?.plan
                  return (
                    <button
                      type="button"
                      key={a.id}
                      className={`np-acct${on ? ' on' : ''}`}
                      role="radio"
                      aria-checked={on}
                      disabled={shell}
                      onClick={() => setAccountId(a.id)}
                    >
                      <Initial name={a.name} size={20} />
                      <span className="nm">{a.name}</span>
                      <span className="sb" title={AGENT_CLI_LABEL[a.cli]}>
                        {[a.cli, plan].filter(Boolean).join(' · ')}
                      </span>
                      {a.signedIn ? null : <span className="sb warn">not signed in</span>}
                      {on ? <IconCheck className="ck" /> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="fld">
            <span className="lbl" id="np-dir-l">
              Folder
            </span>
            <button
              type="button"
              className={`np-folder${folderState?.ok === false ? ' bad' : ''}`}
              aria-labelledby="np-dir-l np-dir-v"
              onClick={() => setPicking(true)}
            >
              <IconFolder />
              <span id="np-dir-v" className="np-fv" title={folder}>
                <span className="np-fn">{folderName}</span>
                {folderParent ? (
                  <span className="np-fp">{middleTruncate(folderParent, 48)}</span>
                ) : null}
              </span>
              {folderState?.branch ? (
                <span className="np-br">
                  <IconBranch small />
                  {folderState.branch}
                </span>
              ) : null}
              <span className="np-change">Change</span>
            </button>
            {folderState?.ok === false ? (
              <span className="hint err" role="alert">
                {folderState.error}
              </span>
            ) : null}
            {recent.filter((r) => r !== folder).length ? (
              <div className="np-recent" aria-label="Recent folders">
                {recent
                  .filter((r) => r !== folder)
                  .slice(0, 4)
                  .map((r) => {
                    const { name, parent } = splitFolder(r)
                    return (
                      <button type="button" key={r} className="np-r" onClick={() => setFolder(r)}>
                        <span className="np-rn">{name}</span>
                        <span className="np-rp">{middleTruncate(parent, 56)}</span>
                      </button>
                    )
                  })}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="np-more"
            aria-expanded={more}
            aria-controls="np-more"
            onClick={() => setMore((v) => !v)}
          >
            <IconChevron small className={`np-more-i${more ? ' open' : ''}`} />
            More options
            {!more && (argsText || worktree || shell) ? (
              <span className="np-more-on">
                {[argsText && 'args', worktree && 'worktree', shell && 'shell']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : null}
          </button>
          {more ? (
            <div id="np-more" className="np-more-bd">
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
                  <span style={{ fontWeight: 500 }}>Work on a new branch (git worktree)</span>
                  <span className="hint">
                    A separate checkout, so edits don't collide with other panes in the repo.
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

              <div className="trow">
                <span className="tx">
                  <span style={{ fontWeight: 500 }}>Open a plain shell instead</span>
                  <span className="hint">
                    Runs <span className="mono">{shellName}</span> in the same folder.
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
          ) : null}
          {error ? (
            <div className="note" role="alert" style={{ color: 'var(--err)' }}>
              {error}
            </div>
          ) : null}
        </div>
        <div className="dlg-ft">
          <span className="hint">Enter to start · Esc to cancel</span>
          <button type="button" className="btn gh" onClick={actions.closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={!canCreate} data-autofocus>
            {busy ? 'Creating worktree…' : chatLike ? 'Start chat' : 'Create pane'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
