import { useEffect, useRef } from 'react'
import { AccountsView, RemoveAccountDialog } from '../components/AccountsView'
import { CommandPalette } from '../components/CommandPalette'
import { DiffPanel } from '../components/DiffPanel'
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
import { terminalTheme } from '../lib/term-theme'
import { DENSE_PANE_COUNT, activeWorkspace, currentTheme } from './store'
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN } from '@shared/types'

/** App shortcuts, caught in the capture phase so a focused terminal never sees them. */
function useGlobalShortcuts(): void {
  const { store } = useServices()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = matchShortcut(e)
      if (!action) return
      const s = store.getState()
      // Dialogs own the keyboard, except that a sheet's own shortcut toggles it.
      const toggles =
        (action.type === 'shortcuts' && s.modal?.kind === 'shortcuts') ||
        (action.type === 'palette' && s.modal?.kind === 'palette')
      if (s.modal && !toggles) return
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
        case 'palette':
          if (s.modal) s.closeModal()
          else s.openModal({ kind: 'palette' })
          break
        case 'diff':
          s.toggleDiff()
          break
        case 'fontSize': {
          const size = s.config.settings.fontSize
          s.updateSettings({
            fontSize:
              action.delta === 0
                ? FONT_SIZE_DEFAULT
                : Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size + action.delta))
          })
          break
        }
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

/** Theme, accent and terminal palette, applied to the document as tokens. */
function useAppearance(): void {
  const { store } = useServices()
  const theme = useApp(currentTheme)
  const accent = useApp((s) => s.config.settings.accent)
  const palette = useApp((s) => s.config.settings.terminalPalette)

  // Tracked always, so switching to `system` is instant.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => store.getState().setSystemTheme(mq.matches ? 'dark' : 'light')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [store])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.accent = accent
    // A fixed terminal palette also colors the pane around the terminal.
    if (palette === 'match') root.style.removeProperty('--term-bg')
    else root.style.setProperty('--term-bg', terminalTheme(palette, theme, accent).background!)
  }, [theme, accent, palette])
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
    case 'palette':
      return <CommandPalette />
  }
}

export function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const diffOpen = useApp((s) => s.diffOpen && s.view === 'grid')
  useGlobalShortcuts()
  useDenseSidebar()
  useAppearance()

  if (!ready) return <div className="app" />
  return (
    <div className="app">
      <TitleBar />
      <div className="row">
        <Sidebar />
        <main className="main">
          <TopBar />
          <div className="work">
            <div className="content">
              <PaneGrid />
              {view === 'accounts' ? <AccountsView /> : null}
              {view === 'settings' ? <SettingsView /> : null}
            </div>
            {diffOpen ? <DiffPanel /> : null}
          </div>
        </main>
      </div>
      <StatusBar />
      <Modals />
    </div>
  )
}
