import type { Account } from '@shared/types'

/**
 * A square badge on a tint of `color`: the emoji when one is set, else the name's first
 * letter. Accounts and workspaces use it so every row lines up the same way.
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
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?'
  return (
    <span
      className={`avatar${icon ? '' : ' letter'}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (icon ? 0.66 : 0.56)),
        color: icon ? undefined : color,
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`
      }}
    >
      {icon || letter}
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
