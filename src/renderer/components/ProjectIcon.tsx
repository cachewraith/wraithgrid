import { DEFAULT_PROJECT_ICON, projectIconSvg, useIconSets } from '../lib/project-icons'

/**
 * A project's icon (#80) in its own colours; the folder icon when it has none or an unknown
 * one. The SVG comes from the bundled icon sets only (see lib/project-icons).
 */
export function ProjectIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  useIconSets()
  const svg = projectIconSvg(icon || DEFAULT_PROJECT_ICON) ?? projectIconSvg(DEFAULT_PROJECT_ICON)
  if (!svg) return <span className="pj-icon" style={{ width: size, height: size }} />
  return (
    <svg
      className="pj-icon"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${svg.width} ${svg.height}`}
      // Bodies are from the bundled icon packages, never from config or the network.
      dangerouslySetInnerHTML={{ __html: svg.body }}
    />
  )
}
