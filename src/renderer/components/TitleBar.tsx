import { useEffect, type MouseEvent } from 'react'
import { useApp, useServices } from '../app/services'
import { activeWorkspace } from '../app/store'
import { IconClose, IconMaximize, IconMinimize, Logo } from './icons'

/**
 * The top strip. On Windows (overlay) and macOS the OS draws its buttons in it, so it keeps
 * its height; elsewhere it is only a thin drag strip and our window buttons sit at the end of
 * the top row instead (#89).
 */
export function TitleBar() {
  const wsName = useApp((s) => activeWorkspace(s).name)
  const view = useApp((s) => s.view)
  // custom: our min/max/close. tiling (Hyprland, sway, …): the compositor owns size and
  // minimize, so only close. overlay (Windows) and mac: the OS draws its own buttons.
  const chrome = useApp((s) => s.info.chrome)
  const subtitle =
    view === 'settings'
      ? 'Settings'
      : view === 'accounts'
        ? 'Accounts'
        : view === 'mods'
          ? 'Mods'
          : view === 'usage'
            ? 'Usage'
            : view === 'scheduled'
              ? 'Scheduled'
              : wsName

  useEffect(() => {
    document.title = `Wraithgrid — ${subtitle}`
  }, [subtitle])

  if (chrome === 'custom' || chrome === 'tiling') return <div className="tb tb-slim" />
  return (
    <div className={`tb tb-${chrome}`}>
      <Logo />
      <span className="tb-name">Wraithgrid</span>
      <span className="tb-ws">— {subtitle}</span>
    </div>
  )
}

/** Our window buttons, at the end of the top row; nothing where the OS draws its own. */
export function WindowControls() {
  const { api } = useServices()
  const chrome = useApp((s) => s.info.chrome)
  if (chrome === 'overlay' || chrome === 'mac') return null
  return (
    <div className="wc">
      {chrome === 'custom' ? (
        <>
          <button aria-label="Minimize" title="Minimize" onClick={() => api.window.minimize()}>
            <IconMinimize />
          </button>
          <button aria-label="Maximize" title="Maximize" onClick={() => api.window.maximize()}>
            <IconMaximize />
          </button>
        </>
      ) : null}
      <button
        className="cl"
        aria-label="Close window"
        title="Close window"
        onClick={() => api.window.close()}
      >
        <IconClose />
      </button>
    </div>
  )
}

/** Double-click on the top row's empty space maximizes, as a title bar does (custom only). */
export function useTitleDoubleClick(): (e: MouseEvent<HTMLElement>) => void {
  const { api } = useServices()
  const chrome = useApp((s) => s.info.chrome)
  return (e) => {
    if (chrome === 'custom' && e.target === e.currentTarget) api.window.maximize()
  }
}
