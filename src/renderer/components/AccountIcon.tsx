/**
 * A name's first letter in a quiet circle. AccountAvatar adds the CLI provider badge;
 * saved user-picked account icons and emoji stay ignored.
 */
export function Initial({ name, size = 20 }: { name: string; size?: number }) {
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?'
  return (
    <span
      className="initial"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }}
    >
      {letter}
    </span>
  )
}
