// Switch the branch of a pane's folder: local branches newest first, remote ones not checked
// out yet (checked out as a tracking branch), or a new branch from what is checked out now.
// Type to filter, arrows and Enter. Every pane on the same folder sees a switch, so with other
// panes there it asks first and offers a new pane on its own worktree instead (#162); `open`
// mode only does that: the branch opens in a new pane, this folder stays as it is.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranches } from '@shared/ipc-contract'
import { useActions, useApp, useServices } from '../app/services'
import { findPane } from '../app/store'
import { matches } from '../lib/search'
import { IconBranch, IconPlus } from './icons'

interface Option {
  kind: 'local' | 'remote' | 'create'
  name: string
  sub: string
  current?: boolean
}

const EDGE = 8
/** Same rule as main's BRANCH_PATTERN, for the "Create branch" row only. */
const NEW_BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}(?<![./])$/

export function BranchPicker({
  paneId,
  at,
  mode = 'switch'
}: {
  paneId: string
  at: { x: number; y: number } | null
  mode?: 'switch' | 'open'
}) {
  const { api } = useServices()
  const actions = useActions()
  const config = useApp((s) => s.config)
  const running = useApp((s) => s.runtime[paneId]?.status === 'running')
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /** Picked while other panes share the folder: switch them all, or a new pane instead. */
  const [confirm, setConfirm] = useState<Option | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const pane = findPane(config, paneId)?.pane
  // Panes elsewhere on the same folder switch with it; say so before it happens.
  const sharing = pane
    ? config.workspaces.flatMap((w) => w.panes).filter((p) => p.id !== paneId && p.cwd === pane.cwd)
        .length
    : 0

  useEffect(() => {
    let live = true
    void api.git.branches(paneId).then((r) => {
      if (!live) return
      if (r.ok) setBranches(r)
      else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [api, paneId])

  const options = ((): Option[] => {
    if (!branches) return []
    const q = query.trim()
    const all: Option[] = [
      // The checked-out branch can't be opened again in another folder.
      ...branches.local
        .filter((b) => mode === 'switch' || b.name !== branches.current)
        .map((b) => ({
          kind: 'local' as const,
          name: b.name,
          sub: [b.name === branches.current ? 'current' : null, b.when].filter(Boolean).join(' · '),
          current: b.name === branches.current
        })),
      ...branches.remote.map((b) => ({
        kind: 'remote' as const,
        name: b.name,
        sub: `remote · ${b.when}`
      }))
    ].filter((o) => !q || matches(q, o.name))
    const exists = branches.local.some((b) => b.name === q)
    if (q && !exists && NEW_BRANCH.test(q))
      all.push({ kind: 'create', name: q, sub: `new, from ${branches.current ?? 'HEAD'}` })
    return all
  })()

  // Open at the pointer, kept inside the window; centred near the top from the palette.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width } = el.getBoundingClientRect()
    if (!at) return setPos({ left: (window.innerWidth - width) / 2, top: 80 })
    setPos({
      left: Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(at.y, window.innerHeight - 360 - EDGE))
    })
  }, [at])

  const act = async (o: Option, how: 'switch' | 'open'): Promise<void> => {
    setConfirm(null)
    setBusy(true)
    setError(null)
    const err =
      how === 'open'
        ? await actions.openBranchPane(paneId, o.kind === 'create' ? 'new' : o.kind, o.name)
        : await actions.switchBranch(paneId, o.kind, o.name)
    setBusy(false)
    if (err) {
      setError(err)
      // The busy list let go of the focus: back to the box, so Esc and typing still work.
      inputRef.current?.focus()
    }
    // A new pane closes the picker itself (it takes the focus and closes any modal).
    else if (how === 'switch') actions.closeModal()
  }
  const pick = (o: Option): void => {
    if (busy) return
    if (mode === 'open') return void act(o, 'open')
    if (o.current) return actions.closeModal()
    // Other panes on this folder would move too: ask (#162).
    if (sharing) {
      setError(null)
      setConfirm(o)
      return
    }
    void act(o, 'switch')
  }
  useEffect(() => {
    if (confirm) openRef.current?.focus()
  }, [confirm])

  return createPortal(
    <>
      <div className="cm-scrim" onClick={() => actions.closeModal()} />
      <div
        ref={ref}
        className="cm bp"
        role="dialog"
        aria-label={
          mode === 'open'
            ? `Open a branch of ${pane?.title ?? 'pane'} in a new pane`
            : `Switch branch of ${pane?.title ?? 'pane'}`
        }
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            if (confirm) setConfirm(null)
            else actions.closeModal()
          } else if (confirm) {
            // Its buttons take Enter and Tab themselves.
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const o = options[active]
            if (o) pick(o)
          }
        }}
      >
        <input
          ref={inputRef}
          className="inpt bp-in"
          autoFocus
          aria-label="Find or create a branch"
          placeholder={
            mode === 'open' ? 'Branch to open in a new pane…' : 'Find or create a branch…'
          }
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
        />
        <div className="bp-list" role="listbox" aria-label="Branches">
          {!branches && !error ? <div className="bp-note">Reading branches…</div> : null}
          {branches && !options.length ? <div className="bp-note">No branch matches.</div> : null}
          {options.map((o, i) => (
            <button
              key={`${o.kind}:${o.name}`}
              role="option"
              aria-selected={i === active}
              className={`cm-it bp-it${i === active ? ' on' : ''}`}
              disabled={busy}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              <span className="cm-ic" aria-hidden="true">
                {o.kind === 'create' ? <IconPlus small /> : <IconBranch small />}
              </span>
              <span className="bp-name">
                {o.kind === 'create'
                  ? `${mode === 'open' ? 'New branch' : 'Create branch'} ${o.name}`
                  : o.name}
              </span>
              <span className="bp-sub">{o.sub}</span>
            </button>
          ))}
        </div>
        {confirm ? (
          <div className="bp-ask" role="alert">
            <span>
              {sharing} other pane{sharing === 1 ? '' : 's'} use{sharing === 1 ? 's' : ''} this
              folder. Switching to {confirm.name} moves {sharing === 1 ? 'it' : 'them'} too.
            </span>
            <div className="bp-ask-b">
              <button className="btn gh sm" onClick={() => void act(confirm, 'switch')}>
                Switch all {sharing + 1}
              </button>
              <button
                ref={openRef}
                className="btn pri sm"
                onClick={() => void act(confirm, 'open')}
              >
                Open in a new pane
              </button>
            </div>
          </div>
        ) : null}
        {busy ? (
          <div className="bp-note">{mode === 'open' ? 'Creating worktree…' : 'Working…'}</div>
        ) : null}
        {error ? (
          <div className="bp-note err" role="alert">
            {error}
          </div>
        ) : null}
        {mode === 'open' ? (
          <div className="bp-note">
            Opens in a new pane with its own folder (a git worktree); this one stays on{' '}
            {branches?.current ?? 'its branch'}.
          </div>
        ) : !confirm && (sharing || running) ? (
          <div className="bp-note">
            {[
              sharing
                ? `${sharing} other pane${sharing === 1 ? '' : 's'} on this folder: you can open the branch in a new pane instead.`
                : null,
              running ? 'This pane’s agent is working: its files change under it.' : null
            ]
              .filter(Boolean)
              .join(' ')}
          </div>
        ) : null}
      </div>
    </>,
    document.body
  )
}
