import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '@fontsource/geist/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './app/App'
import { ServicesProvider, type Services } from './app/services'
import { createAppStore } from './app/store'
import { PtyBus } from './lib/pty-bus'
import { RectRegistry } from './lib/scheduling'

// Composition root: the only place services are constructed.
const api = window.wraith
const bus = new PtyBus(api.pty)
const rects = new RectRegistry()
const store = createAppStore({ api, bus, rects })
const services: Services = { api, bus, rects, store }

// xterm measures glyphs when it opens, so the bundled fonts must be ready first.
const fontsReady = Promise.all(
  ['13px "JetBrains Mono"', 'bold 13px "JetBrains Mono"', '13px "Geist"'].map((f) =>
    document.fonts.load(f)
  )
).catch(() => undefined)

void Promise.all([fontsReady, store.getState().init()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <App />
      </ServicesProvider>
    </StrictMode>
  )
})
