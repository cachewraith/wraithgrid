// The theme editor (#24): starts from a theme, edits a draft that the whole app draws live,
// warns about hard-to-read pairs, and saves the draft as a new theme file (checked again in
// main). Leaving it puts the chosen theme back.
import { useEffect, useMemo, useState } from 'react'
import { Select } from './Select'
import { contrastIssues } from '@shared/contrast'
import {
  CHAT_TEXT_MAX,
  CHAT_TEXT_MIN,
  MONO_FONTS,
  THEME_BORDER,
  THEME_DENSITY,
  THEME_DEPTH,
  THEME_MOTION,
  THEME_RADIUS,
  UI_FONTS,
  type AppTheme,
  type ThemeColorName,
  type ThemeFile,
  type ThemeStyle
} from '@shared/themes'
import { useActions, useApp, useServices } from '../app/services'

const COLOR_GROUPS: { title: string; keys: [ThemeColorName, string][] }[] = [
  {
    title: 'Surfaces',
    keys: [
      ['bg', 'Background'],
      ['sidebar', 'Sidebar'],
      ['panel', 'Menus & cards'],
      ['raised', 'Raised'],
      ['frame', 'Window frame'],
      ['line', 'Borders'],
      ['lineStrong', 'Strong borders']
    ]
  },
  {
    title: 'Text',
    keys: [
      ['text', 'Text'],
      ['muted', 'Muted text'],
      ['faint', 'Hints']
    ]
  },
  {
    title: 'Accent',
    keys: [
      ['accent', 'Accent'],
      ['accentText', 'Accent text'],
      ['accentFill', 'Accent buttons'],
      ['onAccent', 'Text on accent']
    ]
  },
  {
    title: 'Status',
    keys: [
      ['ok', 'Success'],
      ['warn', 'Warning'],
      ['err', 'Error'],
      ['info', 'Info']
    ]
  },
  {
    title: 'Chat, code & terminal',
    keys: [
      ['userBubble', 'Your messages'],
      ['codeBlock', 'Code blocks'],
      ['diffAdd', 'Added lines'],
      ['diffDel', 'Removed lines'],
      ['terminal', 'Terminal']
    ]
  }
]
const REQUIRED = new Set<ThemeColorName>(['bg', 'text', 'accent'])
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const LABEL: Record<string, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  thin: 'Thin',
  thick: 'Thick',
  flat: 'Flat',
  soft: 'Soft',
  deep: 'Deep',
  compact: 'Compact',
  comfortable: 'Comfortable',
  spacious: 'Spacious',
  on: 'On',
  reduced: 'Reduced',
  off: 'Off'
}

/** The file part of a theme (no id / builtIn), copied so edits never touch the original. */
function fileOf(t: ThemeFile, name: string): ThemeFile {
  const { name: _n, mode, author, colors, terminal, style } = t
  return JSON.parse(JSON.stringify({ name, mode, author, colors, terminal, style })) as ThemeFile
}

function Seg<K extends string>({
  label,
  options,
  value,
  onPick
}: {
  label: string
  options: readonly K[]
  value: K
  onPick: (v: K) => void
}) {
  return (
    <div className="ted-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={value === o}
          className={value === o ? 'on' : ''}
          onClick={() => onPick(o)}
        >
          {LABEL[o] ?? o}
        </button>
      ))}
    </div>
  )
}

export function ThemeEditor({ start, onClose }: { start: AppTheme; onClose: () => void }) {
  const { api } = useServices()
  const actions = useActions()
  const { setThemeDraft, saveThemeDraft } = actions
  const themes = useApp((s) => s.themes)
  const [base, setBase] = useState<AppTheme>(start)
  const [draft, setDraft] = useState<ThemeFile>(() => fileOf(start, `${start.name} custom`))
  const [history, setHistory] = useState<ThemeFile[]>([])
  const [error, setError] = useState<string | null>(null)

  // The whole app is the preview; leaving the editor puts the chosen theme back.
  useEffect(() => setThemeDraft(draft), [draft, setThemeDraft])
  useEffect(() => () => setThemeDraft(null), [setThemeDraft])

  const change = (next: ThemeFile): void => {
    setHistory((h) => [...h.slice(-49), draft])
    setDraft(next)
    setError(null)
  }
  const setColor = (k: ThemeColorName, v: string | undefined): void => {
    const colors = { ...draft.colors } as Record<string, string | undefined>
    if (v === undefined) delete colors[k]
    else colors[k] = v.toLowerCase()
    change({ ...draft, colors: colors as ThemeFile['colors'] })
  }
  const setStyle = (patch: Partial<ThemeStyle>): void =>
    change({ ...draft, style: { ...draft.style, ...patch } })

  const issues = useMemo(() => contrastIssues(draft), [draft])
  const changes = useMemo(() => {
    const b = fileOf(base, draft.name)
    const keys = new Set([...Object.keys(b.colors), ...Object.keys(draft.colors)])
    let n = 0
    for (const k of keys)
      if ((b.colors as Record<string, string>)[k] !== (draft.colors as Record<string, string>)[k])
        n++
    const sk = new Set([...Object.keys(b.style ?? {}), ...Object.keys(draft.style ?? {})])
    for (const k of sk)
      if (
        (b.style as Record<string, unknown> | undefined)?.[k] !==
        (draft.style as Record<string, unknown> | undefined)?.[k]
      )
        n++
    return n
  }, [base, draft])

  const st = draft.style ?? {}
  const colors = draft.colors as Partial<Record<ThemeColorName, string>>

  return (
    <section className="ted" aria-label="Theme editor">
      <div className="ted-hd">
        <label className="ted-start">
          <span>Start from</span>
          <Select
            label="Start from"
            value={base.id}
            onChange={(value) => {
              const t = themes.find((x) => x.id === value)
              if (!t) return
              setBase(t)
              change(fileOf(t, draft.name))
            }}
            options={themes.map((t) => ({ value: t.id, label: `${t.name} (${t.mode})` }))}
          />
        </label>
        <label className="ted-name">
          <span>Name</span>
          <input
            className="inpt"
            value={draft.name}
            maxLength={40}
            aria-label="Theme name"
            onChange={(e) => change({ ...draft, name: e.target.value })}
          />
        </label>
        <span className="ted-count">
          {changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'No changes yet'}
        </span>
      </div>

      {issues.length ? (
        <div className="ted-warn" role="status" aria-label="Contrast warnings">
          {issues.map((i) => (
            <div key={`${i.fg}-${i.bg}`} className="ted-issue">
              <span>
                <b>Hard to read:</b> {i.label} is {i.ratio} : 1 (needs {i.need} : 1).
              </span>
              <button className="btn sm" onClick={() => setColor(i.fg, i.fix)}>
                Use {i.fix}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ted-body">
        <div className="ted-colors">
          {COLOR_GROUPS.map((g) => (
            <fieldset key={g.title} className="ted-grp">
              <legend>{g.title}</legend>
              {g.keys.map(([k, label]) => {
                const v = colors[k]
                return (
                  <div key={k} className={`ted-c${v ? '' : ' auto'}`}>
                    <input
                      type="color"
                      aria-label={`${label} color`}
                      value={v ? v.slice(0, 7) : '#808080'}
                      onChange={(e) => setColor(k, `${e.target.value}${v?.slice(7) ?? ''}`)}
                    />
                    <span className="ted-cl">{label}</span>
                    <HexInput
                      label={label}
                      value={v ?? ''}
                      onValue={(x) => setColor(k, x || undefined)}
                      required={REQUIRED.has(k)}
                    />
                  </div>
                )
              })}
            </fieldset>
          ))}
        </div>

        <div className="ted-style">
          <fieldset className="ted-grp">
            <legend>Type</legend>
            <label className="ted-row">
              <span>Font</span>
              <Select
                label="Font"
                value={st.font ?? 'Geist'}
                onChange={(value) => setStyle({ font: value as ThemeStyle['font'] })}
                options={Object.keys(UI_FONTS).map((value) => ({ value, label: value }))}
              />
            </label>
            <label className="ted-row">
              <span>Code font</span>
              <Select
                label="Code font"
                value={st.monoFont ?? 'JetBrains Mono'}
                onChange={(value) => setStyle({ monoFont: value as ThemeStyle['monoFont'] })}
                options={Object.keys(MONO_FONTS).map((value) => ({ value, label: value }))}
              />
            </label>
            <label className="ted-row">
              <span>Chat text</span>
              <input
                type="range"
                aria-label="Chat text size"
                min={CHAT_TEXT_MIN}
                max={CHAT_TEXT_MAX}
                value={st.chatTextSize ?? 15}
                onChange={(e) => setStyle({ chatTextSize: Number(e.target.value) })}
              />
              <span className="mono">{st.chatTextSize ?? 14.5}px</span>
            </label>
          </fieldset>
          <fieldset className="ted-grp">
            <legend>Shape & depth</legend>
            <Seg
              label="Corners"
              options={Object.keys(THEME_RADIUS) as (keyof typeof THEME_RADIUS)[]}
              value={st.radius ?? 'medium'}
              onPick={(radius) => setStyle({ radius })}
            />
            <Seg
              label="Borders"
              options={Object.keys(THEME_BORDER) as (keyof typeof THEME_BORDER)[]}
              value={st.border ?? 'thin'}
              onPick={(border) => setStyle({ border })}
            />
            <Seg
              label="Depth"
              options={THEME_DEPTH}
              value={st.depth ?? 'soft'}
              onPick={(depth) => setStyle({ depth })}
            />
            <label className="ted-row">
              <input
                type="checkbox"
                checked={!!st.frameGradient}
                onChange={(e) => setStyle({ frameGradient: e.target.checked })}
              />
              <span>Accent glow on the window frame</span>
            </label>
          </fieldset>
          <fieldset className="ted-grp">
            <legend>Density</legend>
            <Seg
              label="Density"
              options={Object.keys(THEME_DENSITY) as (keyof typeof THEME_DENSITY)[]}
              value={st.density ?? 'comfortable'}
              onPick={(density) => setStyle({ density })}
            />
          </fieldset>
          <fieldset className="ted-grp">
            <legend>Motion</legend>
            <Seg
              label="Motion"
              options={THEME_MOTION}
              value={st.motion ?? 'on'}
              onPick={(motion) => setStyle({ motion })}
            />
            <p className="hint">Your system's reduce-motion setting always wins.</p>
          </fieldset>
        </div>
      </div>

      {error ? (
        <span className="hint warn" role="alert">
          {error}
        </span>
      ) : null}
      <div className="ted-ft">
        <button
          className="btn gh"
          disabled={!history.length}
          onClick={() => {
            setDraft(history.at(-1)!)
            setHistory((h) => h.slice(0, -1))
          }}
        >
          Undo
        </button>
        <button
          className="btn gh"
          disabled={!changes}
          onClick={() => change(fileOf(base, draft.name))}
        >
          Reset to {base.name}
        </button>
        <span className="ted-sp" />
        <button className="btn gh" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={() =>
            void api.themes.export(draft).then((r) => setError(r && !r.ok ? r.error : null))
          }
        >
          Export…
        </button>
        <button
          className="btn pri"
          disabled={!draft.name.trim()}
          onClick={() =>
            void saveThemeDraft().then((err) => {
              if (err) setError(err)
              else onClose()
            })
          }
        >
          Save as new theme
        </button>
      </div>
    </section>
  )
}

/** A hex field that only passes on valid colors (empty = leave it to the theme). */
function HexInput({
  label,
  value,
  required,
  onValue
}: {
  label: string
  value: string
  required: boolean
  onValue: (v: string) => void
}) {
  const [text, setText] = useState(value)
  // A new value from outside (undo, a fix, another base) replaces what was typed.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(value)
  }
  const bad = text !== '' && !HEX.test(text)
  return (
    <input
      className={`inpt mono ted-hex${bad ? ' bad' : ''}`}
      aria-label={`${label} hex`}
      placeholder={required ? '#000000' : 'auto'}
      value={text}
      spellCheck={false}
      onChange={(e) => {
        const v = e.target.value.trim()
        setText(v)
        if (HEX.test(v) || (v === '' && !required)) onValue(v)
      }}
    />
  )
}
