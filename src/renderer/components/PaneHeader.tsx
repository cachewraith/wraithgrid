import type { MouseEvent } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import type { AgentCli } from '@shared/agent-clis'
import type { GitStatus } from '@shared/ipc-contract'
import { PANE_STATUS_LABEL, type PaneStatus, type PaneView } from '@shared/types'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { ProviderLogo } from './ProviderLogo'
import { useTitleDoubleClick, WindowControls } from './TitleBar'
import { HiddenChip, LayoutPresets, ProjectLink } from './TopBar'
import { UsageButton } from './UsageView'
import { IconBranch, IconMonitor, IconMore, IconUnzoom, IconZoom } from './icons'

interface Props {
  title: string
  /** The pane's CLI for its logo; null for a plain shell. */
  cli: AgentCli | null
  accountName: string | null
  status: PaneStatus
  /** A preview's server state (#74), in place of the agent's. */
  stateWord?: { word: string; tone: string }
  zoomed: boolean
  git: GitStatus | undefined
  /** The grid shows only this pane: the header is the app's top row (#89). */
  solo: boolean
  /** Panes left out of the layout (shown in the solo row). */
  hiddenCount: number
  setDragHandle: (el: HTMLElement | null) => void
  dragListeners: DraggableSyntheticListeners
  onFocus: () => void
  onZoom: () => void
  onDiff: () => void
  onMenu: (e: MouseEvent<HTMLElement>) => void
  /** Right-click on the branch chip: the branch picker. */
  onBranches: (e: MouseEvent<HTMLElement>) => void
  /** The Chat/Terminal switch; null when the pane can only be a terminal. */
  view: PaneView | null
}

/** The state as one quiet word (#75): `working` sweeps, `approve` is amber; no dots. */
function stateWord(s: PaneStatus): { word: string; tone: string } {
  switch (s) {
    case 'running':
      return { word: 'working', tone: ' working' }
    case 'background':
      return { word: 'background', tone: ' working' }
    case 'approval':
      return { word: 'approve', tone: ' warn' }
    case 'login':
      return { word: 'sign in', tone: ' warn' }
    case 'exited':
      return { word: 'exited', tone: ' warn' }
    default:
      return { word: PANE_STATUS_LABEL[s], tone: '' }
  }
}

/**
 * A pane's title row: logo, title, state word; its buttons show on hover or focus. Account,
 * folder, branch and mode are in and under the chat box, so only a terminal keeps its branch.
 * Alone on screen it is the app's top row too: project, layouts, usage, ⋯, window buttons.
 */
export function PaneHeader({ setDragHandle, dragListeners, ...p }: Props) {
  const zoomLabel = zoomed(p.zoomed)
  const st = p.stateWord ?? stateWord(p.status)
  const onDoubleClick = useTitleDoubleClick()
  return (
    <div
      className={`ph${p.solo ? ' solo' : ''}`}
      // Alone, the row is the window's drag area rather than a pane to drag.
      ref={p.solo ? undefined : setDragHandle}
      {...(p.solo ? {} : dragListeners)}
      onDoubleClick={p.solo ? onDoubleClick : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e)
      }}
    >
      {p.solo ? (
        <>
          <ProjectLink />
          <span className="ph-slash" aria-hidden="true">
            /
          </span>
        </>
      ) : null}
      {p.cli ? (
        <ProviderLogo cli={p.cli} fallbackName={p.accountName ?? undefined} size={13} />
      ) : (
        <IconMonitor small />
      )}
      <button
        className="ph-title"
        onClick={p.onFocus}
        title={`${p.title} — focus pane (${SHORTCUT_HINT.focus})`}
      >
        {p.title}
      </button>
      <span className={`st ph-st sch-st${st.tone}`} title={PANE_STATUS_LABEL[p.status]}>
        {st.word}
      </span>
      {p.solo && p.hiddenCount > 0 ? <HiddenChip count={p.hiddenCount} /> : null}
      {p.view !== 'chat' && p.git?.repo ? (
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
      <span className="ph-sp" />
      <div className="ph-tools">
        {p.solo ? (
          <>
            <LayoutPresets />
            <UsageButton />
          </>
        ) : null}
        <button className="icon-btn sm" aria-label={zoomLabel} title={zoomLabel} onClick={p.onZoom}>
          {p.zoomed ? <IconUnzoom small /> : <IconZoom small />}
        </button>
        <button
          className="icon-btn sm ph-more"
          aria-label={p.solo ? 'More' : `Pane actions: ${p.title}`}
          aria-haspopup="menu"
          title={p.solo ? 'Chat and app actions' : 'Pane actions'}
          onClick={p.onMenu}
        >
          <IconMore small />
        </button>
      </div>
      {p.solo ? <WindowControls /> : null}
    </div>
  )
}

function zoomed(isZoomed: boolean): string {
  return isZoomed ? `Back to grid (${SHORTCUT_HINT.zoom})` : `Zoom pane (${SHORTCUT_HINT.zoom})`
}
