import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { AGENT_CLI_SPECS, type AgentCli } from '@shared/agent-clis'
import { IS_MAC, matchShortcut } from '../app/shortcuts'
import { useApp, useServices } from '../app/services'
import { drawnTheme } from '../app/store'
import { Osc99Reader, osc52Text, osc777Notice, osc9Notice, type TermNotice } from '../lib/term-osc'
import { terminalFontStack, terminalTheme } from '../lib/term-theme'

interface Props {
  paneId: string
  visible: boolean
  focused: boolean
  fontFamily: string
  fontSize: number
}

const RESIZE_DEBOUNCE_MS = 50

/**
 * One xterm instance bound to one pane process. It stays mounted while hidden (zoom,
 * other workspace, other view) so scrollback is never lost.
 */
export function Terminal({ paneId, visible, focused, fontFamily, fontSize }: Props) {
  const { bus, api, store } = useServices()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Cached by terminalTheme, so this is a stable reference between unrelated renders.
  const theme = useApp((s) => terminalTheme(s.config.settings.terminalPalette, drawnTheme(s)))
  const gpu = useApp((s) => s.config.settings.gpuTerminal)
  const canTakeFocus = useApp(
    (s) => s.view === 'grid' && s.modal === null && s.closingPaneId !== paneId
  )

  // Mount once per pane. Font and theme updates happen in the effects below.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const open = (uri: string): void => void api.shell.openExternal(uri)

    const term = new XTerm({
      scrollback: 5000,
      fontFamily: terminalFontStack(fontFamily),
      fontSize,
      lineHeight: 1.15,
      theme,
      cursorBlink: true,
      allowProposedApi: true, // unicode11
      drawBoldTextInBrightColors: false,
      rightClickSelectsWord: true,
      linkHandler: { activate: (_e, uri) => open(uri) } // OSC 8 hyperlinks
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new WebLinksAddon((_e, uri) => open(uri)))

    // What the pane's program asks of its terminal beyond drawing. claude sends these for a
    // mod's `$.ui.copy` (OSC 52) and `$.ui.notify` (OSC 9, 777 or 99, by the user's
    // preferredNotifChannel). A clipboard read (`52;c;?`) is never answered.
    const raise = (n: TermNotice | null): boolean => {
      if (n) store.getState().paneNotice(paneId, n.title, n.body)
      return true
    }
    const kitty = new Osc99Reader()
    term.parser.registerOscHandler(52, (data) => {
      const text = osc52Text(data)
      if (text) void navigator.clipboard.writeText(text).catch(() => undefined)
      return true
    })
    term.parser.registerOscHandler(9, (data) => raise(osc9Notice(data)))
    term.parser.registerOscHandler(777, (data) => raise(osc777Notice(data)))
    term.parser.registerOscHandler(99, (data) => raise(kitty.feed(data)))

    /** The pane's agent CLI, or null for a plain shell pane. */
    const paneCli = (): AgentCli | null => {
      const { config } = store.getState()
      const pane = config.workspaces.flatMap((w) => w.panes).find((p) => p.id === paneId)
      if (!pane || pane.shell) return null
      return config.accounts.find((a) => a.id === pane.accountId)?.cli ?? 'claude'
    }
    /** Pastes the clipboard's image as a file path; resolves false when there is none. */
    const pasteImage = async (): Promise<boolean> => {
      if (!paneCli()) return false
      const text = await api.clipboard.image(paneId)
      if (text) term.paste(text)
      return !!text
    }

    // App shortcuts never reach the process; everything else (Ctrl+C, arrows) does.
    term.attachCustomKeyEventHandler((e) => {
      if (matchShortcut(e)) return false
      // Shift+Enter sends the CLI's "new line" bytes (claude: ESC CR, what /terminal-setup
      // configures in other terminals). Plain Enter still submits; other panes are left alone.
      const cli = e.shiftKey && e.key === 'Enter' ? paneCli() : null
      const newLine = cli ? AGENT_CLI_SPECS[cli].newLine : null
      if (newLine && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.type === 'keydown') {
          e.preventDefault()
          bus.input(paneId, newLine)
        }
        return false
      }
      // Ctrl+Shift+C / V copy and paste on Linux and Windows. On macOS that is ⌘C / ⌘V,
      // done by the Edit menu (xterm handles the copy and paste events), and every Ctrl
      // chord goes to the process.
      if (IS_MAC) return true
      // Ctrl+V in an agent pane: an image on the clipboard (e.g. a screenshot) is saved and
      // pasted as a file path, since the CLI's own clipboard read misses some of them.
      // Without an image, Ctrl+V reaches the CLI as before.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyV' && paneCli()) {
        if (e.type === 'keydown') {
          e.preventDefault()
          void pasteImage().then((pasted) => {
            if (!pasted) bus.input(paneId, '\x16')
          })
        }
        return false
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyC') {
        if (e.type === 'keydown') {
          e.preventDefault()
          const sel = term.getSelection()
          if (sel) void navigator.clipboard.writeText(sel)
        }
        return false
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyV') {
        if (e.type === 'keydown') {
          e.preventDefault()
          void pasteImage().then(async (pasted) => {
            if (pasted) return
            const text = await navigator.clipboard.readText()
            if (text) term.paste(text)
          })
        }
        return false
      }
      return true
    })

    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const fitNow = (): boolean => {
      if (host.clientWidth < 20 || host.clientHeight < 20) return false
      try {
        fit.fit()
        return true
      } catch {
        return false
      }
    }

    if (fitNow()) bus.noteSize(paneId, term.cols, term.rows)
    const onInput = term.onData((data) => {
      bus.input(paneId, data)
      if (data.includes('\r')) store.getState().markConversation(paneId)
    })
    const detach = bus.attach(paneId, (data) => term.write(data))
    store.getState().requestStart(paneId)

    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (fitNow()) bus.resize(paneId, term.cols, term.rows)
      }, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(host)

    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
      detach()
      onInput.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Mount-only by design; the other props are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = terminalFontStack(fontFamily)
    term.options.fontSize = fontSize
    const host = hostRef.current
    if (host && host.clientWidth >= 20 && host.clientHeight >= 20) {
      try {
        fitRef.current?.fit()
        bus.resize(paneId, term.cols, term.rows)
      } catch {
        // Not laid out yet.
      }
    }
  }, [fontFamily, fontSize, bus, paneId])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme
  }, [theme])

  // GPU drawing keeps frame-rate redraws (a mod's animated band or pane) smooth. Only panes
  // on screen hold a WebGL context: Chromium allows about 16 and drops the oldest past that,
  // and a pane that loses its context falls back to the DOM renderer.
  useEffect(() => {
    const term = termRef.current
    if (!term || !gpu || !visible) return
    let addon: { dispose(): void } | null = null
    let gone = false
    // The two renderers size a cell differently, so the column count is fitted again.
    const refit = (): void => {
      if (termRef.current !== term) return
      try {
        fitRef.current?.fit()
        bus.resize(paneId, term.cols, term.rows)
      } catch {
        // Not laid out yet; the resize observer fits it later.
      }
    }
    const drop = (): void => {
      gone = true
      if (!addon) return
      addon.dispose()
      addon = null
      refit()
    }
    void import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        if (gone || termRef.current !== term) return
        const webgl = new WebglAddon()
        addon = webgl
        webgl.onContextLoss(drop)
        term.loadAddon(webgl)
        refit()
      })
      .catch(drop) // No WebGL on this machine: the DOM renderer stays.
    return drop
  }, [gpu, visible, paneId, bus])

  useEffect(() => {
    if (focused && visible && canTakeFocus) termRef.current?.focus()
  }, [focused, visible, canTakeFocus])

  return <div className="term-inner" ref={hostRef} />
}
