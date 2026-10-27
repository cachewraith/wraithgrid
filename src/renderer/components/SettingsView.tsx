import { CommunityThemes } from './CommunityThemes'
import { ThemeEditor } from './ThemeEditor'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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
import { UpdatesCard, WhatsNew } from './AboutView'
import { useActions, useApp, useServices } from '../app/services'
import { currentTheme, drawnTheme } from '../app/store'
import { pickTheme, themeVars, type AppTheme, type ThemeFile } from '@shared/themes'
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
  const [editing, setEditing] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const follow = pref === 'system'
  const darkId = pickTheme(themes, themeDark, 'dark').id
  const lightId = pickTheme(themes, themeLight, 'light').id
  const drawnId = mode === 'dark' ? darkId : lightId

  const run = async (p: Promise<string | null>): Promise<void> => setError(await p)
  const exportTheme = async (t: ThemeFile): Promise<void> => {
    const { name, mode, author, colors, terminal, style } = t
    const r = await api.themes.export({ name, mode, author, colors, terminal, style })
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
          <button className="btn" aria-expanded={browsing} onClick={() => setBrowsing(!browsing)}>
            Browse community…
          </button>
          <button className="btn" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            Customize…
          </button>
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
      {browsing ? <CommunityThemes onClose={() => setBrowsing(false)} /> : null}
      {editing ? (
        <ThemeEditor
          start={themes.find((t) => t.id === drawnId) ?? themes[0]!}
          onClose={() => setEditing(false)}
        />
      ) : null}
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

/** The Rust background host (ADR 0004): off by default, Linux and macOS builds that have it. */
function RustHostRow() {
  const actions = useActions()
  const on = useApp((s) => s.config.settings.rustHost)
  const available = useApp((s) => s.info.rustHost)
  const unix = useApp((s) => s.info.platform === 'linux' || s.info.platform === 'darwin')
  if (!unix) return null
  return (
    <div className="srow">
      <div>
        <h3>Rust background host</h3>
        <p className="ex">
          Experimental. Runs terminal panes in the new background host written in Rust: about 5 MB
          of memory while idle instead of about 110 MB. Chat panes are not affected. It is used the
          next time the background host starts: quit with <em>Quit and stop agents</em>, then open
          Wraithgrid again.
        </p>
      </div>
      <div className="ctl">
        <div className="swrow">
          <button
            className={`sw${on ? ' on' : ''}`}
            role="switch"
            aria-checked={on}
            aria-labelledby="set-rust-host"
            disabled={!available}
            onClick={() => actions.updateSettings({ rustHost: !on })}
          />
          <span id="set-rust-host">Use the Rust host</span>
        </div>
        {available ? null : <span className="hint">Not included in this build.</span>}
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

/**
 * Runs the latest save 400 ms after typing stops; leaving the page runs a waiting one at once,
 * so the last edit is kept (#140).
 */
function useDebouncedSave(): (fn: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => void) | null>(null)
  const run = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const fn = pending.current
    timer.current = null
    pending.current = null
    fn?.()
  }, [])
  useEffect(() => run, [run])
  return useCallback(
    (fn: () => void) => {
      if (timer.current) clearTimeout(timer.current)
      pending.current = fn
      timer.current = setTimeout(run, 400)
    },
    [run]
  )
}

function ClaudeBinaryRow() {
  const { api } = useServices()
  const actions = useActions()
  const claudePath = useApp((s) => s.config.claudePath)
  const claude = useApp((s) => s.claude)
  const home = useApp((s) => s.info.homeDir)
  const [draft, setDraft] = useState(claudePath)
  const save = useDebouncedSave()

  const commit = (value: string): void => {
    setDraft(value)
    save(() => {
      actions.setClaudePath(value.trim())
      void actions.detectClaude()
    })
  }

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
  const save = useDebouncedSave()

  const commit = (cli: AgentCli, value: string): void => {
    const next = { ...draft, [cli]: value }
    setDraft(next)
    save(() => {
      const cliPaths = Object.fromEntries(
        Object.entries(next)
          .map(([k, v]) => [k, (v ?? '').trim()])
          .filter(([, v]) => v)
      ) as Partial<Record<AgentCli, string>>
      updateConfig((c) => ({ ...c, settings: { ...c.settings, cliPaths } }))
    })
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
        <h3 id="shared-h">Shared instructions and skills</h3>
        <p className="ex">
          Overall gives each provider one brain: all claude accounts share one CLAUDE.md and skills,
          all codex accounts one AGENTS.md and skills, and so on. Logins and history always stay
          separate.
        </p>
      </div>
      <div className="ctl">
        <div className="recent" role="radiogroup" aria-labelledby="shared-h">
          {chip('overall', 'Overall (one per provider)')}
          {chip('per-account', 'Each account its own')}
        </div>
        <span className="hint">
          Kept in <span className="mono">~/.wraithgrid/shared/&lt;provider&gt;</span>, first copied
          from that provider&apos;s own home (<span className="mono">~/.claude</span>,{' '}
          <span className="mono">~/.codex</span>…), which is left as it is. claude:{' '}
          <span className="mono">CLAUDE.md</span>, settings, skills, plugins, agents, commands.
          codex: <span className="mono">AGENTS.md</span>, skills, prompts. Files an account already
          had are kept as backups.
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
      <AutoSwitchRow />
    </>
  )
}

/** Switch account at the limit (#61): on/off and the percentage that counts as reached. */
function AutoSwitchRow() {
  const actions = useActions()
  const on = useApp((s) => s.config.settings.autoSwitchAtLimit)
  const at = useApp((s) => s.config.settings.autoSwitchAt)
  return (
    <div className="srow">
      <div>
        <h3 id="auto-switch-h">Switch account at limit</h3>
        <p className="ex">
          When a Claude or Codex chat's account reaches its 5-hour or weekly limit, the chat carries
          on as your next account of the same CLI that has room, with the whole conversation. A
          message the limit refused is sent again there.
        </p>
      </div>
      <div className="ctl">
        <div className="swrow">
          <button
            className={`sw${on ? ' on' : ''}`}
            role="switch"
            aria-checked={on}
            aria-labelledby="set-auto-switch"
            onClick={() => actions.updateSettings({ autoSwitchAtLimit: !on })}
          />
          <span id="set-auto-switch">Switch to the next account at the limit</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Switch at">
          {[80, 90, 95, 100].map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={at === p}
              disabled={!on}
              className={`seg-btn${at === p ? ' on' : ''}`}
              onClick={() => actions.updateSettings({ autoSwitchAt: p })}
            >
              {p}%
            </button>
          ))}
        </div>
      </div>
    </div>
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
            id={`settings-tab-${t.id}`}
            aria-controls={`settings-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => {
              const step =
                e.key === 'ArrowDown' || e.key === 'ArrowRight'
                  ? 1
                  : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
                    ? -1
                    : 0
              const index =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? SETTINGS_TABS.length - 1
                    : step
                      ? (SETTINGS_TABS.findIndex((item) => item.id === tab) +
                          step +
                          SETTINGS_TABS.length) %
                        SETTINGS_TABS.length
                      : -1
              if (index < 0) return
              e.preventDefault()
              const next = SETTINGS_TABS[index]!.id
              setTab(next)
              document.getElementById(`settings-tab-${next}`)?.focus()
            }}
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
        className={`set${tab === 'about' ? ' set-about' : ''}`}
        key={tab}
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
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
            <RustHostRow />
            <MachinesRow />
          </>
        ) : null}
        {tab === 'keyboard' ? <ShortcutsRow /> : null}
        {tab === 'about' ? (
          <>
            <UpdatesCard />
            <WhatsNew />
          </>
        ) : null}
      </div>
    </div>
  )
}
