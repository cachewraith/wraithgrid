import { useState } from 'react'
import { contractHome, slugify } from '@shared/paths'
import { ACCOUNT_COLORS, type Account } from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { nextFreeColor } from '../app/store'
import { IconPicker } from './IconPicker'
import { Dialog } from './Dialog'
import {
  IconCheck,
  IconFolder,
  IconImport,
  IconInfo,
  IconLogin,
  IconPlus,
  IconRename,
  IconTrash,
  IconWarn
} from './icons'

function AddAccountForm() {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => nextFreeColor(accounts))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    const err = await actions.addAccount(name, color)
    setBusy(false)
    if (err) setError(err)
    else actions.setAccountsMode('list')
  }

  return (
    <form className="card" aria-label="Add account" onSubmit={(e) => void submit(e)}>
      <h2>Add account</h2>
      <div className="frow">
        <div className="fld">
          <label className="lbl" htmlFor="acc-name">
            Name
          </label>
          <input
            id="acc-name"
            className="inpt sans"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="e.g. freelance"
            maxLength={64}
            autoFocus
          />
          <div className="hint">
            Config dir:{' '}
            <span className="mono" style={{ color: 'var(--mu)' }}>
              ~/.wraithgrid/accounts/{slugify(name) || '<name>'}
            </span>{' '}
            (created for you)
          </div>
          {error ? <div className="hint err">{error}</div> : null}
        </div>
        <div className="fld">
          <span className="lbl" id="acc-color">
            Color tag
          </span>
          <div className="colors" role="radiogroup" aria-labelledby="acc-color">
            {ACCOUNT_COLORS.map((c) => {
              const on = c.value === color
              return (
                <button
                  type="button"
                  key={c.value}
                  className={`cpick${on ? ' on' : ''}`}
                  role="radio"
                  aria-checked={on}
                  aria-label={c.name}
                  onClick={() => setColor(c.value)}
                >
                  <span className="c" style={{ background: c.value }}>
                    {on ? <IconCheck style={{ strokeWidth: 2.2 }} /> : null}
                  </span>
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="note">
        <IconInfo style={{ marginTop: 2 }} />
        <span>
          After saving, use <b>Login</b> to open a pane running <code>claude</code> under this
          account and run <code>/login</code> there.
        </span>
      </div>
      <div className="form-acts">
        <button type="button" className="btn gh" onClick={() => actions.setAccountsMode('list')}>
          Cancel
        </button>
        <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
          Add account
        </button>
      </div>
    </form>
  )
}

function ImportAccountForm() {
  const { api } = useServices()
  const actions = useActions()
  const home = useApp((s) => s.info.homeDir)
  const [dir, setDir] = useState('~/.claude')
  const [error, setError] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(dir || '~')
    if (picked) setDir(contractHome(picked, home))
  }
  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const err = actions.importAccount(dir)
    if (err) setError(err)
    else actions.setAccountsMode('list')
  }

  return (
    <form className="card" aria-label="Import existing config dir" onSubmit={submit}>
      <h2>Import an existing config dir</h2>
      <div className="fld">
        <label className="lbl" htmlFor="imp-dir">
          Folder
        </label>
        <div className="inrow">
          <input
            id="imp-dir"
            className="inpt"
            value={dir}
            onChange={(e) => {
              setDir(e.target.value)
              setError(null)
            }}
            spellCheck={false}
            autoFocus
          />
          <button type="button" className="btn" onClick={() => void browse()}>
            <IconFolder />
            Browse…
          </button>
        </div>
        <div className="hint">
          The folder stays where it is. Wraithgrid points <code>CLAUDE_CONFIG_DIR</code> at it;
          nothing is copied.
        </div>
        {error ? <div className="hint err">{error}</div> : null}
      </div>
      <div className="form-acts">
        <button type="button" className="btn gh" onClick={() => actions.setAccountsMode('list')}>
          Cancel
        </button>
        <button type="submit" className="btn pri" disabled={!dir.trim()}>
          Import as account
        </button>
      </div>
    </form>
  )
}

function AccountRow({ account, uses }: { account: Account; uses: number }) {
  const actions = useActions()
  const sharedNote = useApp((s) =>
    s.config.settings.sharedMode === 'overall'
      ? 'Uses the CLAUDE.md, settings, skills and plugins of ~/.claude'
      : null
  )
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(account.name)

  const save = (): void => {
    actions.renameAccount(account.id, name)
    setRenaming(false)
  }
  const cancel = (): void => {
    setName(account.name)
    setRenaming(false)
  }

  return (
    <div className="tr" role="row">
      <span className="nm" role="cell">
        <IconPicker
          icon={account.icon}
          name={account.name}
          color={account.color}
          onPick={(icon) => actions.setAccountIcon(account.id, icon)}
        />
        {renaming ? (
          <input
            className="inpt sans"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                cancel()
              }
            }}
            aria-label="Account name"
            maxLength={64}
            style={{ height: 30 }}
            autoFocus
          />
        ) : (
          <span>{account.name}</span>
        )}
      </span>
      <span className="dir" role="cell" title={account.configDir}>
        {account.configDir}
        {account.imported ? <small>Imported existing config dir</small> : null}
        {sharedNote ? <small>{sharedNote}</small> : null}
      </span>
      <span className={`badge${account.signedIn ? '' : ' warn'}`} role="cell">
        {account.signedIn ? <IconCheck small /> : <IconWarn small />}
        {account.signedIn ? 'Signed in' : 'Not signed in'}
      </span>
      <span className="num" role="cell">
        {uses}
      </span>
      <span className="acts" role="cell">
        {renaming ? (
          <>
            <button className="btn gh" onClick={cancel}>
              Cancel
            </button>
            <button className="btn pri" onClick={save} disabled={!name.trim()}>
              Save
            </button>
          </>
        ) : (
          <>
            <button
              className={`btn ${account.signedIn ? 'gh' : 'pri'}`}
              onClick={() => actions.loginAccount(account.id)}
              title={`Open a pane running claude under ${account.name}`}
            >
              <IconLogin small />
              Login
            </button>
            <button
              className="icon-btn"
              aria-label={`Rename ${account.name}`}
              title="Rename"
              onClick={() => {
                setName(account.name)
                setRenaming(true)
              }}
            >
              <IconRename />
            </button>
            <button
              className="icon-btn"
              aria-label={`Remove ${account.name}`}
              title="Remove"
              onClick={() => actions.openModal({ kind: 'removeAccount', accountId: account.id })}
            >
              <IconTrash />
            </button>
          </>
        )}
      </span>
    </div>
  )
}

export function AccountsView() {
  const actions = useActions()
  const mode = useApp((s) => s.accountsMode)
  const accounts = useApp((s) => s.config.accounts)
  const workspaces = useApp((s) => s.config.workspaces)
  const uses = (id: string): number =>
    workspaces.reduce((n, w) => n + w.panes.filter((p) => p.accountId === id).length, 0)

  return (
    <div className="page">
      <div className="page-in">
        <div className="pg-hd">
          <div>
            <h1>Accounts</h1>
            <p>
              Each account is its own <code>CLAUDE_CONFIG_DIR</code>, with its own login, settings
              and history. Wraithgrid never reads files inside it.
            </p>
          </div>
          <div className="acts">
            <button className="btn" onClick={() => actions.setAccountsMode('import')}>
              <IconImport />
              Import ~/.claude
            </button>
            <button className="btn pri" onClick={() => actions.setAccountsMode('add')}>
              <IconPlus />
              Add account
            </button>
          </div>
        </div>

        {mode === 'add' ? <AddAccountForm /> : null}
        {mode === 'import' ? <ImportAccountForm /> : null}

        {accounts.length > 0 ? (
          <div className="tbl" role="table" aria-label="Accounts">
            <div className="tr hd" role="row">
              <span role="columnheader">Account</span>
              <span role="columnheader">Config dir</span>
              <span role="columnheader">Login</span>
              <span role="columnheader">Panes</span>
              <span role="columnheader" style={{ textAlign: 'right' }}>
                Actions
              </span>
            </div>
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} uses={uses(a.id)} />
            ))}
          </div>
        ) : mode === 'list' ? (
          <div className="emptyc">
            <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="16" r="7" fill="none" stroke="var(--acc)" strokeWidth="2" />
              <path
                d="M9 37c2-7 7-10 13-10s11 3 13 10"
                fill="none"
                stroke="var(--empty-line)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <h2>No accounts yet</h2>
            <p>
              Add an account to give panes their own login. Already use <code>claude</code> on this
              machine? Import <span className="mono">~/.claude</span> to keep that login.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => actions.setAccountsMode('import')}>
                Import ~/.claude
              </button>
              <button className="btn pri" onClick={() => actions.setAccountsMode('add')}>
                Add account
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function RemoveAccountDialog({ accountId }: { accountId: string }) {
  const actions = useActions()
  const account = useApp((s) => s.config.accounts.find((a) => a.id === accountId))
  const workspaces = useApp((s) => s.config.workspaces)
  const [deleteDir, setDeleteDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!account) return null

  const uses = workspaces.reduce(
    (n, w) => n + w.panes.filter((p) => p.accountId === accountId).length,
    0
  )
  const panesMsg = uses
    ? `${uses} ${uses > 1 ? 'panes use' : 'pane uses'} this account and will close.`
    : 'No panes use this account.'

  const confirm = async (): Promise<void> => {
    setBusy(true)
    const err = await actions.removeAccount(accountId, deleteDir)
    setBusy(false)
    if (err) setError(err)
    else actions.closeModal()
  }

  return (
    <Dialog onClose={actions.closeModal} className="w4" role="alertdialog" labelledBy="rm-t">
      <div className="dlg-hd">
        <h2 id="rm-t">Remove account “{account.name}”?</h2>
      </div>
      <div className="dlg-bd" style={{ gap: 14 }}>
        <p className="hint" style={{ fontSize: 13, color: 'var(--mu)', margin: 0 }}>
          {panesMsg} The account is removed from Wraithgrid.
        </p>
        <div className="trow">
          <span className="tx">
            <span style={{ fontWeight: 600 }}>Also delete its config dir</span>
            <span className="hint mono">{account.configDir}</span>
            <span className="hint">
              Deletes the login, settings and history. This cannot be undone.
            </span>
          </span>
          <button
            className={`sw${deleteDir ? ' on' : ''}`}
            role="switch"
            aria-checked={deleteDir}
            aria-label="Also delete config dir"
            onClick={() => setDeleteDir((v) => !v)}
          />
        </div>
        {error ? <div className="hint err">{error}</div> : null}
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Cancel
        </button>
        <button className="btn dng" onClick={() => void confirm()} disabled={busy}>
          {deleteDir ? 'Remove and delete dir' : 'Remove account'}
        </button>
      </div>
    </Dialog>
  )
}
