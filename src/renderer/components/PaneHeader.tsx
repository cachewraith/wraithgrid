import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import type { GitStatus } from '@shared/ipc-contract'
import { PANE_STATUS_LABEL, type PaneStatus } from '@shared/types'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { AccountIcon } from './AccountIcon'
import { IconBranch, IconClose, IconUnzoom, IconZoom } from './icons'

interface Props {
  title: string
  accountName: string | null
  accountColor: string | null
  accountIcon: string
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
}

export function PaneHeader({ setDragHandle, dragListeners, ...p }: Props) {
  const zoomLabel = zoomed(p.zoomed)
  return (
    <div className="ph" ref={setDragHandle} {...dragListeners}>
      <button
        className="ph-title"
        onClick={p.onFocus}
        title={`${p.title} — focus pane (${SHORTCUT_HINT.focus})`}
      >
        {p.title}
      </button>
      {p.accountName ? (
        <span className="chip">
          <AccountIcon
            account={{
              color: p.accountColor ?? 'var(--fa)',
              icon: p.accountIcon,
              name: p.accountName
            }}
            size={16}
          />
          {p.accountName}
        </span>
      ) : null}
      <span className="cwd" title={p.cwdLabel}>
        {p.cwdLabel}
      </span>
      {p.git?.repo ? (
        <button
          className={`gitc${p.git.changed ? ' dirty' : ''}`}
          title={`${p.git.branch ?? 'detached HEAD'}${p.git.changed ? ` · ${p.git.changed} changed` : ''}${p.git.ahead ? ` · ${p.git.ahead} ahead` : ''} — show changes (${SHORTCUT_HINT.diff})`}
          aria-label={`Branch ${p.git.branch ?? 'detached'}, ${p.git.changed} changed files. Show changes`}
          onClick={p.onDiff}
        >
          <IconBranch small />
          <span className="gitc-b">{p.git.branch ?? 'detached'}</span>
          {p.git.changed ? <span className="gitc-n">{p.git.changed}</span> : null}
        </button>
      ) : null}
      <span className={`st st-${p.status}`}>
        <span className="sd" />
        {PANE_STATUS_LABEL[p.status]}
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
