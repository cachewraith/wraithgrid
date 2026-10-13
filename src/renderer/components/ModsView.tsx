// Mods are claude plugins that change claude's own screen (panes, a band above the prompt,
// status lines, toasts). This view shows which ones each claude account has installed, the
// local mod folders every claude pane loads, and what a pane needs to draw them well.
import { useEffect, useState } from 'react'
import type { AccountMods, CatalogMod, ModCatalogResult, ModInfo } from '@shared/ipc-contract'
import { contractHome } from '@shared/paths'
import { MOD_DIRS_MAX, MOD_PANE_MIN_COLS, type Account } from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { formatInstalls, searchMods } from '../lib/mod-catalog'
import { AccountIcon } from './AccountIcon'
import { IconClose, IconFolder, IconRestart } from './icons'

function ModRow({
  accountId,
  mod,
  onChanged
}: {
  accountId: string
  mod: ModInfo
  onChanged: () => void
}) {
  const actions = useActions()
  const home = useApp((s) => s.info.homeDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const at = mod.id.lastIndexOf('@')
  const name = at > 0 ? mod.id.slice(0, at) : mod.id
  const source = at > 0 ? mod.id.slice(at + 1) : ''

  const toggle = async (): Promise<void> => {
    setBusy(true)
    const err = await actions.setModEnabled(accountId, mod, !mod.enabled)
    setBusy(false)
    setError(err)
    if (!err) onChanged()
  }

  return (
    <div className="mod-row">
      <div className="mod-tx">
        <span className="mod-nm">
          {name}
          <span className="cli-tag">{mod.version}</span>
        </span>
        <span className="hint">
          {[source, mod.scope, mod.projectPath ? contractHome(mod.projectPath, home) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {mod.notes.map((n) => (
          <span className="hint" key={n}>
            {n}
          </span>
        ))}
        {error ? <span className="hint err">{error}</span> : null}
      </div>
      <button
        className={`sw${mod.enabled ? ' on' : ''}`}
        role="switch"
        aria-checked={mod.enabled}
        aria-label={`${name} enabled`}
        disabled={busy}
        onClick={() => void toggle()}
      />
    </div>
  )
}

function AccountModsRow({
  account,
  result,
  onChanged
}: {
  account: Account
  result: AccountMods | undefined
  onChanged: () => void
}) {
  return (
    <div className="srow">
      <div>
        <h3 className="mod-acc">
          <AccountIcon account={account} size={18} />
          {account.name}
        </h3>
        <p className="ex mono">{account.configDir}</p>
      </div>
      <div className="ctl">
        {!result ? (
          <span className="hint">Asking claude…</span>
        ) : !result.ok ? (
          <span className="hint err">{result.error}</span>
        ) : result.mods.length === 0 ? (
          <span className="hint">No mods installed. Find one under Browse below.</span>
        ) : (
          <div className="mod-list">
            {result.mods.map((m) => (
              <ModRow
                key={`${m.id}|${m.scope}|${m.projectPath ?? ''}`}
                accountId={account.id}
                mod={m}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const CATALOG_PAGE = 20

function CatalogRow({
  mod,
  installed,
  onInstall
}: {
  mod: CatalogMod
  installed: boolean
  onInstall: () => Promise<string | null>
}) {
  const { api } = useServices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const install = async (): Promise<void> => {
    setBusy(true)
    setError(await onInstall())
    setBusy(false)
  }

  return (
    <div className="mod-row">
      <div className="mod-tx">
        <span className="mod-nm">
          {mod.name}
          {mod.version ? <span className="cli-tag">{mod.version}</span> : null}
        </span>
        {mod.description ? <span className="mod-desc">{mod.description}</span> : null}
        <span className="hint">
          {[
            mod.marketplace,
            mod.installs !== null ? `${formatInstalls(mod.installs)} installs` : null
          ]
            .filter(Boolean)
            .join(' · ')}
          {mod.url ? (
            <>
              {' · '}
              <button className="mod-link" onClick={() => void api.shell.openExternal(mod.url!)}>
                Source
              </button>
            </>
          ) : null}
        </span>
        {error ? <span className="hint err">{error}</span> : null}
      </div>
      {installed ? (
        <span className="badge">Installed</span>
      ) : (
        <button
          className="btn"
          disabled={busy}
          aria-label={`Install ${mod.name}`}
          onClick={() => void install()}
        >
          {busy ? 'Installing…' : 'Install'}
        </button>
      )}
    </div>
  )
}

/** The catalog of the account's marketplaces: search it and install without leaving the app. */
function BrowseRow({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const { api } = useServices()
  const actions = useActions()
  const listed = useApp((s) => s.mods.accounts)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? null)
  // Kept with the account it was read for, so another account's catalog is never shown.
  const [loaded, setLoaded] = useState<{ id: string; res: ModCatalogResult } | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(CATALOG_PAGE)
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const id = account?.id ?? null

  useEffect(() => {
    if (!id) return
    let stale = false
    void api.mods.catalog(id).then((res) => {
      if (!stale) setLoaded({ id, res })
    })
    return () => {
      stale = true
    }
  }, [api, id])

  const res = loaded && loaded.id === id ? loaded.res : null
  const catalog = res?.ok ? res.mods : null
  const error = res && !res.ok ? res.error : null

  if (!account) return null
  const mine = listed?.find((r) => r.accountId === account.id)
  const installed = new Set(mine?.ok ? mine.mods.map((m) => m.id) : [])
  const found = catalog ? searchMods(catalog, query) : []

  const install = async (mod: CatalogMod): Promise<string | null> => {
    const res = await api.mods.install(account.id, mod.id)
    if (!res.ok) return res.error
    await actions.loadMods()
    onChanged()
    return null
  }

  return (
    <div className="srow">
      <div>
        <h3 id="browse-h">Find a mod</h3>
        <p className="ex">
          Everything the account's marketplaces offer. A mod runs as you, with your files and
          logins: install the ones you trust.
        </p>
      </div>
      <div className="ctl">
        {accounts.length > 1 ? (
          <div className="recent" role="radiogroup" aria-label="Install for account">
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`rchip${a.id === account.id ? ' on' : ''}`}
                role="radio"
                aria-checked={a.id === account.id}
                onClick={() => setAccountId(a.id)}
                style={{ fontFamily: 'inherit', fontSize: 12.5, height: 30 }}
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : null}
        <input
          className="inpt sans"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(CATALOG_PAGE)
          }}
          placeholder="Search mods by name or what they do"
          aria-labelledby="browse-h"
          disabled={!catalog}
        />
        {error ? (
          <span className="hint err">{error}</span>
        ) : !catalog ? (
          <span className="hint">Asking claude for the catalog…</span>
        ) : found.length === 0 ? (
          <span className="hint">No mod matches “{query.trim()}”.</span>
        ) : (
          <>
            <span className="hint" role="status">
              {query.trim()
                ? `${found.length} ${found.length === 1 ? 'mod' : 'mods'} found`
                : `${found.length} mods, most installed first`}
            </span>
            <div className="mod-list">
              {found.slice(0, limit).map((m) => (
                <CatalogRow
                  key={m.id}
                  mod={m}
                  installed={installed.has(m.id)}
                  onInstall={() => install(m)}
                />
              ))}
            </div>
            {found.length > limit ? (
              <button
                className="btn gh"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setLimit(limit + CATALOG_PAGE)}
              >
                Show more
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function ModFoldersRow({ onChanged }: { onChanged: () => void }) {
  const { api } = useServices()
  const actions = useActions()
  const dirs = useApp((s) => s.config.settings.modDirs)
  const home = useApp((s) => s.info.homeDir)
  const full = dirs.length >= MOD_DIRS_MAX

  const save = (next: string[]): void => {
    actions.updateSettings({ modDirs: next })
    onChanged()
  }
  const add = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(dirs[dirs.length - 1] ?? '~')
    if (!picked) return
    const dir = contractHome(picked, home)
    if (!dirs.includes(dir)) save([...dirs, dir])
  }

  return (
    <div className="srow">
      <div>
        <h3 id="moddirs-h">Mod folders</h3>
        <p className="ex">
          For a mod you are building or keep in a folder of your own. Every claude pane, in every
          account, loads it without installing it.
        </p>
      </div>
      <div className="ctl">
        {dirs.length ? (
          <div className="mod-list" role="list" aria-labelledby="moddirs-h">
            {dirs.map((d) => (
              <div className="mod-row" role="listitem" key={d}>
                <span className="mod-dir" title={d}>
                  {d}
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${d}`}
                  title="Remove"
                  onClick={() => save(dirs.filter((x) => x !== d))}
                >
                  <IconClose />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          disabled={full}
          onClick={() => void add()}
        >
          <IconFolder />
          Add folder…
        </button>
        <span className="hint">
          Pick the mod's own folder, the one that holds{' '}
          <span className="mono">.claude-plugin/plugin.json</span>. Passed to claude as{' '}
          <span className="mono">CLAUDE_CODE_PLUGIN_DIRS</span>; claude reloads the mod when its
          files change.
        </span>
      </div>
    </div>
  )
}

function DisplayRows() {
  const { bus } = useServices()
  const actions = useActions()
  const gpu = useApp((s) => s.config.settings.gpuTerminal)
  const notify = useApp((s) => s.config.settings.notifyPanes)
  // Sizes live outside the store; read when the view opens, which is when they are looked at.
  const widths = useApp((s) =>
    s.config.workspaces
      .flatMap((w) => w.panes)
      .filter((p) => !p.shell && s.runtime[p.id]?.started)
      .map((p) => bus.size(p.id).cols)
      .join(',')
  )
  const cols = widths ? widths.split(',').map(Number) : []
  const narrow = cols.filter((c) => c < MOD_PANE_MIN_COLS).length

  return (
    <>
      <div className="srow">
        <div>
          <h3>Room for mod panes</h3>
          <p className="ex">
            A side pane a mod opens by itself is seated from {MOD_PANE_MIN_COLS} columns; below that
            claude holds it back.
          </p>
        </div>
        <div className="ctl">
          <span className="hint" role="status">
            {cols.length === 0
              ? 'No claude pane is running.'
              : narrow === 0
                ? 'Every running claude pane is wide enough.'
                : `${narrow} of ${cols.length} running claude panes are narrower than ${MOD_PANE_MIN_COLS} columns.`}{' '}
            Zoom a pane ({SHORTCUT_HINT.zoom}) or make the terminal text smaller to give a mod room.
          </span>
        </div>
      </div>
      <div className="srow">
        <div>
          <h3>Animation</h3>
          <p className="ex">
            Mods can redraw many times a second. Drawing panes with the GPU keeps that smooth, also
            with several panes animating at once.
          </p>
        </div>
        <div className="ctl">
          <div className="swrow">
            <button
              className={`sw${gpu ? ' on' : ''}`}
              role="switch"
              aria-checked={gpu}
              aria-labelledby="set-gpu"
              onClick={() => actions.updateSettings({ gpuTerminal: !gpu })}
            />
            <span id="set-gpu">Draw panes with the GPU</span>
          </div>
          <span className="hint">
            Applies at once. A pane that cannot get a GPU context keeps the standard renderer.
          </span>
        </div>
      </div>
      <div className="srow">
        <div>
          <h3>Copy and notifications</h3>
          <p className="ex">What a mod asks the terminal for, Wraithgrid carries out.</p>
        </div>
        <div className="ctl">
          <span className="hint">
            Text a mod copies lands on your clipboard. A mod's notification becomes a desktop
            notification for a pane you aren't looking at
            {notify ? '' : ' (pane notifications are off in Settings)'}; claude only sends those
            once <span className="mono">preferredNotifChannel</span> in its settings is{' '}
            <span className="mono">ghostty</span>, <span className="mono">iterm2</span> or{' '}
            <span className="mono">kitty</span>. Pictures a mod draws show as their text
            description.
          </span>
        </div>
      </div>
    </>
  )
}

export function ModsView() {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const mods = useApp((s) => s.mods)
  const [changed, setChanged] = useState(false)
  const [restarted, setRestarted] = useState<number | null>(null)
  const claudeAccounts = accounts.filter((a) => a.cli === 'claude')

  // The action itself is stable; `actions` is the whole state and changes with every update.
  const { loadMods } = actions
  useEffect(() => {
    void loadMods()
  }, [loadMods])

  return (
    <div className="page">
      <div className="set">
        <div className="pg-hd" style={{ paddingBottom: 18 }}>
          <div>
            <h1>Mods</h1>
            <p>
              Mods change claude's own screen: side panes, a band above the prompt, status lines,
              toasts, commands. Each pane draws the mods its account has.
            </p>
          </div>
          <div className="acts">
            <button className="btn" disabled={mods.loading} onClick={() => void actions.loadMods()}>
              <IconRestart />
              {mods.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {changed ? (
          <div className="note" role="status">
            <span>
              Running claude panes load mods when they start.{' '}
              {restarted !== null ? `Restarted ${restarted}.` : null}
            </span>
            <button
              className="btn gh"
              style={{ height: 26, fontSize: 12, marginLeft: 'auto' }}
              onClick={() => setRestarted(actions.restartClaudePanes())}
            >
              Restart claude panes
            </button>
          </div>
        ) : null}

        <h2 className="sgrp">Installed</h2>
        {claudeAccounts.length === 0 ? (
          <div className="srow">
            <div>
              <h3>No claude account yet</h3>
            </div>
            <div className="ctl">
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => actions.setAccountsMode('add')}
              >
                Add account
              </button>
            </div>
          </div>
        ) : (
          claudeAccounts.map((a) => (
            <AccountModsRow
              key={a.id}
              account={a}
              result={mods.accounts?.find((r) => r.accountId === a.id)}
              onChanged={() => setChanged(true)}
            />
          ))
        )}

        {claudeAccounts.length ? (
          <>
            <h2 className="sgrp">Browse</h2>
            <BrowseRow accounts={claudeAccounts} onChanged={() => setChanged(true)} />
          </>
        ) : null}

        <h2 className="sgrp">In development</h2>
        <ModFoldersRow onChanged={() => setChanged(true)} />

        <h2 className="sgrp">In the panes</h2>
        <DisplayRows />
      </div>
    </div>
  )
}
