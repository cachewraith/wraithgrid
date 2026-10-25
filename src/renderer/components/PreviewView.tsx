// Web preview (#74): the project's dev server and its page, in a pane. The page is a sandboxed
// <webview> in its own session; main only lets it load addresses on this computer.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  isLocalUrl,
  PREVIEW_PARTITION,
  PREVIEW_REPORT_MAX,
  previewReport,
  type PreviewRequestFailure
} from '@shared/preview'
import { freshPreview } from '../app/store'
import { useActions, useApp, useServices } from '../app/services'
import { IconBack, IconExport, IconList, IconPaperclip, IconRestart } from './icons'

/** The <webview> methods the toolbar uses. */
interface WebviewEl extends HTMLElement {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getWebContentsId(): number
}

export function PreviewView({ paneId }: { paneId: string }) {
  const actions = useActions()
  const { api } = useServices()
  // The project itself (a stable reference); findPane would build a new object each time.
  const ws = useApp((s) => s.config.workspaces.find((w) => w.panes.some((p) => p.id === paneId)))
  const pane = ws?.panes.find((p) => p.id === paneId)
  const pv = useApp((s) => s.previews[paneId]) ?? freshPreview()
  const saved = ws?.preview ?? { command: '', url: '' }
  const [editing, setEditing] = useState(false)
  const [showLog, setShowLog] = useState(false)

  // The pane counts as started (idle): its server is what runs, not an agent.
  useEffect(() => actions.requestStart(paneId), [actions, paneId])
  // A project that has its command starts straight away (also after a restart of the app).
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current || pv.state !== 'idle' || !saved.command) return
    auto.current = true
    void actions.previewStart(paneId)
  }, [actions, paneId, pv.state, saved.command])

  if (!ws || !pane) return null
  if (editing || (pv.state === 'idle' && !saved.command))
    return (
      <StartForm
        paneId={paneId}
        project={ws.name}
        cwd={pane.cwd}
        initial={saved}
        detect={() => api.preview.detect(paneId)}
        onStart={(command, url) => {
          setEditing(false)
          void actions.previewStart(paneId, command, url)
        }}
        onCancel={() => (saved.command ? setEditing(false) : actions.closePane(paneId, true))}
      />
    )

  const stopped = pv.state === 'stopped'
  return (
    <div className="pv">
      {stopped ? (
        <div className="pv-bar" role="status">
          <span>{pv.error ?? 'The dev server stopped.'}</span>
          {pv.exitCode !== null ? <span className="pv-code">exit {pv.exitCode}</span> : null}
          <span className="pv-sp" />
          <button className="btn gh" onClick={() => setEditing(true)}>
            Edit command
          </button>
          <button className="btn gh" onClick={() => setShowLog(!showLog)}>
            {showLog ? 'Hide log' : 'Show log'}
          </button>
          <button className="btn" onClick={() => void actions.previewStart(paneId)}>
            <IconRestart small /> Restart
          </button>
        </div>
      ) : null}
      {pv.url ? (
        <Page
          key={pv.url}
          paneId={paneId}
          url={pv.url}
          dim={stopped}
          showLog={showLog}
          onToggleLog={() => setShowLog(!showLog)}
          openExternal={(u) => void api.shell.openExternal(u)}
        />
      ) : (
        <div className="pv-wait">
          {stopped ? null : (
            <p>
              Starting <span className="mono">{saved.command}</span>… the page opens at the first
              local address it prints.
            </p>
          )}
        </div>
      )}
      {showLog || (!pv.url && pv.log.length) ? <Log lines={pv.log} /> : null}
    </div>
  )
}

function Page(p: {
  paneId: string
  url: string
  dim: boolean
  showLog: boolean
  onToggleLog: () => void
  openExternal: (url: string) => void
}) {
  const actions = useActions()
  const { api } = useServices()
  const ref = useRef<WebviewEl>(null)
  const [at, setAt] = useState(p.url)
  // What "Attach to chat" reports: console errors and failed requests since the page loaded.
  const [errors, setErrors] = useState<string[]>([])
  const [failed, setFailed] = useState<Omit<PreviewRequestFailure, 'webContentsId'>[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [text, setText] = useState(p.url)
  const [nav, setNav] = useState({ back: false, forward: false })

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const moved = (e: Event): void => {
      const url = (e as Event & { url?: string }).url ?? wv.getURL()
      setAt(url)
      setText(url)
      history()
    }
    // History is only final once loading stops, not at did-navigate.
    const history = (): void => setNav({ back: wv.canGoBack(), forward: wv.canGoForward() })
    // A new page (or a reload) starts a new report.
    const loading = (e: Event): void => {
      const d = e as Event & { isMainFrame?: boolean; isInPlace?: boolean }
      if (d.isMainFrame === false || d.isInPlace) return
      setErrors([])
      setFailed([])
    }
    // The level is a number (3 = error) on older Electron, a word on newer.
    const consoled = (e: Event): void => {
      const d = e as Event & {
        level?: number | string
        message?: string
        sourceId?: string
        line?: number
      }
      if (d.level !== 3 && d.level !== 'error') return
      const where = d.sourceId ? ` (${d.sourceId.split('/').pop()}:${d.line ?? 0})` : ''
      setErrors((cur) => [...cur, `${d.message ?? ''}${where}`].slice(-PREVIEW_REPORT_MAX))
    }
    wv.addEventListener('did-navigate', moved)
    wv.addEventListener('did-navigate-in-page', moved)
    wv.addEventListener('did-stop-loading', history)
    wv.addEventListener('did-start-navigation', loading)
    wv.addEventListener('console-message', consoled)
    const off = api.preview.onRequestFailed((f) => {
      let id: number
      try {
        id = wv.getWebContentsId()
      } catch {
        return // Not attached yet.
      }
      if (f.webContentsId !== id) return
      const { method, url, result } = f
      setFailed((cur) => [...cur, { method, url, result }].slice(-PREVIEW_REPORT_MAX))
    })
    return () => {
      off()
      wv.removeEventListener('did-navigate', moved)
      wv.removeEventListener('did-navigate-in-page', moved)
      wv.removeEventListener('did-stop-loading', history)
      wv.removeEventListener('did-start-navigation', loading)
      wv.removeEventListener('console-message', consoled)
    }
  }, [api])

  const attach = async (): Promise<void> => {
    const wv = ref.current
    if (!wv) return
    setAttachError(null)
    const shot = await api.preview.capture(wv.getWebContentsId())
    if (!shot.ok) return setAttachError(shot.error)
    const report = previewReport({
      url: at,
      size: { width: shot.width, height: shot.height },
      errors,
      failed
    })
    setAttachError(actions.previewAttach(p.paneId, { ...report, images: [shot.image] }))
  }
  const problems = errors.length + failed.length

  const go = (e: FormEvent): void => {
    e.preventDefault()
    const url = /^[a-z]+:\/\//i.test(text.trim()) ? text.trim() : `http://${text.trim()}`
    if (isLocalUrl(url)) void ref.current?.loadURL(url)
    else {
      p.openExternal(url)
      setText(at)
    }
  }

  return (
    <>
      <form className="pv-tb" onSubmit={go}>
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Back"
          title="Back"
          disabled={!nav.back}
          onClick={() => ref.current?.goBack()}
        >
          <IconBack small />
        </button>
        <button
          type="button"
          className="icon-btn sm pv-fwd"
          aria-label="Forward"
          title="Forward"
          disabled={!nav.forward}
          onClick={() => ref.current?.goForward()}
        >
          <IconBack small />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Reload"
          title="Reload"
          onClick={() => ref.current?.reload()}
        >
          <IconRestart small />
        </button>
        <input
          className="pv-url mono"
          aria-label="Address"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(at)}
        />
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Open in browser"
          title="Open in browser"
          onClick={() => p.openExternal(at)}
        >
          <IconExport small />
        </button>
        <button
          type="button"
          className={`btn gh pv-log-btn${p.showLog ? ' on' : ''}`}
          aria-pressed={p.showLog}
          onClick={p.onToggleLog}
        >
          <IconList small /> Log
        </button>
        <button
          type="button"
          className="btn gh"
          title={attachError ?? 'Screenshot, console errors and failed requests into the chat'}
          onClick={() => void attach()}
        >
          <IconPaperclip small /> Attach to chat
          {problems ? (
            <span className="pv-count mono" aria-label={`${problems} problems`}>
              {problems}
            </span>
          ) : null}
        </button>
      </form>
      {attachError ? (
        <div className="pv-bar" role="alert">
          <span>{attachError}</span>
        </div>
      ) : null}
      <webview
        ref={ref as React.Ref<HTMLWebViewElement>}
        className={`pv-web${p.dim ? ' dim' : ''}`}
        src={p.url}
        partition={PREVIEW_PARTITION}
      />
    </>
  )
}

function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [lines])
  return (
    <section className="pv-log" aria-label="Server log">
      <pre ref={ref} className="mono">
        {lines.join('\n') || 'No output yet.'}
      </pre>
    </section>
  )
}

function StartForm(p: {
  paneId: string
  project: string
  cwd: string
  initial: { command: string; url: string }
  detect: () => Promise<{ command: string; source: string } | null>
  onStart: (command: string, url: string) => void
  onCancel: () => void
}) {
  const [command, setCommand] = useState(p.initial.command)
  const [url, setUrl] = useState(p.initial.url)
  const [source, setSource] = useState<string | null>(null)
  const { detect } = p
  const asked = useRef(!!p.initial.command)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void detect().then((d) => {
      if (!d) return
      setCommand((c) => c || d.command)
      setSource(d.source)
    })
  }, [detect])
  const urlOk = !url.trim() || isLocalUrl(url.trim())

  return (
    <div className="pv-start">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (command.trim() && urlOk) p.onStart(command, url)
        }}
      >
        <h3>Run {p.project}'s dev server</h3>
        <p className="pv-note">
          Runs in <span className="mono">{p.cwd}</span>; stops when this pane closes.
        </p>
        <label className="team-f">
          <span>
            Command
            {source ? <span className="mono"> · from {source}</span> : null}
          </span>
          <input
            className="inpt"
            autoFocus
            spellCheck={false}
            value={command}
            placeholder="npm run dev"
            onChange={(e) => setCommand(e.target.value)}
          />
        </label>
        <label className="team-f">
          <span>
            Address <span className="mono">· read from the server's output when empty</span>
          </span>
          <input
            className="inpt"
            spellCheck={false}
            value={url}
            placeholder="http://localhost:…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        {!urlOk ? (
          <p className="pv-note warn">Only an address on this computer (localhost).</p>
        ) : null}
        <div className="pv-acts">
          <button type="submit" className="btn pri" disabled={!command.trim() || !urlOk}>
            Start
          </button>
          <button type="button" className="btn gh" onClick={p.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
