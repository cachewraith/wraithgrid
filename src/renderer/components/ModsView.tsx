// Mods are claude plugins that change claude's own screen (panes, a band above the prompt,
// status lines, toasts). This view shows the mods the claude accounts have, as one list
// (a mod is installed and switched for every account at once), the local mod folders every
// claude pane loads, and what a pane needs to draw them well.
import { useEffect, useState } from 'react'
import type {
  AccountMods,
  CatalogMod,
  MarketplacesResult,
  ModCatalogResult,
  ModInstallResult
} from '@shared/ipc-contract'
import { downloadedModName, marketplaceOf, modNameOf } from '@shared/mods'
import { contractHome } from '@shared/paths'
import { MOD_DIRS_MAX, MOD_PANE_MIN_COLS, type Account } from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { formatInstalls, mergeMods, searchMods, type MergedMod } from '../lib/mod-catalog'
import { IconClose, IconFolder, IconRestart } from './icons'

/** A mod's name, opening its repository when the mod has one. */
function ModName({ name, url }: { name: string; url: string | null }) {
  const { api } = useServices()
  if (!url) return <>{name}</>
  return (
    <button
      className="mod-link name"
      title={url}
      aria-label={`Open the repository of ${name}`}
      onClick={() => void api.shell.openExternal(url)}
    >
      {name}
    </button>
  )
}

/** What an install for every account came to, as one line; null when all took it. */
function installError(res: ModInstallResult): string | null {
  if (!res.ok) return res.error
  const first = res.failed[0]
  if (!first) return null
  const more = res.failed.length - 1
  return `${first.account}: ${first.error}${more ? ` (and ${more} more)` : ''}`
}

function ModRow({
  row,
  accounts,
  onChanged
}: {
  row: MergedMod
  accounts: Account[]
  onChanged: () => void
}) {
  const { api } = useServices()
  const actions = useActions()
  const home = useApp((s) => s.info.homeDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mod } = row
  const name = modNameOf(mod.id)
  const nameOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? id
  // Only a mod installed for the whole account can be handed to the other accounts.
  const spread = mod.scope === 'user' && row.missing.length > 0

  // One switch for every account that has the mod; an account's refusal is shown by name.
  const toggle = async (): Promise<void> => {
    const enabled = !mod.enabled
    setBusy(true)
    let failed: string | null = null
    for (const id of row.accounts) {
      if (row.on.includes(id) === enabled) continue
      const err = await actions.setModEnabled(id, mod, enabled)
      if (err) failed ??= accounts.length > 1 ? `${nameOf(id)}: ${err}` : err
      else onChanged()
    }
    setBusy(false)
    setError(failed)
  }

  const addToAll = async (): Promise<void> => {
    setBusy(true)
    const res = await api.mods.install(mod.id)
    await actions.loadMods()
    setBusy(false)
    setError(installError(res))
    if (res.ok) onChanged()
  }

  // Uninstall asks twice: it removes the mod from every account that has it.
  const [confirmRemove, setConfirmRemove] = useState(false)
  const change = async (what: 'update' | 'uninstall'): Promise<void> => {
    setBusy(true)
    setConfirmRemove(false)
    const res = await api.mods.change(mod.id, what)
    await actions.loadMods()
    setBusy(false)
    setError(installError(res))
    if (res.ok) onChanged()
  }

  const where =
    accounts.length < 2
      ? null
      : row.missing.length === 0
        ? `all ${row.accounts.length} accounts`
        : `only ${row.accounts.map(nameOf).join(', ')}`
  const partlyOn = row.on.length > 0 && row.on.length < row.accounts.length

  return (
    <div className="mod-row">
      <div className="mod-tx">
        <span className="mod-nm">
          <ModName name={name} url={mod.url} />
          <span className="cli-tag">{mod.version}</span>
        </span>
        <span className="hint">
          {[
            marketplaceOf(mod.id),
            mod.scope,
            mod.projectPath ? contractHome(mod.projectPath, home) : null,
            where,
            partlyOn ? `on for ${row.on.map(nameOf).join(', ')}` : null
          ]
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
      {spread ? (
        <button
          className="btn"
          disabled={busy}
          aria-label={`Add ${name} to all accounts`}
          onClick={() => void addToAll()}
        >
          {busy ? 'Adding…' : 'Add to all accounts'}
        </button>
      ) : null}
      <button
        className="btn gh sm"
        disabled={busy}
        aria-label={`Update ${name}`}
        title="Update to the newest version"
        onClick={() => void change('update')}
      >
        Update
      </button>
      <button
        className={`btn sm${confirmRemove ? ' dng' : ' gh'}`}
        disabled={busy}
        aria-label={confirmRemove ? `Confirm uninstall ${name}` : `Uninstall ${name}`}
        onClick={() => (confirmRemove ? void change('uninstall') : setConfirmRemove(true))}
        onBlur={() => setConfirmRemove(false)}
      >
        {confirmRemove
          ? row.accounts.length > 1
            ? `Remove from ${row.accounts.length} accounts`
            : 'Click to remove'
          : 'Uninstall'}
      </button>
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

/** Every claude account's mods as one list: a mod is installed and switched for all of them. */
function InstalledRow({
  accounts,
  results,
  onChanged
}: {
  accounts: Account[]
  results: AccountMods[] | null
  onChanged: () => void
}) {
  const rows = results ? mergeMods(results) : []
  const failed = (results ?? []).flatMap((r) => {
    const account = accounts.find((a) => a.id === r.accountId)
    return !r.ok && account ? [{ account, error: r.error }] : []
  })
  return (
    <div className="srow">
      <div>
        <h3>
          {accounts.length > 1 ? `All ${accounts.length} claude accounts` : accounts[0]!.name}
        </h3>
        <p className="ex">
          {accounts.length > 1
            ? 'One list for every account: a switch turns a mod on or off in each account that has it.'
            : 'The mods this account has, as its own claude lists them.'}
        </p>
      </div>
      <div className="ctl">
        {failed.map((f) => (
          <span className="hint err" key={f.account.id}>
            {f.account.name}: {f.error}
          </span>
        ))}
        {!results ? (
          <span className="hint">Asking claude…</span>
        ) : rows.length === 0 ? (
          failed.length < results.length || results.length === 0 ? (
            <span className="hint">No mods installed. Find one under Browse below.</span>
          ) : null
        ) : (
          <div className="mod-list">
            {rows.map((row) => (
              <ModRow
                key={`${row.mod.id}|${row.mod.scope}|${row.mod.projectPath ?? ''}`}
                row={row}
                accounts={accounts}
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

type ModSource = 'marketplaces' | 'claudemod'
const MOD_SOURCES: { id: ModSource; label: string }[] = [
  { id: 'marketplaces', label: 'Marketplaces' },
  { id: 'claudemod', label: 'claudemod.com' }
]

function CatalogRow({
  mod,
  state,
  onInstall
}: {
  mod: CatalogMod
  /** Whether every account has it, some do, or none. */
  state: 'all' | 'some' | 'none'
  onInstall: () => Promise<string | null>
}) {
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
          <ModName name={mod.name} url={mod.url} />
          {mod.version ? <span className="cli-tag">{mod.version}</span> : null}
        </span>
        {mod.description ? <span className="mod-desc">{mod.description}</span> : null}
        <span className="hint">
          {[
            mod.marketplace,
            mod.installs !== null ? `${formatInstalls(mod.installs)} installs` : null,
            mod.stars !== null ? `${formatInstalls(mod.stars)} stars` : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {error ? <span className="hint err">{error}</span> : null}
      </div>
      {state === 'all' ? (
        <span className="badge">{mod.clone ? 'In mod folders' : 'Installed'}</span>
      ) : (
        <button
          className="btn"
          disabled={busy}
          aria-label={`Install ${mod.name}`}
          onClick={() => void install()}
        >
          {mod.clone
            ? busy
              ? 'Downloading…'
              : 'Download'
            : busy
              ? 'Installing…'
              : state === 'some'
                ? 'Add to all accounts'
                : 'Install'}
        </button>
      )}
    </div>
  )
}

/** The marketplace catalog: search it and install for every account without leaving the app. */
function BrowseRow({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const { api } = useServices()
  const actions = useActions()
  const listed = useApp((s) => s.mods.accounts)
  const [source, setSource] = useState<ModSource>('marketplaces')
  const [market, setMarket] = useState<ModCatalogResult | null>(null)
  const [community, setCommunity] = useState<ModCatalogResult | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(CATALOG_PAGE)

  useEffect(() => {
    let stale = false
    void api.mods.catalog().then((r) => {
      if (!stale) setMarket(r)
    })
    return () => {
      stale = true
    }
  }, [api])

  // The community list is another site: it is contacted only once it is asked for.
  const wantCommunity = source === 'claudemod'
  useEffect(() => {
    if (!wantCommunity) return
    let stale = false
    void api.mods.community().then((r) => {
      if (!stale) setCommunity(r)
    })
    return () => {
      stale = true
    }
  }, [api, wantCommunity])

  const res = wantCommunity ? community : market
  const catalog = res?.ok ? res.mods : null
  const error = res && !res.ok ? res.error : null
  const answered = (listed ?? []).flatMap((r) => (r.ok ? [r] : []))
  const modDirs = useApp((s) => s.config.settings.modDirs)
  const cloneDir = (m: CatalogMod): string => `~/.wraithgrid/mods/${m.name}`
  const stateOf = (m: CatalogMod): 'all' | 'some' | 'none' => {
    if (m.clone) return modDirs.includes(cloneDir(m)) ? 'all' : 'none'
    const id = m.id
    const have = answered.filter((r) => r.mods.some((m) => m.id === id)).length
    return have === 0 ? 'none' : have === answered.length ? 'all' : 'some'
  }
  const found = catalog ? searchMods(catalog, query) : []

  const install = async (mod: CatalogMod): Promise<string | null> => {
    // A bare plugin is downloaded and loaded as a mod folder, in every claude pane.
    if (mod.clone) {
      const got = await api.mods.clone(mod.id)
      if (!got.ok) return got.error
      if (!modDirs.includes(got.dir)) actions.updateSettings({ modDirs: [...modDirs, got.dir] })
      onChanged()
      return null
    }
    const done = await api.mods.install(mod.id)
    await actions.loadMods()
    if (done.ok) onChanged()
    return installError(done)
  }

  return (
    <div className="srow">
      <div>
        <h3 id="browse-h">Find a mod</h3>
        <p className="ex">
          Everything the marketplaces offer, or the mods listed on claudemod.com.{' '}
          {accounts.length > 1 ? `Install puts a mod in all ${accounts.length} accounts. ` : null}A
          mod runs as you, with your files and logins: install the ones you trust.
        </p>
      </div>
      <div className="ctl">
        <div className="recent" role="radiogroup" aria-label="Where to look for mods">
          {MOD_SOURCES.map((s) => (
            <button
              key={s.id}
              className={`rchip${s.id === source ? ' on' : ''}`}
              role="radio"
              aria-checked={s.id === source}
              onClick={() => {
                setSource(s.id)
                setLimit(CATALOG_PAGE)
              }}
              style={{ fontFamily: 'inherit', fontSize: 12.5, height: 30 }}
            >
              {s.label}
            </button>
          ))}
        </div>
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
          <span className="hint">
            {wantCommunity ? 'Asking claudemod.com…' : 'Asking claude for the catalog…'}
          </span>
        ) : found.length === 0 ? (
          <span className="hint">
            {query.trim() ? `No mod matches “${query.trim()}”.` : 'No mod to install here.'}
          </span>
        ) : (
          <>
            <span className="hint" role="status">
              {query.trim()
                ? `${found.length} ${found.length === 1 ? 'mod' : 'mods'} found`
                : wantCommunity
                  ? `${found.length} mods from claudemod.com, a community list: their marketplace is added on install`
                  : `${found.length} mods, most installed first`}
            </span>
            <div className="mod-list">
              {found.slice(0, limit).map((m) => (
                <CatalogRow key={m.id} mod={m} state={stateOf(m)} onInstall={() => install(m)} />
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

/** The marketplaces the accounts get mods from: add one to all, or remove one from all. */
function MarketplacesRow({ onChanged }: { onChanged: () => void }) {
  const { api } = useServices()
  const [res, setRes] = useState<MarketplacesResult | null>(null)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // Read again whenever the mod list is: an install may have added a marketplace.
  const listed = useApp((s) => s.mods.accounts)

  useEffect(() => {
    let stale = false
    void api.mods.marketplaces().then((r) => {
      if (!stale) setRes(r)
    })
    return () => {
      stale = true
    }
  }, [api, nonce, listed])

  const run = async (job: Promise<ModInstallResult>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const r = await job
    setBusy(false)
    setError(installError(r))
    setNonce((n) => n + 1)
    if (r.ok) onChanged()
    return r.ok
  }
  const add = async (): Promise<void> => {
    if (await run(api.mods.addMarketplace(source.trim()))) setSource('')
  }

  return (
    <div className="srow">
      <div>
        <h3 id="markets-h">Marketplaces</h3>
        <p className="ex">
          Where Browse finds mods. Adding or removing one does it for every claude account.
        </p>
      </div>
      <div className="ctl">
        {!res ? (
          <span className="hint">Asking claude…</span>
        ) : !res.ok ? (
          <span className="hint err">{res.error}</span>
        ) : res.marketplaces.length === 0 ? (
          <span className="hint">No marketplace yet.</span>
        ) : (
          <div className="mod-list" role="list" aria-labelledby="markets-h">
            {res.marketplaces.map((m) => (
              <div className="mod-row" role="listitem" key={m.name}>
                <div className="mod-tx">
                  <span className="mod-nm">
                    <ModName name={m.name} url={m.url} />
                  </span>
                  {res.total > 1 ? (
                    <span className="hint">
                      {m.accounts === res.total
                        ? `all ${res.total} accounts`
                        : `${m.accounts} of ${res.total} accounts`}
                    </span>
                  ) : null}
                </div>
                <button
                  className={`btn sm${confirm === m.name ? ' dng' : ' gh'}`}
                  disabled={busy}
                  aria-label={
                    confirm === m.name ? `Confirm remove ${m.name}` : `Remove marketplace ${m.name}`
                  }
                  onBlur={() => setConfirm(null)}
                  onClick={() => {
                    if (confirm !== m.name) return setConfirm(m.name)
                    setConfirm(null)
                    void run(api.mods.removeMarketplace(m.name))
                  }}
                >
                  {confirm === m.name ? 'Click to remove' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          className="inrow"
          onSubmit={(e) => {
            e.preventDefault()
            if (source.trim()) void add()
          }}
        >
          <input
            className="inpt"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="owner/repo or https://…"
            aria-label="Marketplace to add"
            spellCheck={false}
            disabled={busy}
          />
          <button className="btn" type="submit" disabled={busy || !source.trim()}>
            {busy ? 'Working…' : 'Add marketplace'}
          </button>
        </form>
        {error ? <span className="hint err">{error}</span> : null}
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
  // Per downloaded mod: null while its update runs, else what the last one said.
  const [pulled, setPulled] = useState<Record<string, string | null>>({})

  const pull = async (name: string): Promise<void> => {
    setPulled((p) => ({ ...p, [name]: null }))
    const r = await api.mods.pull(name)
    const said = r.ok ? (r.changed ? 'Updated' : 'Up to date') : r.error
    setPulled((p) => ({ ...p, [name]: said }))
    if (r.ok && r.changed) onChanged()
  }
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
            {dirs.map((d) => {
              const name = downloadedModName(d)
              const said = name ? pulled[name] : undefined
              return (
                <div className="mod-row" role="listitem" key={d}>
                  <span className="mod-dir" title={d}>
                    {d}
                  </span>
                  {said ? (
                    <span className="hint" role="status">
                      {said}
                    </span>
                  ) : null}
                  {name ? (
                    <button
                      className="btn"
                      aria-label={`Update ${name}`}
                      title="Get the newest version from its repository"
                      disabled={said === null}
                      onClick={() => void pull(name)}
                    >
                      {said === null ? 'Updating…' : 'Update'}
                    </button>
                  ) : null}
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${d}`}
                    title="Remove"
                    onClick={() => save(dirs.filter((x) => x !== d))}
                  >
                    <IconClose />
                  </button>
                </div>
              )
            })}
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
              toasts, commands. Install one once and every claude account has it.
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
          <InstalledRow
            accounts={claudeAccounts}
            results={mods.accounts}
            onChanged={() => setChanged(true)}
          />
        )}

        {claudeAccounts.length ? (
          <>
            <h2 className="sgrp">Browse</h2>
            <BrowseRow accounts={claudeAccounts} onChanged={() => setChanged(true)} />
            <MarketplacesRow onChanged={() => setChanged(true)} />
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
