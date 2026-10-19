// Switch the branch of a pane's folder: local branches newest first, remote ones not checked
// out yet (checked out as a tracking branch), or a new branch from what is checked out now.
// Type to filter, arrows and Enter. Every pane on the same folder sees the switch.
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
  at
}: {
  paneId: string
  at: { x: number; y: number } | null
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
  const ref = useRef<HTMLDivElement>(null)
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
      ...branches.local.map((b) => ({
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

  const pick = async (o: Option): Promise<void> => {
    if (busy) return
    if (o.current) return actions.closeModal()
    setBusy(true)
    setError(null)
    const err = await actions.switchBranch(paneId, o.kind, o.name)
    setBusy(false)
    if (err) setError(err)
    else actions.closeModal()
  }

  return createPortal(
    <>
      <div className="cm-scrim" onClick={() => actions.closeModal()} />
      <div
        ref={ref}
        className="cm bp"
        role="dialog"
        aria-label={`Switch branch of ${pane?.title ?? 'pane'}`}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            actions.closeModal()
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const o = options[active]
            if (o) void pick(o)
          }
        }}
      >
        <input
          className="inpt bp-in"
          autoFocus
          aria-label="Find or create a branch"
          placeholder="Find or create a branch…"
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
              onClick={() => void pick(o)}
            >
              <span className="cm-ic" aria-hidden="true">
                {o.kind === 'create' ? <IconPlus small /> : <IconBranch small />}
              </span>
              <span className="bp-name">
                {o.kind === 'create' ? `Create branch ${o.name}` : o.name}
              </span>
              <span className="bp-sub">{o.sub}</span>
            </button>
          ))}
        </div>
        {busy ? <div className="bp-note">Switching…</div> : null}
        {error ? (
          <div className="bp-note err" role="alert">
            {error}
          </div>
        ) : null}
        {sharing || running ? (
          <div className="bp-note">
            {[
              sharing
                ? `Also switches ${sharing} other pane${sharing === 1 ? '' : 's'} on this folder.`
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
