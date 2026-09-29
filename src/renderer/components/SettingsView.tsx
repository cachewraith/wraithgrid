import { useEffect, useRef, useState } from 'react'
import { contractHome } from '@shared/paths'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, TERMINAL_FONTS } from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { terminalFontStack } from '../lib/term-theme'
import { IconCheck, IconFolder, IconMoon, IconSun, IconWarn } from './icons'

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
              {claude.version ? <span className="hint">({claude.version})</span> : null}
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

function SharedRow() {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const sourceId = useApp((s) => s.config.settings.sharedSourceAccountId)
  const report = useApp((s) => s.sharedReport)
  const home = useApp((s) => s.info.homeDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (id: string | null): Promise<void> => {
    if (id === sourceId) return
    setBusy(true)
    setError(await actions.setSharedSource(id))
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

  const chip = (id: string | null, label: string, color?: string) => (
    <button
      key={id ?? 'off'}
      className={`rchip${sourceId === id ? ' on' : ''}`}
      role="radio"
      aria-checked={sourceId === id}
      disabled={busy}
      onClick={() => void choose(id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'inherit',
        fontSize: 12.5,
        height: 30
      }}
    >
      {color ? <span className="dot" style={{ background: color }} /> : null}
      {label}
    </button>
  )

  return (
    <div className="srow">
      <div>
        <h3 id="shared-h">Shared CLAUDE.md and skills</h3>
        <p className="ex">
          One CLAUDE.md and one skills folder for every account, taken from the account you pick.
          Logins, settings and history stay separate.
        </p>
      </div>
      <div className="ctl">
        {accounts.length < 2 ? (
          <span className="hint">Add a second account to share between them.</span>
        ) : (
          <div className="recent" role="radiogroup" aria-labelledby="shared-h">
            {chip(null, 'Off (each account its own)')}
            {accounts.map((a) => chip(a.id, a.name, a.color))}
          </div>
        )}
        <span className="hint">
          The other accounts get links to its <span className="mono">CLAUDE.md</span> and{' '}
          <span className="mono">skills/</span>. A file they already had is kept as{' '}
          <span className="mono">…wraithgrid-backup</span> and comes back when you turn this off.
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

        <ClaudeBinaryRow />

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
              style={{
                fontFamily: terminalFontStack(settings.fontFamily),
                fontSize: settings.fontSize
              }}
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

        <div className="srow">
          <div>
            <h3 id="theme-h">Theme</h3>
            <p className="ex">Terminal colors follow the theme.</p>
          </div>
          <div className="ctl">
            <div
              className="seg"
              role="radiogroup"
              aria-labelledby="theme-h"
              style={{ width: 'max-content' }}
            >
              <button
                className={`seg-btn${settings.theme === 'dark' ? ' on' : ''}`}
                role="radio"
                aria-checked={settings.theme === 'dark'}
                onClick={() => actions.updateSettings({ theme: 'dark' })}
                style={{ padding: '0 14px' }}
              >
                <IconMoon small />
                Dark
              </button>
              <button
                className={`seg-btn${settings.theme === 'light' ? ' on' : ''}`}
                role="radio"
                aria-checked={settings.theme === 'light'}
                onClick={() => actions.updateSettings({ theme: 'light' })}
                style={{ padding: '0 14px' }}
              >
                <IconSun small />
                Light
              </button>
            </div>
            <span className="theme-note">
              {settings.theme === 'dark'
                ? 'Dark is the default.'
                : 'Light theme is on for the whole app.'}
            </span>
          </div>
        </div>

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
                    <span className="dot" style={{ background: a.color }} />
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <SharedRow />

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
      </div>
    </div>
  )
}
