import type { MouseEvent } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import type { GitStatus } from '@shared/ipc-contract'
import { PANE_STATUS_LABEL, type PaneStatus, type PaneView } from '@shared/types'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { Initial } from './AccountIcon'
import {
  IconBranch,
  IconChat,
  IconClose,
  IconCompose,
  IconTerminal,
  IconUnzoom,
  IconZoom
} from './icons'

interface Props {
  title: string
  accountName: string | null
  cwdLabel: string
  status: PaneStatus
  zoomed: boolean
  git: GitStatus | undefined
  setDragHandle: (el: HTMLElement | null) => void
  dragListeners: DraggableSyntheticListeners
  onFocus: () => void
  onZoom: () => void
  onClose: () => void
  onDiff: () => void
  onMenu: (e: MouseEvent<HTMLElement>) => void
  /** Right-click on the branch chip: the branch picker. */
  onBranches: (e: MouseEvent<HTMLElement>) => void
  /** The Chat/Terminal switch; null when the pane can only be a terminal. */
  view: PaneView | null
  /** The chat's permission mode when it is not the default ("Plan", "Auto"…). */
  mode?: { id: string; label: string } | null
  onView: (view: PaneView) => void
  onNewChat: () => void
}

export function PaneHeader({ setDragHandle, dragListeners, ...p }: Props) {
  const zoomLabel = zoomed(p.zoomed)
  return (
    <div
      className="ph"
      ref={setDragHandle}
      {...dragListeners}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e)
      }}
    >
      <button
        className="ph-title"
        onClick={p.onFocus}
        title={`${p.title} — focus pane (${SHORTCUT_HINT.focus})`}
      >
        {p.title}
      </button>
      {p.accountName ? (
        <span className="chip" title={p.accountName}>
          <Initial name={p.accountName} size={16} />
          <span className="chip-nm">{p.accountName}</span>
        </span>
      ) : null}
      <span className="cwd" title={p.cwdLabel}>
        {p.cwdLabel}
      </span>
      {p.git?.repo ? (
        <button
          className={`gitc${p.git.changed ? ' dirty' : ''}`}
          title={`${p.git.branch ?? 'detached HEAD'}${p.git.changed ? ` · ${p.git.changed} changed` : ''}${p.git.ahead ? ` · ${p.git.ahead} ahead` : ''} — show changes (${SHORTCUT_HINT.diff}); right-click to switch branch`}
          aria-label={`Branch ${p.git.branch ?? 'detached'}, ${p.git.changed} changed files. Show changes`}
          onClick={p.onDiff}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            p.onBranches(e)
          }}
        >
          <IconBranch small />
          <span className="gitc-b">{p.git.branch ?? 'detached'}</span>
          {p.git.changed ? <span className="gitc-n">{p.git.changed}</span> : null}
        </button>
      ) : null}
      {p.view ? (
        <div className="vsw" role="group" aria-label="Show pane as">
          {(['chat', 'terminal'] as const).map((v) => (
            <button
              key={v}
              className={p.view === v ? 'on' : ''}
              aria-pressed={p.view === v}
              aria-label={v === 'chat' ? 'Chat' : 'Terminal'}
              title={v === 'chat' ? 'Chat view' : "Terminal view (the CLI's own screen)"}
              onClick={() => p.onView(v)}
            >
              {v === 'chat' ? <IconChat small /> : <IconTerminal small />}
            </button>
          ))}
        </div>
      ) : null}
      {p.view === 'chat' ? (
        <button
          className="icon-btn sm ph-new"
          aria-label="New conversation"
          title="New conversation"
          onClick={p.onNewChat}
        >
          <IconCompose small />
        </button>
      ) : null}
      {p.mode ? (
        <span className={`ph-mode mode-${p.mode.id}`} title={`Mode: ${p.mode.label}`}>
          {p.mode.label}
        </span>
      ) : null}
      <span className={`st st-${p.status}`} title={PANE_STATUS_LABEL[p.status]}>
        <span className="sd" />
        <span className="st-tx">{PANE_STATUS_LABEL[p.status]}</span>
      </span>
      <button className="icon-btn sm" aria-label={zoomLabel} title={zoomLabel} onClick={p.onZoom}>
        {p.zoomed ? <IconUnzoom small /> : <IconZoom small />}
      </button>
      <button
        className="icon-btn sm"
        aria-label={`Close pane (${SHORTCUT_HINT.closePane})`}
        title={`Close pane (${SHORTCUT_HINT.closePane})`}
        onClick={p.onClose}
      >
        <IconClose small />
      </button>
    </div>
  )
}

function zoomed(isZoomed: boolean): string {
  return isZoomed ? `Back to grid (${SHORTCUT_HINT.zoom})` : `Zoom pane (${SHORTCUT_HINT.zoom})`
}
