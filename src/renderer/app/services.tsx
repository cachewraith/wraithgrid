import { createContext, useContext, type ReactNode } from 'react'
import { useStore, type StoreApi } from 'zustand'
import type { WraithApi } from '@shared/ipc-contract'
import type { PtyBus } from '../lib/pty-bus'
import type { RectRegistry } from '../lib/scheduling'
import type { AppState } from './store'

/** Built once in main.tsx (the composition root) and handed down through context. */
export interface Services {
  api: WraithApi
  bus: PtyBus
  rects: RectRegistry
  store: StoreApi<AppState>
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({
  services,
  children
}: {
  services: Services
  children: ReactNode
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesProvider is missing')
  return s
}

/** Select from the app store. Return primitives or stable references (or wrap in useShallow). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useServices().store, selector)
}

/** Actions never change identity, so components can grab them without re-rendering. */
export function useActions(): AppState {
  return useServices().store.getState()
}
