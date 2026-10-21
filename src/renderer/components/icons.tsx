// Stroke icons from the prototype. Decorative: buttons carry their own aria-label.
import type { CSSProperties } from 'react'

interface IconProps {
  small?: boolean
  style?: CSSProperties
  className?: string
}

function make(paths: React.ReactNode) {
  return function Icon({ small, style, className }: IconProps) {
    return (
      <svg
        className={`i${small ? ' s' : ''}${className ? ` ${className}` : ''}`}
        viewBox="0 0 16 16"
        aria-hidden="true"
        style={style}
      >
        {paths}
      </svg>
    )
  }
}

export const IconPlus = make(<path d="M8 3v10M3 8h10" />)
export const IconClose = make(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />)
export const IconMinimize = make(<path d="M4 8h8" />)
export const IconMaximize = make(<rect x="4" y="4" width="8" height="8" rx="1" />)
export const IconSidebar = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10" />
  </>
)
export const IconGrid4 = make(
  <>
    <rect x="2" y="2.5" width="5" height="5" rx="1" />
    <rect x="9" y="2.5" width="5" height="5" rx="1" />
    <rect x="2" y="9.5" width="5" height="5" rx="1" />
    <rect x="9" y="9.5" width="5" height="5" rx="1" />
  </>
)
export const IconUserPlus = make(
  <>
    <circle cx="7" cy="5.5" r="2.5" />
    <path d="M2.5 13c.6-2.4 2.3-3.5 4.5-3.5 1 0 1.9.2 2.6.7M12 9.5v4M10 11.5h4" />
  </>
)
export const IconUsers = make(
  <>
    <circle cx="6" cy="5.5" r="2.3" />
    <path d="M1.8 13c.4-2.3 2.1-3.6 4.2-3.6s3.8 1.3 4.2 3.6M10.5 3.4a2.2 2.2 0 0 1 0 4.2M12 9.6c1.3.5 2 1.6 2.2 3.4" />
  </>
)
export const IconMore = make(
  <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.4" strokeLinecap="round" />
)
export const IconGauge = make(
  <>
    <path d="M2.8 11.5a5.5 5.5 0 1 1 10.4 0" />
    <path d="M8 9.2l2.6-2.6" />
  </>
)
export const IconBack = make(<path d="M10 3.5L5.5 8l4.5 4.5" />)
export const IconPreset1 = make(<rect x="2" y="3" width="12" height="10" rx="1.5" />)
export const IconPreset2 = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M8 3v10" />
  </>
)
export const IconPreset4 = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M8 3v10M2 8h12" />
  </>
)
export const IconPreset3 = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10M10 3v10" />
  </>
)
export const IconZoom = make(<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />)
export const IconUnzoom = make(<path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3" />)
export const IconKeyboard = make(
  <>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 7h1M7 7h1M10 7h2M4.5 9.5h7" />
  </>
)
export const IconMods = make(<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />)
export const IconSettings = make(
  <>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    <circle cx="5.5" cy="4.5" r="1.5" fill="var(--bg)" />
    <circle cx="10.5" cy="8" r="1.5" fill="var(--bg)" />
    <circle cx="6.5" cy="11.5" r="1.5" fill="var(--bg)" />
  </>
)
export const IconWarn = make(<path d="M8 2.5l6 11H2zM8 7v3M8 11.8v.2" />)
export const IconError = make(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.5M8 10.8v.2" />
  </>
)
export const IconInfo = make(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.2v3.6M8 5.2v.1" />
  </>
)
export const IconRestart = make(<path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" />)
export const IconCheck = make(<path d="M3.5 8.5l3 3 6-7" />)
export const IconExport = make(<path d="M8 10.5v-8M5 5.5l3-3 3 3M3 13h10" />)
export const IconImport = make(<path d="M8 2.5v8M5 7.5l3 3 3-3M3 13h10" />)
export const IconFolder = make(
  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
)
export const IconLogin = make(<path d="M9 3h3.5v10H9M3 8h7M7.5 5.5L10 8l-2.5 2.5" />)
export const IconRename = make(<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />)
export const IconTrash = make(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />)
export const IconSearch = make(
  <>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.5 3.5" />
  </>
)
export const IconMonitor = make(
  <>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M6 13.5h4M8 11v2.5" />
  </>
)
export const IconMoon = make(<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />)
export const IconSun = make(
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </>
)

export function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" rx="2" fill="#7c5cff" />
      <rect
        x="10"
        y="1"
        width="7"
        height="7"
        rx="2"
        fill="none"
        stroke="var(--logo-line)"
        strokeWidth="1.5"
      />
      <rect
        x="1"
        y="10"
        width="7"
        height="7"
        rx="2"
        fill="none"
        stroke="var(--logo-line)"
        strokeWidth="1.5"
      />
      <rect
        x="10"
        y="10"
        width="7"
        height="7"
        rx="2"
        fill="none"
        stroke="var(--logo-line)"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export const IconBranch = make(
  <>
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <circle cx="11" cy="5" r="1.5" />
    <path d="M5 5v6M11 6.5c0 2.5-2 3.5-6 4" />
  </>
)
export const IconCompose = make(
  <>
    <path d="M13 9v3.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3H7" />
    <path d="M11.5 2.5l2 2L8 10H6V8z" />
  </>
)
export const IconDiff = make(
  <>
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" />
    <path d="M8 4v4M6 6h4M6 11h4" />
  </>
)
export const IconChevron = make(<path d="M6 4l4 4-4 4" />)

// Chat view (ADR 0002): tool kinds, the composer and the view switch.
export const IconTerminal = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 6.5l2 1.5-2 1.5M8.5 10H11" />
  </>
)
export const IconChat = make(
  <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5" />
)
export const IconFile = make(
  <>
    <path d="M4 2.5h5l3 3v8H4z" />
    <path d="M9 2.5v3h3" />
  </>
)
export const IconGlobe = make(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5z" />
  </>
)
export const IconSparkle = make(
  <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3zM12.5 11l.5 1.3 1.3.5-1.3.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
)
export const IconList = make(
  <path d="M6.5 4.5H13M6.5 8H13M6.5 11.5H13M3 4.5h.5M3 8h.5M3 11.5h.5" />
)
export const IconTool = make(
  <path d="M10.5 2.8a3 3 0 0 0-3.4 4L3 10.9 5.1 13l4.1-4.1a3 3 0 0 0 4-3.4l-1.8 1.8-1.7-.4-.4-1.7z" />
)
export const IconArrowUp = make(<path d="M8 13V3.5M4 7.5l4-4 4 4" />)
export const IconArrowDown = make(<path d="M8 3v9.5M4 8.5l4 4 4-4" />)
export const IconStop = make(<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />)
export const IconCopy = make(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </>
)
export const IconImage = make(
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="M13.5 10.5l-3-3-6 5.5" />
  </>
)
