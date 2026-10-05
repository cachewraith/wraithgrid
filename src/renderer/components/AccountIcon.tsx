import { parseIcon } from '@shared/icons'
import type { Account } from '@shared/types'
import { iconBody } from '../lib/icon-search'
import { useIconSets } from '../lib/icon-sets'

/**
 * A square badge on a tint of `color`: a Material or Lucide icon, an emoji, or the name's
 * first letter. Accounts, workspaces and folders use it so every row lines up the same way.
 */
export function Avatar({
  icon,
  name,
  color,
  size = 18
}: {
  icon: string
  name: string
  color: string
  size?: number
}) {
  const parsed = parseIcon(icon)
  const sets = useIconSets(parsed.kind === 'glyph')
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?'
  // Bodies come from the bundled sets only, looked up by a validated name.
  const body = parsed.kind === 'glyph' && sets ? iconBody(sets, parsed.set, parsed.name) : null
  const style = {
    width: size,
    height: size,
    background: `color-mix(in srgb, ${color} 22%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`
  }

  if (body) {
    const px = Math.round(size * 0.72)
    return (
      <span className="avatar glyph" aria-hidden="true" style={{ ...style, color }}>
        <svg
          viewBox="0 0 24 24"
          width={px}
          height={px}
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </span>
    )
  }
  const emoji = parsed.kind === 'emoji' ? parsed.text : null
  return (
    <span
      className={`avatar${emoji ? '' : ' letter'}`}
      aria-hidden="true"
      style={{
        ...style,
        fontSize: Math.round(size * (emoji ? 0.66 : 0.56)),
        color: emoji ? undefined : color
      }}
    >
      {emoji ?? letter}
    </span>
  )
}

export function AccountIcon({
  account,
  size
}: {
  account: Pick<Account, 'color' | 'icon' | 'name'>
  size?: number
}) {
  return <Avatar icon={account.icon} name={account.name} color={account.color} size={size} />
}
