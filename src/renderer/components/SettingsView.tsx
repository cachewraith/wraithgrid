import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { formatArgs, parseArgs } from '@shared/args'
import type { ShellOption } from '@shared/ipc-contract'
import { AGENT_CLIS, AGENT_CLI_LABEL, AGENT_CLI_SPECS, type AgentCli } from '@shared/agent-clis'
import { contractHome } from '@shared/paths'
import {
  IS_MAC,
  SHORTCUT_LABEL,
  bindingFromEvent,
  bindingKeys,
  bindingProblem,
  chord,
  currentBinding,
  defaultBinding,
  formatBinding,
  setRecordingShortcut
} from '../app/shortcuts'
import {
  ACCENTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SHORTCUT_IDS,
  TERMINAL_FONTS,
  TERMINAL_PALETTES,
  UI_ZOOM_STEPS,
  stepZoom,
  type AccentName,
  type CloseMode,
  type PaneView,
  type SharedMode,
  type ShortcutId
} from '@shared/types'
import {
  CHAT_EFFORTS,
  CHAT_MODE_HINT,
  CHAT_MODE_LABEL,
  EFFORT_LABEL,
  type ChatModel
} from '@shared/chat'
import { Initial } from './AccountIcon'
import { useActions, useApp, useServices } from '../app/services'
import { currentTheme, drawnTheme } from '../app/store'
import { pickTheme, themeVars, type AppTheme, type ThemeFile } from '@shared/themes'
import { releasePageUrl, type ReleaseNote } from '@shared/whats-new'
import { Markdown } from './chat/Markdown'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { PALETTE_LABEL, terminalFontStack, terminalTheme } from '../lib/term-theme'
import {
  IconCheck,
  IconExport,
  IconFolder,
  IconImport,
  IconMore,
  IconRestart,
  IconTrash,
  IconWarn
} from './icons'

/** Swatch color per accent, the same value as --acc in tokens.css. */
const ACCENT_SWATCH: Record<AccentName, string> = {
  violet: '#7c5cff',
  blue: '#3b82f6',
  teal: '#14b8a6',
  amber: '#f59e0b',
  rose: '#f43f5e'
}

/** A small window drawn in a theme's own colors: sidebar, a chat bubble, the accent. */
function ThemePreview({ t }: { t: AppTheme }) {
  return (
    <span className="thm-prev" style={themeVars(t) as CSSProperties} aria-hidden="true">
      <span className="thm-side">
        <span className="thm-ln on" />
        <span className="thm-ln" />
        <span className="thm-ln short" />
      </span>
      <span className="thm-main">
        <span className="thm-bub" />
        <span className="thm-ln" />
        <span className="thm-ln short" />
        <span className="thm-btn" />
      </span>
    </span>
  )
}

function ThemeRow() {
  const actions = useActions()
  const { api } = useServices()
  const themes = useApp((s) => s.themes)
  const problems = useApp((s) => s.themeProblems)
  const pref = useApp((s) => s.config.settings.theme)
  const themeDark = useApp((s) => s.config.settings.themeDark)
  const themeLight = useApp((s) => s.config.settings.themeLight)
  const mode = useApp(currentTheme)
  const drawn = useApp(drawnTheme)
  const systemTheme = useApp((s) => s.systemTheme)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [cardMenu, setCardMenu] = useState<{ at: MenuPoint; t: AppTheme } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const follow = pref === 'system'
  const darkId = pickTheme(themes, themeDark, 'dark').id
  const lightId = pickTheme(themes, themeLight, 'light').id
  const drawnId = mode === 'dark' ? darkId : lightId

  const run = async (p: Promise<string | null>): Promise<void> => setError(await p)
  const exportTheme = async (t: ThemeFile): Promise<void> => {
    const { name, mode, author, colors, terminal } = t
    const r = await api.themes.export({ name, mode, author, colors, terminal })
    setError(r && !r.ok ? r.error : null)
  }

  return (
    <div className="srow thm-row">
      <div className="thm-hd">
        <div>
          <h3 id="theme-h">Theme</h3>
          <p className="ex">
            Five built in, or your own: a theme is a small JSON file of colors you can import and
            share.
          </p>
        </div>
        <div className="thm-acts">
          <button className="btn" onClick={() => void run(actions.importTheme())}>
            <IconImport small />
            Import theme…
          </button>
          <button
            className="icon-btn"
            aria-label="More theme actions"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right - 240, y: r.bottom + 6 })
            }}
          >
            <IconMore />
          </button>
        </div>
      </div>
      <div className="thm-grid" role="radiogroup" aria-labelledby="theme-h">
        {themes.map((t) => {
          const on = t.id === drawnId
          const slot = follow && !on && (t.id === darkId || t.id === lightId)
          return (
            <button
              key={t.id}
              className={`thm${on ? ' on' : ''}`}
              role="radio"
              aria-checked={on}
              aria-label={t.name}
              title={t.author ? `${t.name} by ${t.author}` : t.name}
              onClick={() => actions.chooseTheme(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setConfirmDelete(false)
                setCardMenu({ at: menuPoint(e), t })
              }}
            >
              <ThemePreview t={t} />
              <span className="thm-nm">
                {t.name}
                {on ? <IconCheck small /> : null}
              </span>
              <span className="thm-sub">
                {t.mode === 'dark' ? 'Dark' : 'Light'}
                {t.builtIn ? '' : ' · yours'}
                {slot ? ' · when the OS is ' + t.mode : ''}
              </span>
            </button>
          )
        })}
      </div>
      <div className="swrow">
        <button
          className={`sw${follow ? ' on' : ''}`}
          role="switch"
          aria-checked={follow}
          aria-labelledby="thm-follow"
          onClick={() => actions.updateSettings({ theme: follow ? mode : 'system' })}
        />
        <span id="thm-follow">Follow the OS light or dark setting</span>
      </div>
      <span className="theme-note">
        {follow
          ? `Your desktop is ${systemTheme} now. Dark uses ${pickTheme(themes, themeDark, 'dark').name}, light uses ${pickTheme(themes, themeLight, 'light').name}: pick a card of each kind to change them.`
          : `${drawn.name} is on for the whole app.`}
      </span>
      {error ? (
        <span className="hint warn" role="alert">
          {error}
        </span>
      ) : null}
      {problems.length ? (
        <div className="thm-probs" role="status">
          {problems.length === 1 ? 'A theme file' : `${problems.length} theme files`} could not be
          loaded:
          {problems.map((p) => (
            <span key={p.file}>
              <span className="mono">{p.file}</span> — {p.error}
            </span>
          ))}
        </div>
      ) : null}
      {menu ? (
        <ContextMenu
          at={menu}
          width={240}
          label="Theme actions"
          onClose={() => setMenu(null)}
          items={[
            {
              label: `Export ${drawn.name}…`,
              icon: <IconExport small />,
              onSelect: () => void exportTheme(drawn)
            },
            {
              label: 'Open themes folder',
              icon: <IconFolder small />,
              onSelect: () =>
                void api.themes.openFolder().then((r) => setError(r.ok ? null : r.error))
            },
            {
              label: 'Reload themes',
              icon: <IconRestart small />,
              onSelect: () => void actions.loadThemes()
            }
          ]}
        />
      ) : null}
      {cardMenu ? (
        <ContextMenu
          at={cardMenu.at}
          label={`Theme ${cardMenu.t.name}`}
          onClose={() => setCardMenu(null)}
          items={[
            {
              label: 'Use this theme',
              icon: <IconCheck small />,
              onSelect: () => actions.chooseTheme(cardMenu.t.id)
            },
            {
              label: cardMenu.t.builtIn ? 'Export as a starting point…' : 'Export…',
              icon: <IconExport small />,
              onSelect: () => void exportTheme(cardMenu.t)
            },
            ...(cardMenu.t.builtIn
              ? []
              : [
                  {
                    label: confirmDelete ? 'Click again to delete' : 'Delete theme',
                    icon: <IconTrash small />,
                    danger: true,
                    divider: true,
                    onSelect: () => {
                      if (!confirmDelete) {
                        setConfirmDelete(true)
                        return false as const
                      }
                      void run(actions.deleteTheme(cardMenu.t.id))
                    }
                  }
                ])
          ]}
        />
      ) : null}
    </div>
  )
}

function ZoomRow() {
  const actions = useActions()
  const zoom = useApp((s) => s.config.settings.uiZoom)
  const set = (delta: -1 | 0 | 1): void => actions.updateSettings({ uiZoom: stepZoom(zoom, delta) })
  return (
    <div className="srow">
      <div>
        <h3 id="zoom-h">Interface size</h3>
        <p className="ex">
          Everything at once: sidebar, chats and terminals. Also {chord(['mod', '+'])} /{' '}
          {chord(['mod', '-'])}, and {chord(['mod', '0'])} to reset.
        </p>
      </div>
      <div className="ctl">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="step" role="group" aria-labelledby="zoom-h">
            <button
              aria-label="Smaller"
              disabled={zoom <= UI_ZOOM_STEPS[0]}
              onClick={() => set(-1)}
            >
              −
            </button>
            <span aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button
              aria-label="Bigger"
              disabled={zoom >= UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1]!}
              onClick={() => set(1)}
            >
              +
            </button>
          </div>
          {zoom !== 1 ? (
            <button className="btn gh" onClick={() => set(0)}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AccentRow() {
  const actions = useActions()
  const accent = useApp((s) => s.config.settings.accent)
  const themeAccent = useApp(
    (s) =>
      pickTheme(
        s.themes,
        currentTheme(s) === 'dark' ? s.config.settings.themeDark : s.config.settings.themeLight,
        currentTheme(s)
      ).colors.accent
  )
  return (
    <div className="srow">
      <div>
        <h3 id="accent-h">Accent color</h3>
        <p className="ex">
          Buttons, selection, focus rings and the terminal cursor. Theme keeps the theme's own.
        </p>
      </div>
      <div className="ctl">
        <div className="accents" role="radiogroup" aria-labelledby="accent-h">
          <button
            className={`accent auto${accent === 'theme' ? ' on' : ''}`}
            role="radio"
            aria-checked={accent === 'theme'}
            aria-label="Theme accent"
            title="The theme's own accent"
            style={{ '--sw': themeAccent } as CSSProperties}
            onClick={() => actions.updateSettings({ accent: 'theme' })}
          >
            {accent === 'theme' ? <IconCheck small /> : null}
          </button>
          <span className="accents-sep" aria-hidden="true" />
          {ACCENTS.map((a) => (
            <button
              key={a}
              className={`accent${accent === a ? ' on' : ''}`}
              role="radio"
              aria-checked={accent === a}
              aria-label={a}
              title={a[0]!.toUpperCase() + a.slice(1)}
              style={{ '--sw': ACCENT_SWATCH[a] } as CSSProperties}
              onClick={() => actions.updateSettings({ accent: a })}
            >
              {accent === a ? <IconCheck small /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PaletteRow() {
  const actions = useActions()
  const palette = useApp((s) => s.config.settings.terminalPalette)
  const drawn = useApp(drawnTheme)
  return (
    <div className="srow">
      <div>
        <h3 id="palette-h">Terminal colors</h3>
        <p className="ex">
          Match app uses the theme's own terminal colors. The others keep theirs in every theme.
        </p>
      </div>
      <div className="ctl">
        <div className="palettes" role="radiogroup" aria-labelledby="palette-h">
          {TERMINAL_PALETTES.map((p) => {
            const t = terminalTheme(p, drawn)
            return (
              <button
                key={p}
                className={`palette${palette === p ? ' on' : ''}`}
                role="radio"
                aria-checked={palette === p}
                onClick={() => actions.updateSettings({ terminalPalette: p })}
              >
                <span
                  className="pal-prev"
                  style={{ background: t.background, color: t.foreground }}
                >
                  <span style={{ color: t.cursor }}>&gt;</span> claude
                  <span className="pal-dots">
                    {[t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan].map((c, i) => (
                      <span key={i} style={{ background: c }} />
                    ))}
                  </span>
                </span>
                <span className="pal-name">{PALETTE_LABEL[p]}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** "41.9 MB"; null when the size is not known yet. */
function fmtMB(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
}

/** Release notes as markdown → React elements (never HTML); links open in the browser. */
function ReleaseNotes({ notes, label = 'Release notes' }: { notes: string; label?: string }) {
  return (
    <div className="relnotes" aria-label={label}>
      <Markdown text={notes} />
    </div>
  )
}

const Warn = () => (
  <span style={{ color: 'var(--warn)', display: 'flex' }}>
    <IconWarn small />
  </span>
)

/**
 * One clear state at a time: up to date · available (with notes) · downloading (bar, %,
 * size, Cancel) · ready to restart (Restart now / Later) · failed (reason, Retry, the page).
 */
function UpdatesRow() {
  const { api } = useServices()
  const actions = useActions()
  const version = useApp((s) => s.info.version)
  const onLaunch = useApp((s) => s.config.settings.checkUpdatesOnLaunch)
  // macOS builds can't replace themselves (not Developer ID signed): straight to the page.
  const manualOnly = useApp((s) => s.info.platform === 'darwin')
  const { checking, result, install, installError } = useApp((s) => s.update)
  const anchor = useApp((s) => s.settingsAnchor)
  const ref = useRef<HTMLDivElement>(null)
  const [later, setLater] = useState(false)

  useEffect(() => {
    if (anchor !== 'updates') return
    ref.current?.scrollIntoView({ block: 'center' })
    actions.clearSettingsAnchor()
  }, [anchor, actions])

  const latest = result?.status === 'available' ? result.latest : null
  const target =
    install.phase === 'downloading' || install.phase === 'ready' || install.phase === 'installing'
      ? install.version
      : (latest?.version ?? null)
  const openPage = (): void =>
    void api.shell.openExternal(latest?.url ?? releasePageUrl(target ?? version))

  let state: string
  let status: ReactNode
  let buttons: ReactNode = null
  if (install.phase === 'checking') {
    state = 'preparing'
    status = <span>Preparing the update…</span>
  } else if (install.phase === 'downloading') {
    state = 'downloading'
    const size = fmtMB(install.total)
    const done = fmtMB(install.transferred)
    status = (
      <span className="upd-dl">
        <span>
          Downloading {install.version}… <b className="num">{install.percent}%</b>
          {size ? (
            <span className="num">
              {' '}
              · {done ?? '0 MB'} of {size}
            </span>
          ) : null}
        </span>
        <span
          className="upd-bar"
          role="progressbar"
          aria-label={`Downloading ${install.version}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={install.percent}
        >
          <span style={{ '--w': `${install.percent}%` } as CSSProperties} />
        </span>
      </span>
    )
    buttons = (
      <button className="btn" onClick={actions.cancelUpdate}>
        Cancel
      </button>
    )
  } else if (install.phase === 'ready') {
    state = 'ready'
    status = (
      <>
        <span style={{ color: 'var(--ok)', display: 'flex' }}>
          <IconCheck small />
        </span>
        <span>
          {later
            ? `${install.version} is downloaded. Restart when you are ready.`
            : `${install.version} is downloaded. Restart Wraithgrid to finish; running panes close.`}
        </span>
      </>
    )
    buttons = (
      <>
        <button className="btn pri" onClick={() => void actions.restartToUpdate()}>
          <IconRestart />
          Restart now
        </button>
        {later ? null : (
          <button className="btn" onClick={() => setLater(true)}>
            Later
          </button>
        )}
      </>
    )
  } else if (install.phase === 'installing') {
    state = 'installing'
    status = <span>Installing {install.version}. Wraithgrid restarts when it is done.</span>
  } else if (installError) {
    state = 'failed'
    status = (
      <>
        <Warn />
        <span>{installError.error}</span>
      </>
    )
    buttons = (
      <>
        {installError.manual ? null : (
          <button className="btn" onClick={() => void actions.installUpdate()}>
            <IconRestart />
            Retry
          </button>
        )}
        <button className="btn pri" onClick={openPage}>
          <IconImport />
          Open release page
        </button>
      </>
    )
  } else if (checking) {
    state = 'checking'
    status = <span>Checking GitHub for a newer release…</span>
  } else if (!result || result.status === 'skipped') {
    state = 'unchecked'
    status = <span>Not checked yet.</span>
  } else if (result.status === 'error') {
    state = 'check-failed'
    status = (
      <>
        <Warn />
        <span>{result.error}</span>
      </>
    )
  } else if (result.status === 'current') {
    state = 'current'
    status = (
      <>
        <span style={{ color: 'var(--ok)', display: 'flex' }}>
          <IconCheck small />
        </span>
        <span>Up to date.</span>
      </>
    )
  } else {
    state = 'available'
    const date = formatDate(result.latest.publishedAt)
    status = (
      <span>
        <b style={{ color: 'var(--tx)' }}>Wraithgrid {result.latest.version}</b> is available
        {date ? ` (released ${date})` : ''}.
      </span>
    )
    buttons = manualOnly ? (
      <button className="btn pri" onClick={openPage}>
        <IconImport />
        Open release page
      </button>
    ) : (
      <button className="btn pri" onClick={() => void actions.installUpdate()}>
        <IconImport />
        Download {result.latest.version}
      </button>
    )
  }
  const busy = install.phase !== 'idle'

  return (
    <div className="srow" id="updates" ref={ref} data-state={state}>
      <div>
        <h3>Updates</h3>
        <p className="ex">
          Checks the releases on GitHub. Download fetches the new version and checks it; Restart now
          replaces this one and reopens Wraithgrid. On Linux your password is asked for.
        </p>
      </div>
      <div className="ctl">
        <div className="det">
          <span>
            Version{' '}
            <span className="mono" style={{ color: 'var(--tx)' }}>
              {version}
              {target && target !== version ? ` → ${target}` : ''}
            </span>
          </span>
        </div>
        <div className="det" role="status" aria-live="polite">
          {status}
        </div>
        <div className="inrow">
          {buttons}
          {busy || state === 'failed' ? null : (
            <button
              className="btn"
              disabled={checking}
              onClick={() => void actions.checkForUpdates('manual')}
            >
              <IconRestart />
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
        {latest?.notes && state === 'available' ? (
          <ReleaseNotes notes={latest.notes} label={`Release notes for ${latest.version}`} />
        ) : null}
        <div className="swrow">
          <button
            className={`sw${onLaunch ? ' on' : ''}`}
            role="switch"
            aria-checked={onLaunch}
            aria-labelledby="upd-launch"
            onClick={() => actions.updateSettings({ checkUpdatesOnLaunch: !onLaunch })}
          />
          <span id="upd-launch">Check when Wraithgrid starts</span>
        </div>
      </div>
    </div>
  )
}

/** What's new in the installed version (bundled, so offline too), then earlier versions. */
function WhatsNewRow() {
  const { api } = useServices()
  const notes = useApp((s) => s.update.notes)
  const version = useApp((s) => s.info.version)
  if (!notes) return null
  const head = (n: ReleaseNote): string =>
    [n.title, formatDate(n.date)].filter(Boolean).join(' · ') || 'Release notes'
  return (
    <div className="srow wn" id="whats-new">
      <div>
        <h3>What’s new in {version}</h3>
        <p className="ex">
          {notes.installed ? head(notes.installed) : 'No notes for this version.'}
        </p>
        <button
          className="btn wn-link"
          onClick={() => void api.shell.openExternal(releasePageUrl(version))}
        >
          Release notes on GitHub
        </button>
      </div>
      <div className="ctl">
        {notes.installed ? (
          <ReleaseNotes notes={notes.installed.notes} label={`What’s new in ${version}`} />
        ) : null}
        {notes.earlier.length ? (
          <div className="wn-earlier" aria-label="Earlier versions">
            {notes.earlier.map((n) => (
              <details key={n.version} className="wn-old">
                <summary>
                  <span className="mono">{n.version}</span>
                  <span>{head(n)}</span>
                </summary>
                <ReleaseNotes notes={n.notes} label={`Release notes for ${n.version}`} />
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Which shell plain shell panes run: automatic, one found on this machine, or a custom one. */
function ShellRow() {
  const { api } = useServices()
  const actions = useActions()
  const shellPath = useApp((s) => s.config.settings.shellPath)
  const shellArgs = useApp((s) => s.config.settings.shellArgs)
  const windows = useApp((s) => s.info.platform === 'win32')
  const home = useApp((s) => s.info.homeDir)
  const [found, setFound] = useState<ShellOption[] | null>(null)
  const [custom, setCustom] = useState(false)
  const [argsDraft, setArgsDraft] = useState(formatArgs(shellArgs))

  useEffect(() => {
    let live = true
    void api.shells.list().then((list) => live && setFound(list))
    return () => {
      live = false
    }
  }, [api])

  const known = found?.find((o) => o.path === shellPath)
  const mode = !shellPath && !custom ? 'auto' : known && !custom ? known.path : 'custom'
  const pick = (path: string, args: string[]): void => {
    setCustom(false)
    setArgsDraft(formatArgs(args))
    actions.updateSettings({ shellPath: path, shellArgs: args })
  }
  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFile(shellPath || '~')
    if (picked) actions.updateSettings({ shellPath: contractHome(picked, home) })
  }

  return (
    <div className="srow">
      <div>
        <h3 id="shell-h">Shell for plain panes</h3>
        <p className="ex">
          What <em>Open a plain shell</em> runs. claude panes don't use it: claude starts directly
          and gets a clean terminal environment whichever shell you use.
        </p>
      </div>
      <div className="ctl">
        <div className="apick shells" role="radiogroup" aria-labelledby="shell-h">
          <ShellOpt
            on={mode === 'auto'}
            name="Automatic"
            sub={
              windows ? 'PowerShell 7, Windows PowerShell, then cmd' : 'Your login shell ($SHELL)'
            }
            onPick={() => pick('', [])}
          />
          {(found ?? []).map((o) => (
            <ShellOpt
              key={o.path}
              on={mode === o.path}
              name={o.name}
              sub={[contractHome(o.path, home), formatArgs(o.args)].filter(Boolean).join(' ')}
              onPick={() => pick(o.path, o.args)}
            />
          ))}
          <ShellOpt
            on={mode === 'custom'}
            name="Custom…"
            sub="Any shell: a path or a name on PATH"
            onPick={() => setCustom(true)}
          />
        </div>
        {found === null ? <div className="det">Looking for installed shells…</div> : null}
        {mode === 'custom' ? (
          <>
            <div className="inrow">
              <input
                className="inpt"
                aria-label="Shell path"
                value={shellPath}
                placeholder={
                  windows ? 'C:\\msys64\\usr\\bin\\zsh.exe or nu' : '/usr/bin/nu or elvish'
                }
                onChange={(e) => actions.updateSettings({ shellPath: e.target.value })}
                spellCheck={false}
              />
              <button className="btn" onClick={() => void browse()}>
                <IconFolder />
                Browse…
              </button>
            </div>
            <input
              className="inpt"
              aria-label="Shell arguments"
              value={argsDraft}
              placeholder="Arguments (optional), e.g. --login -i"
              onChange={(e) => {
                setArgsDraft(e.target.value)
                actions.updateSettings({ shellArgs: parseArgs(e.target.value) })
              }}
              spellCheck={false}
            />
          </>
        ) : null}
        <p className="hint">Applies to shell panes started from now on.</p>
      </div>
    </div>
  )
}

function ShellOpt(p: { on: boolean; name: string; sub: string; onPick: () => void }) {
  return (
    <button
      type="button"
      className={`aopt${p.on ? ' on' : ''}`}
      role="radio"
      aria-checked={p.on}
      onClick={p.onPick}
    >
      <span className="tx">
        <span className="nm">{p.name}</span>
        <span className="sb mono" title={p.sub}>
          {p.sub}
        </span>
      </span>
      {p.on ? <IconCheck className="ck" /> : null}
    </button>
  )
}

const CLOSE_OPTIONS: { id: CloseMode; label: string }[] = [
  { id: 'ask', label: 'Ask each time' },
  { id: 'keep', label: 'Keep agents running' },
  { id: 'stop', label: 'Stop agents and quit' }
]

function CloseRow() {
  const actions = useActions()
  const mode = useApp((s) => s.config.settings.onWindowClose)
  return (
    <div className="srow">
      <div>
        <h3 id="close-h">When the window closes</h3>
        <p className="ex">
          Agents can keep running in the background after the window closes, or after Wraithgrid
          quits. The next launch shows them again, screen and all.
        </p>
      </div>
      <div className="ctl">
        <div className="recent" role="radiogroup" aria-labelledby="close-h">
          {CLOSE_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={`rchip${mode === o.id ? ' on' : ''}`}
              role="radio"
              aria-checked={mode === o.id}
              onClick={() => actions.updateSettings({ onWindowClose: o.id })}
              style={{ fontFamily: 'inherit', fontSize: 12.5, height: 30 }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="hint">
          Running agents keep using CPU, memory and API usage. With agents kept, the tray icon
          offers to open Wraithgrid or stop them all; no notifications arrive while the window is
          closed.
        </span>
      </div>
    </div>
  )
}

const VIEW_OPTIONS: { id: PaneView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'terminal', label: 'Terminal' }
]

function PaneViewRow() {
  const actions = useActions()
  const view = useApp((s) => s.config.settings.newPaneView)
  return (
    <div className="srow">
      <div>
        <h3 id="view-h">New panes open as</h3>
        <p className="ex">
          Chat runs the agent CLI in the background and shows its answers, tool calls and approvals
          as a conversation. Terminal shows the CLI's own screen. Each pane can switch from its
          header.
        </p>
      </div>
      <div className="ctl">
        <div className="recent" role="radiogroup" aria-labelledby="view-h">
          {VIEW_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={`rchip${view === o.id ? ' on' : ''}`}
              role="radio"
              aria-checked={view === o.id}
              onClick={() => actions.updateSettings({ newPaneView: o.id })}
              style={{ fontFamily: 'inherit', fontSize: 12.5, height: 30 }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="hint">
          Chat is for Claude Code for now; other CLIs open as terminals. A pane signs in from the
          terminal view. Chat agents stop when Wraithgrid quits and carry on the conversation at the
          next launch.
        </span>
      </div>
    </div>
  )
}

function CliRow() {
  const actions = useActions()
  const on = useApp((s) => s.config.settings.cliAccess)
  return (
    <div className="srow">
      <div>
        <h3>Command line</h3>
        <p className="ex">
          Lets the <span className="mono">wraithgrid</span> command, and agents in your panes, list
          panes, read their screens, type into them, wait for them and open new ones. Only your user
          can connect; nothing listens on the network.
        </p>
      </div>
      <div className="ctl">
        <div className="swrow">
          <button
            className={`sw${on ? ' on' : ''}`}
            role="switch"
            aria-checked={on}
            aria-labelledby="set-cli"
            onClick={() => actions.updateSettings({ cliAccess: !on })}
          />
          <span id="set-cli">Allow wraithgrid commands</span>
        </div>
        <span className="hint">
          <span className="mono">wraithgrid list</span>,{' '}
          <span className="mono">read &lt;pane&gt;</span>,{' '}
          <span className="mono">send &lt;pane&gt; &lt;text&gt;</span>,{' '}
          <span className="mono">wait &lt;pane&gt; --until idle</span>,{' '}
          <span className="mono">new</span>, <span className="mono">split &lt;pane&gt;</span>,{' '}
          <span className="mono">stop</span>. Run <span className="mono">wraithgrid help</span> for
          details.
        </span>
      </div>
    </div>
  )
}

function MachinesRow() {
  const actions = useActions()
  const { api } = useServices()
  const machines = useApp((s) => s.config.machines)
  const [hosts, setHosts] = useState<string[]>([])
  const [name, setName] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, string>>({})

  useEffect(() => {
    void api.machines.sshHosts().then(setHosts)
  }, [api])

  const add = (): void => {
    const err = actions.addMachine(name || sshHost, sshHost)
    setError(err)
    if (!err) {
      setName('')
      setSshHost('')
    }
  }
  const test = async (id: string, n: string, host: string): Promise<void> => {
    setTests((t) => ({ ...t, [id]: 'Connecting…' }))
    const r = await api.machines.test(n, host)
    setTests((t) => ({
      ...t,
      [id]: r.ok
        ? `Connected: Wraithgrid ${r.appVersion || '?'}, ${r.live} agent${r.live === 1 ? '' : 's'} running`
        : r.error
    }))
  }

  return (
    <div className="srow">
      <div>
        <h3>Machines</h3>
        <p className="ex">
          Run a workspace's panes on another computer over ssh: right-click the workspace, then Run
          on. Its agents keep running there when you disconnect or quit. The other computer needs
          Wraithgrid installed (<span className="mono">wraithgrid</span> on PATH) and ssh with a key
          or agent.
        </p>
      </div>
      <div className="ctl">
        {machines.map((m) => (
          <div key={m.id} className="inrow" style={{ alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{m.name}</b> <span className="mono">{m.sshHost}</span>
              {tests[m.id] ? <span className="hint"> · {tests[m.id]}</span> : null}
            </span>
            <button className="btn" onClick={() => void test(m.id, m.name, m.sshHost)}>
              Test
            </button>
            <button className="btn" onClick={() => actions.removeMachine(m.id)}>
              Remove
            </button>
          </div>
        ))}
        <div className="inrow">
          <input
            className="inpt"
            aria-label="Machine ssh host"
            list="ssh-hosts"
            value={sshHost}
            placeholder="ssh host (from ~/.ssh/config) or user@host"
            onChange={(e) => setSshHost(e.target.value)}
            spellCheck={false}
          />
          <datalist id="ssh-hosts">
            {hosts.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <input
            className="inpt"
            aria-label="Machine name"
            value={name}
            placeholder="Name (optional)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <button className="btn" disabled={!sshHost.trim()} onClick={add}>
            Add machine
          </button>
        </div>
        {error ? <span className="hint err">{error}</span> : null}
      </div>
    </div>
  )
}

function NotifyRow() {
  const actions = useActions()
  const on = useApp((s) => s.config.settings.notifyPanes)
  return (
    <div className="srow">
      <div>
        <h3>Notifications</h3>
        <p className="ex">
          A desktop notification when a claude pane you aren't looking at finishes its work or asks
          for approval. Click it to jump to the pane.
        </p>
      </div>
      <div className="ctl">
        <div className="swrow">
          <button
            className={`sw${on ? ' on' : ''}`}
            role="switch"
            aria-checked={on}
            aria-labelledby="set-notify"
            onClick={() => actions.updateSettings({ notifyPanes: !on })}
          />
          <span id="set-notify">Notify when a pane finishes or needs approval</span>
        </div>
      </div>
    </div>
  )
}

function ClaudeBinaryRow() {
  const { api } = useServices()
  const actions = useActions()
  const claudePath = useApp((s) => s.config.claudePath)
  const claude = useApp((s) => s.claude)
  const home = useApp((s) => s.info.homeDir)
  const [draft, setDraft] = useState(claudePath)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commit = (value: string): void => {
    setDraft(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      actions.setClaudePath(value.trim())
      void actions.detectClaude()
    }, 400)
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const browse = async (): Promise<void> => {
    const picked = await api.dialog.pickFile(draft || '~')
    if (picked) commit(contractHome(picked, home))
  }

  const label = claude?.source === 'override' ? 'Override' : 'Auto-detected'
  return (
    <div className="srow">
      <div>
        <h3>
          <label htmlFor="bin">claude binary</label>
        </h3>
        <p className="ex">Found on your PATH. Override it if you keep several versions.</p>
      </div>
      <div className="ctl">
        <div className="det" role="status">
          {claude === null ? (
            <span>Checking…</span>
          ) : claude.ok && claude.path ? (
            <>
              <span style={{ color: 'var(--ok)', display: 'flex' }}>
                <IconCheck small />
              </span>
              {label}:{' '}
              <span className="mono" style={{ color: 'var(--tx)' }} title={claude.path}>
                {contractHome(claude.path, home)}
              </span>
              {claude.version ? <span className="det-ver">{claude.version}</span> : null}
            </>
          ) : (
            <>
              <span style={{ color: 'var(--warn)', display: 'flex' }}>
                <IconWarn small />
              </span>
              {claude.path ? (
                <>
                  <span className="mono" style={{ color: 'var(--tx)' }}>
                    {contractHome(claude.path, home)}
                  </span>
                  <span>{claude.error}</span>
                </>
              ) : (
                <span>{claude.error ?? 'claude was not found'}. Set its path below.</span>
              )}
            </>
          )}
        </div>
        <div className="inrow">
          <input
            id="bin"
            className="inpt"
            value={draft}
            onChange={(e) => commit(e.target.value)}
            placeholder="Override path (leave empty to use auto-detect)"
            spellCheck={false}
          />
          <button className="btn" onClick={() => void browse()}>
            <IconFolder />
            Browse…
          </button>
          <button className="btn gh" onClick={() => commit('')} disabled={!draft}>
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

/** Path overrides for the other agent CLIs, one input each; empty means "find it on PATH". */
function CliPathsRow() {
  const { updateConfig } = useActions()
  const saved = useApp((s) => s.config.settings.cliPaths)
  const [draft, setDraft] = useState<Partial<Record<AgentCli, string>>>(saved)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const commit = (cli: AgentCli, value: string): void => {
    const next = { ...draft, [cli]: value }
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const cliPaths = Object.fromEntries(
        Object.entries(next)
          .map(([k, v]) => [k, (v ?? '').trim()])
          .filter(([, v]) => v)
      ) as Partial<Record<AgentCli, string>>
      updateConfig((c) => ({ ...c, settings: { ...c.settings, cliPaths } }))
    }, 400)
  }

  return (
    <div className="srow">
      <div>
        <h3>Other agent CLIs</h3>
        <p className="ex">Found on your PATH. Set a path to use a binary that is not on it.</p>
      </div>
      <div className="ctl cli-paths">
        {AGENT_CLIS.filter((c) => c !== 'claude').map((c) => (
          <label key={c} className="cli-path">
            <span className="mono">{AGENT_CLI_SPECS[c].bin}</span>
            <input
              className="inpt"
              value={draft[c] ?? ''}
              onChange={(e) => commit(c, e.target.value)}
              placeholder="on PATH"
              spellCheck={false}
              aria-label={`${AGENT_CLI_LABEL[c]} binary path`}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/** One rebindable shortcut: its keys, Change (records the next chord) and Reset. */
function ShortcutItem({ id }: { id: ShortcutId }) {
  const { updateConfig } = useActions()
  const saved = useApp((s) => s.config.settings.shortcuts)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = currentBinding(id)
  const isDefault = !saved[id]

  const store = (value: string | null): void =>
    updateConfig((c) => {
      const shortcuts = { ...c.settings.shortcuts }
      if (value) shortcuts[id] = value
      else delete shortcuts[id]
      return { ...c, settings: { ...c.settings, shortcuts } }
    })

  // While recording, the next chord is the binding; it never reaches the app or a pane.
  useEffect(() => {
    if (!recording) return
    setRecordingShortcut(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setRecording(false)
      const b = bindingFromEvent(e)
      if (!b) return
      const problem = bindingProblem(b, id)
      setRecording(false)
      setError(problem)
      if (!problem) {
        const d = defaultBinding(id)
        const same = d.code === b.code && d.shift === b.shift && d.alt === b.alt
        store(same ? null : formatBinding(b))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setRecordingShortcut(false)
    }
  })

  return (
    <div className="sc-row">
      <span>{SHORTCUT_LABEL[id]}</span>
      <span className="keys">
        {recording ? (
          <span className="hint" role="status">
            Press the new keys… (Esc cancels)
          </span>
        ) : (
          bindingKeys(current).map((k, i) => <kbd key={i}>{k}</kbd>)
        )}
        <button
          className="btn gh sm"
          aria-label={`Change shortcut: ${SHORTCUT_LABEL[id]}`}
          onClick={() => {
            setError(null)
            setRecording((v) => !v)
          }}
        >
          {recording ? 'Cancel' : 'Change'}
        </button>
        <button
          className="btn gh sm"
          aria-label={`Reset shortcut: ${SHORTCUT_LABEL[id]}`}
          disabled={isDefault}
          onClick={() => {
            setError(null)
            store(null)
          }}
        >
          Reset
        </button>
      </span>
      {error ? <span className="hint err sc-err">{error}</span> : null}
    </div>
  )
}

function ShortcutsRow() {
  return (
    <div className="srow">
      <div>
        <h3>Keyboard shortcuts</h3>
        <p className="ex">
          Pick another chord for an app shortcut. It needs Shift or Alt with {IS_MAC ? '⌘' : 'Ctrl'}
          , so the terminal keeps its own keys.
        </p>
      </div>
      <div className="ctl scl">
        {SHORTCUT_IDS.map((id) => (
          <ShortcutItem key={id} id={id} />
        ))}
      </div>
    </div>
  )
}

function SharedRow() {
  const actions = useActions()
  const mode = useApp((s) => s.config.settings.sharedMode)
  const report = useApp((s) => s.sharedReport)
  const home = useApp((s) => s.info.homeDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restarted, setRestarted] = useState<number | null>(null)

  const choose = async (next: SharedMode): Promise<void> => {
    if (next === mode) return
    setBusy(true)
    setRestarted(null)
    setError(await actions.setSharedMode(next))
    setBusy(false)
  }

  // One line per account that changed, e.g. "work: linked CLAUDE.md, skills".
  const lines = Object.entries(
    (report ?? []).reduce<Record<string, string[]>>((acc, r) => {
      if (r.outcome === 'already-linked') return acc
      const what =
        r.outcome === 'failed'
          ? `could not link ${r.item} (${r.error})`
          : r.outcome === 'linked' && r.backup
            ? `linked ${r.item}, kept the old one as ${contractHome(r.backup, home)}`
            : r.outcome === 'restored'
              ? `restored its own ${r.item}`
              : `${r.outcome} ${r.item}`
      ;(acc[r.account] ??= []).push(what)
      return acc
    }, {})
  )

  const chip = (value: SharedMode, label: string) => (
    <button
      key={value}
      className={`rchip${mode === value ? ' on' : ''}`}
      role="radio"
      aria-checked={mode === value}
      disabled={busy}
      onClick={() => void choose(value)}
      style={{ fontFamily: 'inherit', fontSize: 12.5, height: 30 }}
    >
      {label}
    </button>
  )

  return (
    <div className="srow">
      <div>
        <h3 id="shared-h">Shared CLAUDE.md and skills</h3>
        <p className="ex">
          Overall gives every account, including new ones, your normal claude setup. Logins and
          history always stay separate.
        </p>
      </div>
      <div className="ctl">
        <div className="recent" role="radiogroup" aria-labelledby="shared-h">
          {chip('overall', 'Overall (~/.claude)')}
          {chip('per-account', 'Each account its own')}
        </div>
        <span className="hint">
          Links <span className="mono">CLAUDE.md</span>, <span className="mono">settings.json</span>
          , <span className="mono">skills</span>, <span className="mono">plugins</span>,{' '}
          <span className="mono">agents</span> and <span className="mono">commands</span> from{' '}
          <span className="mono">~/.claude</span>. Files an account already had are kept as backups.
        </span>
        {error ? <span className="hint err">{error}</span> : null}
        {lines.length ? (
          <div className="note" role="status" style={{ flexDirection: 'column', gap: 2 }}>
            {lines.map(([account, whats]) => (
              <span key={account}>
                <b>{account}</b>: {whats.join('; ')}
              </span>
            ))}
          </div>
        ) : null}
        {report ? (
          <span className="hint">
            Running claude panes read these files at start.{' '}
            <button
              className="btn gh"
              style={{ height: 26, fontSize: 12 }}
              onClick={() => setRestarted(actions.restartClaudePanes())}
            >
              Restart claude panes
            </button>
            {restarted !== null ? ` Restarted ${restarted}.` : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

type SettingsTab = 'general' | 'chat' | 'appearance' | 'agents' | 'advanced' | 'keyboard' | 'about'

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Chat' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'agents', label: 'Agents & CLIs' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'about', label: 'About' }
]

/** claude's own aliases (from its model list), offered before any chat has started. */
const FALLBACK_MODELS: ChatModel[] = [
  {
    value: 'opus',
    label: 'Opus',
    description: 'For complex work and everyday tasks',
    efforts: [...CHAT_EFFORTS]
  },
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Most efficient for simpler tasks',
    efforts: [...CHAT_EFFORTS]
  },
  {
    value: 'haiku',
    label: 'Haiku',
    description: 'Fastest for quick answers',
    efforts: [...CHAT_EFFORTS]
  }
]

function ChatDefaultsRow() {
  const actions = useActions()
  const model = useApp((s) => s.config.settings.chatModel)
  const effort = useApp((s) => s.config.settings.chatEffort)
  const mode = useApp((s) => s.config.settings.chatMode)
  // The default account's own list, once one of its chats has started.
  const known = useApp((s) => {
    const id = s.config.settings.defaultAccountId ?? s.config.accounts[0]?.id
    return (id ? s.accountInfo[id]?.models : undefined) ?? null
  })
  const models = (known?.length ? known : FALLBACK_MODELS).filter((m) => m.value !== 'default')
  return (
    <>
      <div className="srow">
        <div>
          <h3 id="chat-model-h">Model for new chats</h3>
          <p className="ex">
            Each chat can switch from the model button in its message box. Default follows the
            account's own setting.
          </p>
        </div>
        <div className="ctl">
          <div className="seg wrap" role="radiogroup" aria-labelledby="chat-model-h">
            {[{ value: null, label: 'Default' }, ...models].map((m) => (
              <button
                key={m.value ?? 'default'}
                role="radio"
                aria-checked={model === m.value}
                className={`seg-btn${model === m.value ? ' on' : ''}`}
                onClick={() => actions.updateSettings({ chatModel: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="srow">
        <div>
          <h3 id="chat-effort-h">Effort for new chats</h3>
          <p className="ex">
            How hard the model thinks before it answers. Higher is slower and uses more of your
            plan.
          </p>
        </div>
        <div className="ctl">
          <div className="seg" role="radiogroup" aria-labelledby="chat-effort-h">
            {([null, ...CHAT_EFFORTS] as const).map((e) => (
              <button
                key={e ?? 'default'}
                role="radio"
                aria-checked={effort === e}
                className={`seg-btn${effort === e ? ' on' : ''}`}
                onClick={() => actions.updateSettings({ chatEffort: e })}
              >
                {e === null ? 'Default' : EFFORT_LABEL[e]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="srow">
        <div>
          <h3 id="chat-mode-h">Mode for new chats</h3>
          <p className="ex">
            How much a chat may do without asking. Each chat can switch from its mode button or with
            Shift+Tab.
          </p>
        </div>
        <div className="ctl">
          <div className="seg wrap" role="radiogroup" aria-labelledby="chat-mode-h">
            {(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const).map((m) => {
              const on = (mode ?? 'default') === m
              return (
                <button
                  key={m}
                  role="radio"
                  aria-checked={on}
                  title={CHAT_MODE_HINT[m]}
                  className={`seg-btn${on ? ' on' : ''}`}
                  onClick={() => actions.updateSettings({ chatMode: m === 'default' ? null : m })}
                >
                  {CHAT_MODE_LABEL[m]}
                </button>
              )
            })}
          </div>
          <span className="hint">
            Bypass permissions is only offered per chat, never by default.
          </span>
        </div>
      </div>
    </>
  )
}

export function SettingsView() {
  const { api } = useServices()
  const actions = useActions()
  const settings = useApp((s) => s.config.settings)
  const accounts = useApp((s) => s.config.accounts)
  const configPath = useApp((s) => s.info.configPath)
  const home = useApp((s) => s.info.homeDir)
  const [defDir, setDefDir] = useState(settings.defaultCwd)
  const term = useApp((s) => terminalTheme(s.config.settings.terminalPalette, drawnTheme(s)))

  const setDefaultCwd = (v: string): void => {
    setDefDir(v)
    if (v.trim()) actions.updateSettings({ defaultCwd: v.trim() })
  }
  const browseDir = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(defDir || '~')
    if (picked) setDefaultCwd(contractHome(picked, home))
  }

  const anchor = useApp((s) => s.settingsAnchor)
  const [tab, setTab] = useState<SettingsTab>(anchor === 'updates' ? 'about' : 'general')
  // "Show updates" from a notification or the status bar opens About.
  if (anchor === 'updates' && tab !== 'about') setTab('about')

  return (
    <div className="page set-page">
      <nav
        className="set-nav"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
      >
        <h1>Settings</h1>
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`set-tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <p className="set-path" title={configPath}>
          Saved to <span className="mono">{configPath}</span>
        </p>
      </nav>
      <div
        className="set"
        role="tabpanel"
        aria-label={SETTINGS_TABS.find((t) => t.id === tab)?.label}
      >
        <h2 className="set-title">{SETTINGS_TABS.find((t) => t.id === tab)?.label}</h2>
        {tab === 'general' ? (
          <>
            <div className="srow">
              <div>
                <h3 id="defacc-h">Default account</h3>
                <p className="ex">Pre-selected in the New pane dialog.</p>
              </div>
              <div className="ctl">
                {accounts.length === 0 ? (
                  <span className="hint">No accounts yet.</span>
                ) : (
                  <div className="recent" role="radiogroup" aria-labelledby="defacc-h">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        className={`rchip${settings.defaultAccountId === a.id ? ' on' : ''}`}
                        role="radio"
                        aria-checked={settings.defaultAccountId === a.id}
                        onClick={() => actions.updateSettings({ defaultAccountId: a.id })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: 'inherit',
                          fontSize: 12.5,
                          height: 30
                        }}
                      >
                        <Initial name={a.name} size={16} />
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="srow">
              <div>
                <h3>
                  <label htmlFor="defdir">Default working directory</label>
                </h3>
                <p className="ex">Where the folder picker opens and Login panes start.</p>
              </div>
              <div className="ctl">
                <div className="inrow">
                  <input
                    id="defdir"
                    className="inpt"
                    value={defDir}
                    onChange={(e) => setDefaultCwd(e.target.value)}
                    spellCheck={false}
                  />
                  <button className="btn" onClick={() => void browseDir()}>
                    <IconFolder />
                    Browse…
                  </button>
                </div>
              </div>
            </div>

            <PaneViewRow />
            <CloseRow />
            <NotifyRow />
          </>
        ) : null}
        {tab === 'chat' ? <ChatDefaultsRow /> : null}
        {tab === 'appearance' ? (
          <>
            <ThemeRow />
            <ZoomRow />
            <AccentRow />
            <PaletteRow />
            <div className="srow">
              <div>
                <h3 id="font-h">Terminal font</h3>
                <p className="ex">
                  Applies to every pane. Monospace fonts only; a font that is not installed falls
                  back to your system monospace.
                </p>
              </div>
              <div className="ctl">
                <div className="fonts" role="radiogroup" aria-labelledby="font-h">
                  {TERMINAL_FONTS.map((f) => (
                    <button
                      key={f}
                      className={`fopt${settings.fontFamily === f ? ' on' : ''}`}
                      role="radio"
                      aria-checked={settings.fontFamily === f}
                      style={{ fontFamily: terminalFontStack(f) }}
                      onClick={() => actions.updateSettings({ fontFamily: f })}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="lbl">Size</span>
                  <div className="step">
                    <button
                      aria-label="Decrease font size"
                      disabled={settings.fontSize <= FONT_SIZE_MIN}
                      onClick={() =>
                        actions.updateSettings({
                          fontSize: Math.max(FONT_SIZE_MIN, settings.fontSize - 1)
                        })
                      }
                    >
                      −
                    </button>
                    <span aria-live="polite">{settings.fontSize} px</span>
                    <button
                      aria-label="Increase font size"
                      disabled={settings.fontSize >= FONT_SIZE_MAX}
                      onClick={() =>
                        actions.updateSettings({
                          fontSize: Math.min(FONT_SIZE_MAX, settings.fontSize + 1)
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
                <div
                  className="prev"
                  style={
                    {
                      fontFamily: terminalFontStack(settings.fontFamily),
                      fontSize: settings.fontSize,
                      '--pv-bg': term.background,
                      '--pv-fg': term.foreground,
                      '--pv-dim': term.brightBlack,
                      '--pv-acc': term.cursor,
                      '--pv-ok': term.green
                    } as CSSProperties
                  }
                  aria-label="Font preview"
                >
                  <span className="a">&gt; </span>
                  <span className="b">fix the failing auth test</span>
                  {'\n'}
                  <span className="g">● </span>
                  <span className="b">Bash</span>
                  <span className="d">(pnpm test auth)</span>
                  {'\n'}
                  <span className="d">{'  ⎿  '}</span>
                  <span className="g">PASS</span>
                  <span className="d"> src/auth/auth.controller.spec.ts</span>
                  {'\n'}
                  <span className="ladd">
                    {"  13 + import { Throttle } from '@nestjs/throttler';"}
                  </span>
                  {'\n'}
                  <span className="d">{'  0O 1lI {}[] => !== ─│╭╮ ✻ ⎿'}</span>
                </div>
              </div>
            </div>
          </>
        ) : null}
        {tab === 'agents' ? (
          <>
            <ClaudeBinaryRow />
            <CliPathsRow />
            <SharedRow />
            <ShellRow />
          </>
        ) : null}
        {tab === 'advanced' ? (
          <>
            <CliRow />
            <MachinesRow />
          </>
        ) : null}
        {tab === 'keyboard' ? <ShortcutsRow /> : null}
        {tab === 'about' ? (
          <>
            <UpdatesRow />
            <WhatsNewRow />
          </>
        ) : null}
      </div>
    </div>
  )
}
