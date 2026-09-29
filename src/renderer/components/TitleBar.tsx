import { useEffect } from 'react'
import { useApp, useServices } from '../app/services'
import { activeWorkspace } from '../app/store'
import { IconClose, IconMaximize, IconMinimize, Logo } from './icons'

export function TitleBar() {
  const { api } = useServices()
  const wsName = useApp((s) => activeWorkspace(s).name)
  const view = useApp((s) => s.view)
  const subtitle = view === 'settings' ? 'Settings' : view === 'accounts' ? 'Accounts' : wsName

  useEffect(() => {
    document.title = `Wraithgrid — ${subtitle}`
  }, [subtitle])

  return (
    <div
      className="tb"
      onDoubleClick={(e) => e.target === e.currentTarget && api.window.maximize()}
    >
      <Logo />
      <span className="tb-name">Wraithgrid</span>
      <span className="tb-ws">— {subtitle}</span>
      <div className="wc">
        <button aria-label="Minimize" title="Minimize" onClick={() => api.window.minimize()}>
          <IconMinimize />
        </button>
        <button aria-label="Maximize" title="Maximize" onClick={() => api.window.maximize()}>
          <IconMaximize />
        </button>
        <button
          className="cl"
          aria-label="Close window"
          title="Close window"
          onClick={() => api.window.close()}
        >
          <IconClose />
        </button>
      </div>
    </div>
  )
}
