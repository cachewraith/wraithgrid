// The community theme gallery (#24): themes others published as GitHub repositories, listed
// in cachewraith/wraithgrid-themes. Main fetches and checks everything; this shows the list,
// installs, updates and removes, and installs a repository given by its address.
import { useEffect, useMemo, useState } from 'react'
import type { CommunityTheme } from '@shared/ipc-contract'
import { useActions, useServices } from '../app/services'

type Sort = 'name' | 'author'
type ModeFilter = 'all' | 'dark' | 'light'

function Shot({ repo }: { repo: string }) {
  const { api } = useServices()
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void api.themes.communityShot(repo).then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [api, repo])
  if (src === undefined) return <div className="ctg-shot skel" aria-hidden="true" />
  if (src === null) return <div className="ctg-shot none">No screenshot</div>
  return <img className="ctg-shot" src={src} alt="" />
}

export function CommunityThemes({ onClose }: { onClose: () => void }) {
  const { api } = useServices()
  const actions = useActions()
  const [list, setList] = useState<CommunityTheme[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [mode, setMode] = useState<ModeFilter>('all')
  const [url, setUrl] = useState('')

  const reload = async (): Promise<void> => {
    const r = await api.themes.community()
    if (r.ok) setList(r.themes)
    else {
      setList([])
      setError(r.error)
    }
  }
  useEffect(() => {
    let live = true
    void api.themes.community().then((r) => {
      if (!live) return
      if (r.ok) setList(r.themes)
      else {
        setList([])
        setError(r.error)
      }
    })
    return () => {
      live = false
    }
  }, [api])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (list ?? [])
      .filter((t) => mode === 'all' || t.modes.includes(mode))
      .filter(
        (t) =>
          !needle ||
          `${t.name} ${t.author} ${t.description} ${t.repo}`.toLowerCase().includes(needle)
      )
      .sort((a, b) => a[sort].localeCompare(b[sort]))
  }, [list, q, sort, mode])

  const install = async (repo: string): Promise<void> => {
    setBusy(repo)
    setError(null)
    const r = await api.themes.communityInstall(repo)
    setBusy(null)
    if (!r.ok) return setError(r.error)
    await actions.loadThemes()
    actions.chooseTheme(r.id)
    await reload()
  }
  const remove = async (id: string): Promise<void> => {
    const r = await api.themes.communityRemove(id)
    if (!r.ok) return setError(r.error)
    await actions.loadThemes()
    await reload()
  }

  return (
    <section className="ctg" aria-label="Community themes">
      <div className="ctg-tools">
        <input
          className="inpt"
          placeholder="Search themes and authors…"
          aria-label="Search community themes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="inpt"
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="name">Name</option>
          <option value="author">Author</option>
        </select>
        <div className="ted-seg" role="radiogroup" aria-label="Show">
          {(['all', 'dark', 'light'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              {m === 'all' ? 'All' : m === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
        <button className="btn gh" onClick={onClose}>
          Close
        </button>
      </div>

      {error ? (
        <div className="ctg-err" role="alert">
          {error}
        </div>
      ) : null}

      {list === null ? (
        <p className="hint">Loading the community list…</p>
      ) : shown.length === 0 && !error ? (
        <p className="hint">{list.length ? 'No theme matches.' : 'No community themes yet.'}</p>
      ) : (
        <div className="ctg-grid">
          {shown.map((t) => (
            <article key={t.repo} className="ctg-card" aria-label={t.name}>
              <Shot repo={t.repo} />
              <div className="ctg-body">
                <div className="ctg-t">
                  {t.name}
                  {t.update ? (
                    <span className="ctg-badge up">Update {t.version}</span>
                  ) : t.installedId ? (
                    <span className="ctg-badge">Installed</span>
                  ) : null}
                </div>
                <div className="ctg-by">by {t.author}</div>
                {t.description ? <div className="ctg-ds">{t.description}</div> : null}
                <div className="ctg-tags">
                  {t.modes.map((m) => (
                    <span key={m} className="ctg-tag">
                      {m}
                    </span>
                  ))}
                  <span className="ctg-ver">v{t.installedVersion ?? t.version}</span>
                </div>
              </div>
              <div className="ctg-ft">
                <button
                  className="btn sm gh"
                  onClick={() => void api.shell.openExternal(`https://github.com/${t.repo}`)}
                >
                  Repository
                </button>
                {t.installedId ? (
                  <button className="btn sm gh" onClick={() => void remove(t.installedId!)}>
                    Remove
                  </button>
                ) : null}
                {t.tooNew ? (
                  <span className="hint">Needs Wraithgrid {t.minAppVersion}</span>
                ) : t.update ? (
                  <button
                    className="btn sm pri"
                    disabled={busy === t.repo}
                    onClick={() => void install(t.repo)}
                  >
                    Update
                  </button>
                ) : t.installedId ? (
                  <button className="btn sm" onClick={() => actions.chooseTheme(t.installedId!)}>
                    Use
                  </button>
                ) : (
                  <button
                    className="btn sm"
                    disabled={busy === t.repo}
                    onClick={() => void install(t.repo)}
                  >
                    {busy === t.repo ? 'Installing…' : 'Install'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <form
        className="ctg-url"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) void install(url.trim()).then(() => setUrl(''))
        }}
      >
        <input
          className="inpt"
          placeholder="https://github.com/owner/theme-repo"
          aria-label="Theme repository address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!url.trim() || !!busy}>
          Install from GitHub
        </button>
      </form>
      <p className="hint">
        Themes are data only — colors, fonts and shapes — checked before they install. Make your own
        from the{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            void api.shell.openExternal('https://github.com/cachewraith/wraithgrid-theme-template')
          }}
        >
          theme template
        </a>
        .
      </p>
    </section>
  )
}
