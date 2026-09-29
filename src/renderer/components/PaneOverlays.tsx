import { useEffect, useRef } from 'react'
import type { ExitInfo } from '../app/store'
import { IconClose, IconError, IconRestart, IconWarn } from './icons'

const hhmm = (t: number): string => new Date(t).toTimeString().slice(0, 5)

/** Bottom bar shown when the process ended. The pane stays open (FR-P6). */
export function ExitedOverlay({
  exit,
  command,
  onRestart
}: {
  exit: ExitInfo
  command: string
  onRestart: () => void
}) {
  const headline = exit.spawnError
    ? `${command} could not start`
    : exit.signal
      ? `${command} was stopped by signal ${exit.signal}`
      : `${command} exited with code ${exit.code}`
  return (
    <div className="pexit" role="status">
      <IconError style={{ color: 'var(--err)' }} />
      <div title={exit.message ?? undefined}>
        <b>{headline}</b> · {hhmm(exit.at)}
        {exit.message ? (
          <>
            {' · '}
            <span className="mono">{exit.message}</span>
          </>
        ) : null}
      </div>
      <button className="btn pri" onClick={onRestart}>
        <IconRestart />
        Restart
      </button>
    </div>
  )
}

/** In-pane confirm; it never blocks the other panes (FR-P5). */
export function CloseConfirm({
  command,
  cwd,
  pid,
  onCancel,
  onConfirm
}: {
  command: string
  cwd: string
  pid: number | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div
      className="pscrim"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="pdlg" role="alertdialog" aria-label="Close pane">
        <h3>
          <IconWarn style={{ color: 'var(--warn)' }} />
          Process is still running
        </h3>
        <p>
          <code>{command}</code> is still running in <span className="mono">{cwd}</span>
          {pid ? ` (pid ${pid})` : ''}. Closing the pane ends the process. Unsaved work in this
          session stops.
        </p>
        <div className="acts">
          <button ref={cancelRef} className="btn gh" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn dng" onClick={onConfirm}>
            Close pane
          </button>
        </div>
      </div>
    </div>
  )
}

/** Amber banner on a claude pane whose account has not signed in yet. */
export function LoginBanner({
  accountName,
  configDir,
  started,
  onRunLogin,
  onMarkSignedIn,
  onHide
}: {
  accountName: string
  configDir: string
  started: boolean
  onRunLogin: () => void
  onMarkSignedIn: () => void
  onHide: () => void
}) {
  return (
    <div className="pbanner" role="status">
      <IconWarn style={{ color: 'var(--warn)', marginTop: 1 }} />
      <div>
        <b>
          {started ? 'Finish signing in in your browser' : `${accountName} is not signed in yet`}
        </b>
        {started
          ? 'This pane picks up the session when you are done. Other panes are not affected.'
          : `Run /login in this pane. Sign-in finishes in your browser and stays in ${configDir}.`}
      </div>
      <div className="acts">
        {started ? null : (
          <button className="btn pri" onClick={onRunLogin}>
            Run /login
          </button>
        )}
        <button className="btn gh" onClick={onMarkSignedIn}>
          Mark as signed in
        </button>
        <button className="icon-btn" aria-label="Hide banner" title="Hide banner" onClick={onHide}>
          <IconClose small />
        </button>
      </div>
    </div>
  )
}
