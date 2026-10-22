// A folder picker inside the app (New chat), instead of the system file chooser: a breadcrumb,
// the folders of the current one (filter as you type, or type/paste a path to jump), git
// repos marked, recent and pinned folders on top. Keyboard first: ↑/↓, Enter opens,
// Backspace goes up, Ctrl+Enter picks, Esc closes. Main lists and resolves; this only shows.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { FolderListResult } from '@shared/ipc-contract'
import { useServices } from '../app/services'
import { crumbs, joinPath, looksLikePath, splitFolder } from '../lib/folder-path'
import { IconBranch, IconFolder } from './icons'

interface Props {
  start: string
  recent: string[]
  pinned: string[]
  mac: boolean
  onPick: (path: string) => void
  onClose: () => void
  onTogglePin: (path: string) => void
  /** The system chooser, as a fallback. */
  onSystem: () => void
}

export function FolderPicker({
  start,
  recent,
  pinned,
  mac,
  onPick,
  onClose,
  onTogglePin,
  onSystem
}: Props) {
  const { api } = useServices()
  const [dir, setDir] = useState(start)
  const [list, setList] = useState<FolderListResult | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let live = true
    void api.fs.listFolder(dir).then((r) => {
      if (!live) return
      setList(r)
    })
    return () => {
      live = false
    }
  }, [api, dir])

  const go = (path: string): void => {
    setNote(null)
    setQuery('')
    setActive(0)
    setDir(path)
    inputRef.current?.focus()
  }

  const jump = looksLikePath(query)
  const items = useMemo(() => {
    if (!list?.ok || jump) return []
    const q = query.trim().toLowerCase()
    return list.entries.filter(
      (e) => (hidden || !e.hidden || q.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))
    )
  }, [list, query, jump, hidden])
  const at = Math.min(active, Math.max(0, items.length - 1))

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${at}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const pick = async (target: string): Promise<void> => {
    const r = await api.fs.listFolder(target)
    if (r.ok) onPick(r.path)
    else {
      // Show where it failed and why, not the typed path's hint.
      setQuery('')
      setNote(r.error)
      setDir(r.path)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    const mod = mac ? e.metaKey : e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault()
      void pick(jump ? query.trim() : (list?.path ?? dir))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (jump) go(query.trim())
      else if (items[at] && list?.ok) go(joinPath(list.path, items[at]!.name))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(at + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(at - 1, 0))
    } else if (e.key === 'Backspace' && query === '' && list?.parent) {
      e.preventDefault()
      go(list.parent)
    }
  }

  const here = list?.path ?? dir
  const isPinned = pinned.includes(here)
  const shortcuts = (q: string[]): string[] => q.filter((p) => p !== here).slice(0, 4)
  const top = query
    ? []
    : [
        ...shortcuts(pinned).map((p) => ({ p, kind: 'Pinned' })),
        ...shortcuts(recent.filter((r) => !pinned.includes(r))).map((p) => ({ p, kind: 'Recent' }))
      ]
  const modKey = mac ? '⌘' : 'Ctrl'

  return (
    <div className="fp" role="group" aria-label="Choose a folder">
      <nav className="fp-crumbs" aria-label="Path">
        {crumbs(here).map((c, i, all) => (
          <span key={c.path} className="fp-crumb">
            <button
              type="button"
              aria-current={i === all.length - 1 ? 'location' : undefined}
              onClick={() => go(c.path)}
            >
              {c.label}
            </button>
            {i < all.length - 1 ? <span className="fp-sep">/</span> : null}
          </span>
        ))}
        {list?.ok && list.branch ? (
          <span className="fp-branch" title={`git branch ${list.branch}`}>
            <IconBranch small />
            {list.branch}
          </span>
        ) : null}
      </nav>
      <div className="fp-bar">
        <input
          ref={inputRef}
          className="inpt"
          aria-label="Filter folders or type a path"
          placeholder="Filter, or type a path like ~/code"
          value={query}
          spellCheck={false}
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="fp-list"
          aria-activedescendant={items[at] ? `fp-o-${at}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setNote(null)
          }}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className={`btn sm${isPinned ? ' on' : ''}`}
          aria-pressed={isPinned}
          onClick={() => onTogglePin(here)}
          title={isPinned ? 'Unpin this folder' : 'Pin this folder to the top'}
        >
          {isPinned ? 'Pinned' : 'Pin'}
        </button>
        <label className="fp-hid">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hidden
        </label>
      </div>

      <div className="fp-body">
        {top.length ? (
          <div className="fp-quick" aria-label="Pinned and recent folders">
            {top.map(({ p, kind }) => {
              const { name, parent } = splitFolder(p)
              return (
                <button key={`${kind}${p}`} type="button" className="fp-q" onClick={() => go(p)}>
                  <span className="fp-q-k">{kind}</span>
                  <span className="fp-q-n">{name}</span>
                  <span className="fp-q-p">{parent}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        {jump ? (
          <div className="fp-note">
            Enter goes to <span className="mono">{query.trim()}</span>; {modKey}+Enter picks it.
          </div>
        ) : note || (list && !list.ok) ? (
          <div className="fp-note err" role="alert">
            {note ?? (list && !list.ok ? list.error : '')}
          </div>
        ) : !list ? (
          <div className="fp-note">Loading…</div>
        ) : items.length === 0 ? (
          <div className="fp-note">
            {query ? 'No folder matches.' : 'No folders here.'}{' '}
            {list.ok && !hidden && list.entries.some((e) => e.hidden) ? 'Hidden ones are off.' : ''}
          </div>
        ) : (
          <ul id="fp-list" ref={listRef} className="fp-list" role="listbox" aria-label="Folders">
            {items.map((e, i) => (
              <li
                key={e.name}
                id={`fp-o-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === at}
                className={`fp-it${i === at ? ' on' : ''}${e.hidden ? ' hid' : ''}`}
                onMouseMove={() => i !== at && setActive(i)}
                onClick={() => list.ok && go(joinPath(list.path, e.name))}
              >
                <IconFolder small />
                <span className="fp-nm">{e.name}</span>
                {e.git ? <span className="fp-git">git</span> : null}
              </li>
            ))}
          </ul>
        )}
        {list?.ok && list.truncated ? (
          <div className="fp-note">Only the first folders are listed; filter to find others.</div>
        ) : null}
      </div>

      <div className="fp-ft">
        <span className="fp-keys">
          <kbd>↑↓</kbd> move <kbd>Enter</kbd> open <kbd>⌫</kbd> up <kbd>{modKey}+Enter</kbd> pick{' '}
          <kbd>Esc</kbd> back
        </span>
        <span className="sp" />
        <button type="button" className="btn gh sm" onClick={() => void api.fs.reveal(here)}>
          Open in Files
        </button>
        <button type="button" className="btn gh sm" onClick={onSystem}>
          System dialog…
        </button>
        <button
          type="button"
          className="btn pri sm"
          disabled={!list?.ok}
          onClick={() => void pick(here)}
        >
          Use this folder
        </button>
      </div>
    </div>
  )
}
