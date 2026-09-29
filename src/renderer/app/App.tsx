import { useEffect, useRef } from 'react'
import { AccountsView, RemoveAccountDialog } from '../components/AccountsView'
import { NewPaneDialog } from '../components/NewPaneDialog'
import { PaneGrid } from '../components/PaneGrid'
import { SettingsView } from '../components/SettingsView'
import { ShortcutsSheet } from '../components/ShortcutsSheet'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { TitleBar } from '../components/TitleBar'
import { TopBar } from '../components/TopBar'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'
import { useApp, useServices } from './services'
import { matchShortcut } from './shortcuts'
import { paneIds } from '../layout/tree'
import { DENSE_PANE_COUNT, activeWorkspace } from './store'

/** App shortcuts, caught in the capture phase so a focused terminal never sees them. */
function useGlobalShortcuts(): void {
  const { store } = useServices()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = matchShortcut(e)
      if (!action) return
      const s = store.getState()
      // Dialogs own the keyboard, except that the sheet shortcut toggles the sheet.
      if (s.modal && !(action.type === 'shortcuts' && s.modal.kind === 'shortcuts')) return
      e.preventDefault()
      e.stopPropagation()
      switch (action.type) {
        case 'newPane':
          s.openModal({ kind: 'newPane', slotId: null })
          break
        case 'closePane':
          if (s.view === 'grid' && s.focusedPaneId) s.closePane(s.focusedPaneId)
          break
        case 'toggleZoom':
          s.toggleZoom()
          break
        case 'focus':
          if (s.view === 'grid') s.focusDirection(action.dir)
          break
        case 'workspace':
          s.switchWorkspaceIndex(action.index)
          break
        case 'shortcuts':
          if (s.modal) s.closeModal()
          else s.openModal({ kind: 'shortcuts' })
          break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [store])
}

/** Many panes: the sidebar folds away once when the grid gets dense (8-pane density). */
function useDenseSidebar(): void {
  const { store } = useServices()
  const dense = useApp((s) => paneIds(activeWorkspace(s).layout).length >= DENSE_PANE_COUNT)
  const wasDense = useRef(dense)
  useEffect(() => {
    if (dense && !wasDense.current && !store.getState().config.settings.sidebarCollapsed) {
      store.getState().updateSettings({ sidebarCollapsed: true })
    }
    wasDense.current = dense
  }, [dense, store])
}

function Modals() {
  const modal = useApp((s) => s.modal)
  if (!modal) return null
  switch (modal.kind) {
    case 'newPane':
      return <NewPaneDialog slotId={modal.slotId} />
    case 'shortcuts':
      return <ShortcutsSheet />
    case 'workspaces':
      return <WorkspaceSwitcher />
    case 'removeAccount':
      return <RemoveAccountDialog accountId={modal.accountId} />
  }
}

export function App() {
  const ready = useApp((s) => s.ready)
  const theme = useApp((s) => s.config.settings.theme)
  const view = useApp((s) => s.view)
  useGlobalShortcuts()
  useDenseSidebar()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  if (!ready) return <div className="app" />
  return (
    <div className="app">
      <TitleBar />
      <div className="row">
        <Sidebar />
        <main className="main">
          <TopBar />
          <div className="content">
            <PaneGrid />
            {view === 'accounts' ? <AccountsView /> : null}
            {view === 'settings' ? <SettingsView /> : null}
          </div>
        </main>
      </div>
      <StatusBar />
      <Modals />
    </div>
  )
}
