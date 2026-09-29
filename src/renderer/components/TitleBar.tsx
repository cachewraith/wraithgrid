import { useEffect } from 'react'
import { useApp, useServices } from '../app/services'
import { activeWorkspace } from '../app/store'
import { IconClose, IconMaximize, IconMinimize, Logo } from './icons'

export function TitleBar() {
  const { api } = useServices()
  const wsName = useApp((s) => activeWorkspace(s).name)
  const view = useApp((s) => s.view)
  // custom: our min/max/close. tiling (Hyprland, sway, …): the compositor owns size and
  // minimize, so only close. overlay (Windows): native caption buttons sit on top.
  const chrome = useApp((s) => s.info.chrome)
  const subtitle = view === 'settings' ? 'Settings' : view === 'accounts' ? 'Accounts' : wsName

  useEffect(() => {
    document.title = `Wraithgrid — ${subtitle}`
  }, [subtitle])

  return (
    <div
      className={`tb tb-${chrome}`}
      onDoubleClick={(e) =>
        chrome === 'custom' && e.target === e.currentTarget && api.window.maximize()
      }
    >
      <Logo />
      <span className="tb-name">Wraithgrid</span>
      <span className="tb-ws">— {subtitle}</span>
      {chrome === 'overlay' ? null : (
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
      )}
    </div>
  )
}
