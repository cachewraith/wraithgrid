import { Component, memo, useCallback, useRef, useState, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { contractHome, expandHome } from '@shared/paths'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { DENSE_FONT_SIZE, PANE_STATUS_LABEL } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import {
  accountById,
  activeWorkspace,
  canChat,
  findPane,
  paneView,
  soloPaneId,
  type PreviewState
} from '../app/store'
import { paneIds } from '../layout/tree'
import type { Rect } from '../layout/focus'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { ChatView } from './chat/ChatView'
import { IconBranch, IconCheck, IconClose, IconCompose, IconRestart } from './icons'
import { PaneHeader } from './PaneHeader'
import { PreviewView } from './PreviewView'
import { CloseConfirm, ExitedOverlay, LoginBanner } from './PaneOverlays'
import { Terminal } from './Terminal'
import { utilityItems } from './TopBar'

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

/** A preview's header word (#74): its dev server, not an agent. */
const PREVIEW_WORD: Record<PreviewState['state'], { word: string; tone: string }> = {
  idle: { word: 'not started', tone: '' },
  starting: { word: 'starting', tone: '' },
  running: { word: 'running', tone: '' },
  stopped: { word: 'stopped', tone: ' warn' }
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
  const view = useApp((s) => paneView(s.config, paneId))
  const previewState = useApp((s) => s.previews[paneId]?.state)
  const chatable = useApp((s) => canChat(s.config, paneId))
  const solo = useApp((s) => soloPaneId(s) === paneId)
  const hiddenCount = useApp((s) => {
    const ws = activeWorkspace(s)
    return solo ? ws.panes.length - paneIds(ws.layout).length : 0
  })
  const actions = useActions()
  const [bannerHidden, setBannerHidden] = useState(false)
  const [menu, setMenu] = useState<MenuPoint | null>(null)

  const drop = useDroppable({ id: paneId, disabled: dragDisabled })
  const drag = useDraggable({ id: paneId, disabled: dragDisabled || solo })
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
  const cli = account?.cli ?? 'claude'
  const command = pane.shell ? 'shell' : AGENT_CLI_SPECS[cli].bin
  const canResume = !pane.shell && !!AGENT_CLI_SPECS[cli].resumeArgs
  const cwd = contractHome(expandHome(pane.cwd, home), home)
  const isChat = view === 'chat'
  const preview = view === 'preview' ? (previewState ?? 'idle') : null
  const loginNeeded = !isChat && !pane.shell && !!account && !account.signedIn && !exited
  const compact = !!rect && rect.width < 460

  const className = [
    'pane',
    focused && !!rect ? 'focused' : '',
    rect ? '' : 'hidden',
    drop.isOver && !drag.isDragging ? 'drop-target' : '',
    drag.isDragging ? 'dragging' : '',
    compact ? 'compact' : '',
    solo ? 'solo' : '',
    isChat ? 'is-chat' : ''
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
      <PaneHeader
        title={pane.title}
        cli={pane.shell ? null : cli}
        accountName={account?.name ?? null}
        status={status}
        stateWord={preview ? PREVIEW_WORD[preview] : undefined}
        zoomed={zoomed}
        git={git}
        solo={solo}
        hiddenCount={hiddenCount}
        setDragHandle={drag.setActivatorNodeRef}
        dragListeners={drag.listeners}
        onFocus={() => actions.focusPane(paneId)}
        onZoom={() => actions.toggleZoom(paneId)}
        onDiff={() => {
          actions.focusPane(paneId)
          actions.toggleDiff(true)
        }}
        onMenu={(e) => setMenu(menuPoint(e))}
        onBranches={(e) => actions.openModal({ kind: 'branches', paneId, at: menuPoint(e) })}
        view={chatable ? view : null}
      />
      {view === 'preview' ? (
        <div className="pv-host">
          <PaneErrorBoundary>
            <PreviewView paneId={paneId} />
          </PaneErrorBoundary>
        </div>
      ) : isChat ? (
        <div className={`chat-host${zoomed ? ' lg' : ''}`}>
          <PaneErrorBoundary>
            <ChatView paneId={paneId} visible={!!rect} focused={focused} />
          </PaneErrorBoundary>
        </div>
      ) : (
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
      )}
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
      {rt?.exit && !isChat ? (
        <ExitedOverlay
          exit={rt.exit}
          command={command}
          onRestart={() => actions.restartPane(paneId)}
        />
      ) : null}
      {menu ? (
        <ContextMenu
          at={menu}
          label={`Pane ${pane.title}`}
          onClose={() => setMenu(null)}
          items={[
            ...(isChat
              ? [
                  {
                    label: 'New conversation',
                    icon: <IconCompose small />,
                    onSelect: () => actions.chatNew(paneId)
                  }
                ]
              : []),
            ...(canResume && !isChat
              ? [
                  {
                    label: pane.resume
                      ? 'Continue conversation on restore: on'
                      : 'Continue conversation on restore: off',
                    icon: pane.resume ? <IconCheck small /> : undefined,
                    onSelect: () => actions.setPaneResume(paneId, !pane.resume)
                  }
                ]
              : []),
            ...(git?.repo
              ? [
                  {
                    label: 'Show changes',
                    kbd: SHORTCUT_HINT.diff,
                    onSelect: () => actions.toggleDiff(true)
                  },
                  {
                    label: 'Switch branch…',
                    icon: <IconBranch small />,
                    onSelect: () => actions.openModal({ kind: 'branches', paneId, at: menu })
                  }
                ]
              : []),
            {
              label: 'Restart',
              icon: <IconRestart small />,
              onSelect: () => actions.restartPane(paneId)
            },
            {
              label: 'Close pane',
              icon: <IconClose small />,
              danger: true,
              onSelect: () => actions.closePane(paneId)
            },
            // Alone, this ⋯ is the app's More menu too (#89).
            ...(solo ? utilityItems(actions).map((it, i) => ({ ...it, divider: i === 0 })) : [])
          ]}
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
