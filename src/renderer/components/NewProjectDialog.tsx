// New project (#26): name, folder, default account, machine and a first chat in one step,
// opened from the sidebar's + and the palette. The switcher only switches/manages.
import { useEffect, useState } from 'react'
import { contractHome } from '@shared/paths'
import { AGENT_CLI_LABEL } from '@shared/agent-clis'
import { Initial } from './AccountIcon'
import { useActions, useApp, useServices } from '../app/services'
import { Dialog } from './Dialog'
import { FolderPicker } from './FolderPicker'
import { IconBranch, IconCheck, IconClose, IconFolder } from './icons'
import { IS_MAC } from '../app/shortcuts'
import { middleTruncate, splitFolder } from '../lib/folder-path'

export function NewProjectDialog() {
  const { api } = useServices()
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const machines = useApp((s) => s.config.machines)
  const settings = useApp((s) => s.config.settings)
  const recent = useApp((s) => s.config.recentFolders)
  const home = useApp((s) => s.info.homeDir)
  const plans = useApp((s) => s.accountInfo)

  const [name, setName] = useState('')
  // The last name we filled in from a folder pick: typing your own name stops the suggesting.
  const [suggested, setSuggested] = useState('')
  const [folder, setFolder] = useState('')
  const [accountId, setAccountId] = useState<string | null>(
    accounts.find((a) => a.id === settings.defaultAccountId)?.id ?? accounts[0]?.id ?? null
  )
  const [machineId, setMachineId] = useState<string | null>(null)
  const [startChat, setStartChat] = useState(accounts.length > 0)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

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

  const pickFolder = (p: string): void => {
    setFolder(p)
    setPicking(false)
    setError(null)
    const base = splitFolder(p).name
    if (base && (!name.trim() || name === suggested)) {
      setName(base)
      setSuggested(base)
    }
  }
  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(folder || settings.defaultCwd)
    if (picked) pickFolder(contractHome(picked, home))
  }
  const togglePin = (p: string): void =>
    actions.updateSettings({
      pinnedFolders: settings.pinnedFolders.includes(p)
        ? settings.pinnedFolders.filter((x) => x !== p)
        : [p, ...settings.pinnedFolders].slice(0, 20)
    })

  const canCreate = name.trim() !== '' && folder.trim() !== '' && folderState?.ok !== false
  const submit = (e?: React.FormEvent): void => {
    e?.preventDefault()
    if (!canCreate) {
      setError(!name.trim() ? 'Give the project a name.' : 'Pick the project’s folder.')
      return
    }
    const err = actions.createProject({
      name,
      folder: folder.trim(),
      accountId,
      machineId,
      startChat: startChat && !!accountId
    })
    if (err) setError(err)
  }
  const { name: folderName, parent: folderParent } = splitFolder(folder.trim())

  if (picking)
    return (
      <Dialog onClose={actions.closeModal} labelledBy="npj-t" className="pinned np">
        <div className="dlg-hd">
          <h2 id="npj-t">Choose a folder</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Back to New project"
            title="Back (Esc)"
            onClick={() => setPicking(false)}
          >
            <IconClose />
          </button>
        </div>
        <FolderPicker
          start={folder.trim() || settings.defaultCwd}
          recent={recent}
          pinned={settings.pinnedFolders}
          mac={IS_MAC}
          onPick={pickFolder}
          onClose={() => setPicking(false)}
          onTogglePin={togglePin}
          onSystem={() => void browse()}
        />
      </Dialog>
    )

  return (
    <Dialog onClose={actions.closeModal} labelledBy="npj-t" className="pinned np">
      <form onSubmit={submit}>
        <div className="dlg-hd">
          <h2 id="npj-t">New project</h2>
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
            <span className="lbl" id="npj-dir-l">
              Folder
            </span>
            {folder.trim() ? (
              <button
                type="button"
                className={`np-folder${folderState?.ok === false ? ' bad' : ''}`}
                aria-labelledby="npj-dir-l npj-dir-v"
                onClick={() => setPicking(true)}
              >
                <IconFolder />
                <span id="npj-dir-v" className="np-fv" title={folder}>
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
            ) : (
              <button type="button" className="np-folder" onClick={() => setPicking(true)}>
                <IconFolder />
                <span className="np-fv">
                  <span className="np-fn">Choose a folder…</span>
                  <span className="np-fp">New chats in the project start there</span>
                </span>
              </button>
            )}
            {folderState?.ok === false ? (
              <span className="hint err" role="alert">
                {folderState.error}
              </span>
            ) : null}
          </div>

          <div className="fld">
            <label className="lbl" htmlFor="npj-name">
              Name
            </label>
            <input
              id="npj-name"
              className="inpt sans"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder={suggested || 'e.g. wraithgrid'}
              maxLength={64}
              data-autofocus
            />
          </div>

          {accounts.length ? (
            <div className="fld">
              <span className="lbl" id="npj-acc">
                Account
              </span>
              <div className="np-accts" role="radiogroup" aria-labelledby="npj-acc">
                {accounts.map((a) => {
                  const on = a.id === accountId
                  const plan = plans[a.id]?.info?.plan
                  return (
                    <button
                      type="button"
                      key={a.id}
                      className={`np-acct${on ? ' on' : ''}`}
                      role="radio"
                      aria-checked={on}
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
              <span className="hint">The default account for the project’s chats.</span>
            </div>
          ) : (
            <div className="note">
              <span>
                No accounts yet; the project can still be made.{' '}
                <button
                  type="button"
                  className="btn gh"
                  onClick={() => actions.setAccountsMode('add')}
                >
                  Add account
                </button>
              </span>
            </div>
          )}

          {machines.length ? (
            <div className="fld">
              <span className="lbl" id="npj-run">
                Runs on
              </span>
              <div className="seg" role="radiogroup" aria-labelledby="npj-run">
                {[{ id: null as string | null, name: 'This computer' }, ...machines].map((m) => (
                  <button
                    type="button"
                    key={m.id ?? 'local'}
                    className={`seg-btn${machineId === m.id ? ' on' : ''}`}
                    role="radio"
                    aria-checked={machineId === m.id}
                    onClick={() => setMachineId(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="fld">
            <span className="lbl" id="npj-start">
              Start with
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="npj-start">
              <button
                type="button"
                className={`seg-btn${startChat && accountId ? ' on' : ''}`}
                role="radio"
                aria-checked={startChat && !!accountId}
                disabled={!accountId}
                title={accountId ? undefined : 'Needs an account'}
                onClick={() => setStartChat(true)}
              >
                The first chat open
              </button>
              <button
                type="button"
                className={`seg-btn${!startChat || !accountId ? ' on' : ''}`}
                role="radio"
                aria-checked={!startChat || !accountId}
                onClick={() => setStartChat(false)}
              >
                An empty project
              </button>
            </div>
          </div>

          {error ? (
            <div className="note" role="alert" style={{ color: 'var(--err)' }}>
              {error}
            </div>
          ) : null}
        </div>
        <div className="dlg-ft">
          <span className="hint">Enter to create · Esc to cancel</span>
          <button type="button" className="btn gh" onClick={actions.closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={!canCreate}>
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  )
}
