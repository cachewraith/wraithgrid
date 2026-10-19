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
  type AccentName,
  type CloseMode,
  type SharedMode,
  type ShortcutId,
  type ThemePreference
} from '@shared/types'
import { AccountIcon } from './AccountIcon'
import { useActions, useApp, useServices } from '../app/services'
import { currentTheme } from '../app/store'
import { PALETTE_LABEL, terminalFontStack, terminalTheme } from '../lib/term-theme'
import {
  IconCheck,
  IconFolder,
  IconImport,
  IconMonitor,
  IconMoon,
  IconRestart,
  IconSun,
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

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'System', icon: <IconMonitor small /> },
  { id: 'dark', label: 'Dark', icon: <IconMoon small /> },
  { id: 'light', label: 'Light', icon: <IconSun small /> }
]

function ThemeRow() {
  const actions = useActions()
  const pref = useApp((s) => s.config.settings.theme)
  const systemTheme = useApp((s) => s.systemTheme)
  return (
    <div className="srow">
      <div>
        <h3 id="theme-h">Theme</h3>
        <p className="ex">System follows your desktop's light or dark setting as it changes.</p>
      </div>
      <div className="ctl">
        <div
          className="seg"
          role="radiogroup"
          aria-labelledby="theme-h"
          style={{ width: 'max-content' }}
        >
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={`seg-btn${pref === o.id ? ' on' : ''}`}
              role="radio"
              aria-checked={pref === o.id}
              onClick={() => actions.updateSettings({ theme: o.id })}
              style={{ padding: '0 14px' }}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
        <span className="theme-note">
          {pref === 'system'
            ? `Your desktop is using ${systemTheme} right now.`
            : pref === 'dark'
              ? 'Dark is the default.'
              : 'Light theme is on for the whole app.'}
        </span>
      </div>
    </div>
  )
}

function AccentRow() {
  const actions = useActions()
  const accent = useApp((s) => s.config.settings.accent)
  return (
    <div className="srow">
      <div>
        <h3 id="accent-h">Accent color</h3>
        <p className="ex">Buttons, selection, focus rings and the terminal cursor.</p>
      </div>
      <div className="ctl">
        <div className="accents" role="radiogroup" aria-labelledby="accent-h">
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
  const theme = useApp(currentTheme)
  const accent = useApp((s) => s.config.settings.accent)
  return (
    <div className="srow">
      <div>
        <h3 id="palette-h">Terminal colors</h3>
        <p className="ex">
          Match app follows the theme and accent. The others keep their own colors in both themes.
        </p>
      </div>
      <div className="ctl">
        <div className="palettes" role="radiogroup" aria-labelledby="palette-h">
          {TERMINAL_PALETTES.map((p) => {
            const t = terminalTheme(p, theme, accent)
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

/**
 * Release notes are shown as text, never as HTML: headings and bullets get a light
 * touch, everything else stays as GitHub wrote it.
 */
function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="relnotes" aria-label="Release notes">
      {notes.split('\n').map((line, i) => {
        const h = /^#{1,6}\s+(.*)$/.exec(line)
        if (h) return <b key={i}>{h[1]}</b>
        const li = /^\s*[*-]\s+(.*)$/.exec(line)
        if (li)
          return (
            <span key={i} className="li">
              {li[1]}
            </span>
          )
        return line.trim() ? <span key={i}>{line}</span> : null
      })}
    </div>
  )
}

function UpdatesRow() {
  const { api } = useServices()
  const actions = useActions()
  const version = useApp((s) => s.info.version)
  const onLaunch = useApp((s) => s.config.settings.checkUpdatesOnLaunch)
  // macOS builds can't replace themselves (not Developer ID signed): straight to the page.
  const manualOnly = useApp((s) => s.info.platform === 'darwin')
  const { checking, result, install, installError } = useApp((s) => s.update)
  const busy = install.phase !== 'idle'
  const anchor = useApp((s) => s.settingsAnchor)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (anchor !== 'updates') return
    ref.current?.scrollIntoView({ block: 'center' })
    actions.clearSettingsAnchor()
  }, [anchor, actions])

  const status = busy ? (
    <span>
      {install.phase === 'checking'
        ? 'Preparing the update…'
        : install.phase === 'downloading'
          ? `Downloading ${install.version}… ${install.percent}%`
          : `Installing ${install.version}. Wraithgrid restarts when it is done.`}
    </span>
  ) : installError ? (
    <>
      <span style={{ color: 'var(--warn)', display: 'flex' }}>
        <IconWarn small />
      </span>
      <span>{installError.error}</span>
    </>
  ) : checking ? (
    <span>Checking GitHub for a newer release…</span>
  ) : !result || result.status === 'skipped' ? (
    <span>Not checked yet.</span>
  ) : result.status === 'error' ? (
    <>
      <span style={{ color: 'var(--warn)', display: 'flex' }}>
        <IconWarn small />
      </span>
      <span>{result.error}</span>
    </>
  ) : result.status === 'current' ? (
    <>
      <span style={{ color: 'var(--ok)', display: 'flex' }}>
        <IconCheck small />
      </span>
      <span>You have the latest version.</span>
    </>
  ) : (
    <span>
      <b style={{ color: 'var(--tx)' }}>Wraithgrid {result.latest.version}</b> is available
      {formatDate(result.latest.publishedAt)
        ? ` (released ${formatDate(result.latest.publishedAt)})`
        : ''}
      .
    </span>
  )

  return (
    <div className="srow" id="updates" ref={ref}>
      <div>
        <h3>Updates</h3>
        <p className="ex">
          Checks the releases on GitHub. Update &amp; restart downloads the new version, replaces
          this one and reopens Wraithgrid; running panes close. On Linux your password is asked for.
        </p>
      </div>
      <div className="ctl">
        <div className="det">
          <span>
            Version{' '}
            <span className="mono" style={{ color: 'var(--tx)' }}>
              {version}
            </span>
          </span>
        </div>
        <div className="det" role="status" aria-live="polite">
          {status}
        </div>
        <div className="inrow">
          <button
            className="btn"
            disabled={checking || busy}
            onClick={() => void actions.checkForUpdates('manual')}
          >
            <IconRestart />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {result?.status === 'available' && !installError?.manual && !manualOnly ? (
            <button
              className="btn pri"
              disabled={busy}
              onClick={() => void actions.installUpdate()}
            >
              <IconImport />
              {busy ? 'Updating…' : `Update to ${result.latest.version} & restart`}
            </button>
          ) : null}
          {result?.status === 'available' && (installError?.manual || manualOnly) ? (
            <button
              className="btn pri"
              onClick={() => void api.shell.openExternal(result.latest.url)}
            >
              <IconImport />
              Open release page
            </button>
          ) : null}
        </div>
        {result?.status === 'available' && result.latest.notes ? (
          <ReleaseNotes notes={result.latest.notes} />
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

export function SettingsView() {
  const { api } = useServices()
  const actions = useActions()
  const settings = useApp((s) => s.config.settings)
  const accounts = useApp((s) => s.config.accounts)
  const configPath = useApp((s) => s.info.configPath)
  const home = useApp((s) => s.info.homeDir)
  const [defDir, setDefDir] = useState(settings.defaultCwd)
  const term = useApp((s) =>
    terminalTheme(s.config.settings.terminalPalette, currentTheme(s), s.config.settings.accent)
  )

  const setDefaultCwd = (v: string): void => {
    setDefDir(v)
    if (v.trim()) actions.updateSettings({ defaultCwd: v.trim() })
  }
  const browseDir = async (): Promise<void> => {
    const picked = await api.dialog.pickFolder(defDir || '~')
    if (picked) setDefaultCwd(contractHome(picked, home))
  }

  return (
    <div className="page">
      <div className="set">
        <div className="pg-hd" style={{ paddingBottom: 18 }}>
          <div>
            <h1>Settings</h1>
            <p>
              Saved to <span className="mono">{configPath}</span>
            </p>
          </div>
        </div>

        <h2 className="sgrp">General</h2>
        <ClaudeBinaryRow />
        <CliPathsRow />

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
                    <AccountIcon account={a} size={16} />
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <SharedRow />
        <ShellRow />
        <CloseRow />
        <CliRow />
        <MachinesRow />

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

        <h2 className="sgrp">Appearance</h2>
        <ThemeRow />
        <AccentRow />
        <PaletteRow />
        <div className="srow">
          <div>
            <h3 id="font-h">Terminal font</h3>
            <p className="ex">
              Applies to every pane. Monospace fonts only; a font that is not installed falls back
              to your system monospace.
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
              <span className="ladd">{"  13 + import { Throttle } from '@nestjs/throttler';"}</span>
              {'\n'}
              <span className="d">{'  0O 1lI {}[] => !== ─│╭╮ ✻ ⎿'}</span>
            </div>
          </div>
        </div>

        <h2 className="sgrp">Keyboard</h2>
        <ShortcutsRow />

        <h2 className="sgrp">Notifications</h2>
        <NotifyRow />

        <h2 className="sgrp">About</h2>
        <UpdatesRow />
      </div>
    </div>
  )
}
