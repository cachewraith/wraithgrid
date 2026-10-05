import { Component, memo, useCallback, useRef, useState, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { contractHome, expandHome } from '@shared/paths'
import { DENSE_FONT_SIZE, PANE_STATUS_LABEL } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { accountById, findPane } from '../app/store'
import type { Rect } from '../layout/focus'
import { PaneHeader } from './PaneHeader'
import { CloseConfirm, ExitedOverlay, LoginBanner } from './PaneOverlays'
import { Terminal } from './Terminal'

interface Props {
  paneId: string
  /** Where to draw the pane, relative to the grid; null keeps it mounted but hidden. */
  rect: Rect | null
  dense: boolean
  zoomed: boolean
  dragDisabled: boolean
}

/** A pane crash stays inside the pane (NFR-5): the rest of the grid keeps rendering. */
class PaneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(err: unknown): void {
    console.error('[wraithgrid] pane crashed', err)
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="pane-crash">
        <div>
          This pane's view crashed. Other panes keep running.
          <br />
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => this.setState({ failed: false })}
          >
            Reload view
          </button>
        </div>
      </div>
    )
  }
}

export const Pane = memo(function Pane({ paneId, rect, dense, zoomed, dragDisabled }: Props) {
  const pane = useApp((s) => findPane(s.config, paneId)?.pane)
  const account = useApp((s) => accountById(s.config, pane?.accountId ?? null))
  const rt = useApp((s) => s.runtime[paneId])
  const focused = useApp((s) => s.focusedPaneId === paneId)
  const closing = useApp((s) => s.closingPaneId === paneId)
  const settings = useApp((s) => s.config.settings)
  const home = useApp((s) => s.info.homeDir)
  const git = useApp((s) => s.git[paneId])
  const actions = useActions()
  const [bannerHidden, setBannerHidden] = useState(false)

  const drop = useDroppable({ id: paneId, disabled: dragDisabled })
  const drag = useDraggable({ id: paneId, disabled: dragDisabled })
  const sectionRef = useRef<HTMLElement | null>(null)
  const { setNodeRef: setDropRef } = drop
  const { setNodeRef: setDragRef } = drag
  const setRefs = useCallback(
    (el: HTMLElement | null) => {
      sectionRef.current = el
      setDropRef(el)
      setDragRef(el)
    },
    [setDropRef, setDragRef]
  )
  // After a banner button, typing should go straight to the process.
  const focusTerminal = (): void => {
    sectionRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }

  if (!pane) return null
  const status = rt?.status ?? 'starting'
  const exited = !!rt?.exit
  const command = pane.shell ? 'shell' : 'claude'
  const cwd = contractHome(expandHome(pane.cwd, home), home)
  const loginNeeded = !pane.shell && !!account && !account.signedIn && !exited
  const compact = !!rect && rect.width < 460

  const className = [
    'pane',
    focused && !!rect ? 'focused' : '',
    rect ? '' : 'hidden',
    drop.isOver && !drag.isDragging ? 'drop-target' : '',
    drag.isDragging ? 'dragging' : '',
    compact ? 'compact' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      ref={setRefs}
      className={className}
      style={
        rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : undefined
      }
      aria-label={`${pane.title} pane, ${account ? `account ${account.name}` : 'plain shell'}, ${PANE_STATUS_LABEL[status]}`}
      aria-hidden={rect ? undefined : true}
      onMouseDownCapture={() => actions.focusPane(paneId)}
    >
      <div
        className={`strip${status === 'running' ? ' running' : ''}`}
        style={{ background: account?.color ?? 'var(--line2)' }}
      />
      <PaneHeader
        title={pane.title}
        accountName={account?.name ?? (pane.shell ? null : 'no account')}
        accountColor={account?.color ?? null}
        accountIcon={account?.icon ?? ''}
        cwdLabel={pane.shell ? `${cwd} · shell` : cwd}
        status={status}
        zoomed={zoomed}
        git={git}
        setDragHandle={drag.setActivatorNodeRef}
        dragListeners={drag.listeners}
        onFocus={() => actions.focusPane(paneId)}
        onZoom={() => actions.toggleZoom(paneId)}
        onClose={() => actions.closePane(paneId)}
        onDiff={() => {
          actions.focusPane(paneId)
          actions.toggleDiff(true)
        }}
      />
      <div
        className={`term-host${dense ? ' sm' : ''}${zoomed ? ' lg' : ''}${exited ? ' dim' : ''}`}
      >
        <PaneErrorBoundary>
          <Terminal
            paneId={paneId}
            visible={!!rect}
            focused={focused}
            fontFamily={settings.fontFamily}
            fontSize={dense ? Math.min(settings.fontSize, DENSE_FONT_SIZE) : settings.fontSize}
          />
        </PaneErrorBoundary>
      </div>
      {loginNeeded && account && !bannerHidden ? (
        <LoginBanner
          accountName={account.name}
          configDir={account.configDir}
          started={!!rt?.loginStarted}
          onRunLogin={() => {
            actions.runLogin(paneId)
            focusTerminal()
          }}
          onMarkSignedIn={() => actions.markSignedIn(account.id)}
          onHide={() => setBannerHidden(true)}
        />
      ) : null}
      {rt?.exit ? (
        <ExitedOverlay
          exit={rt.exit}
          command={command}
          onRestart={() => actions.restartPane(paneId)}
        />
      ) : null}
      {closing ? (
        <CloseConfirm
          command={command}
          cwd={cwd}
          pid={rt?.pid ?? null}
          onCancel={() => actions.cancelClose()}
          onConfirm={() => actions.closePane(paneId, true)}
        />
      ) : null}
    </section>
  )
})
