/**
 * A name's first letter in a quiet circle, as Claude and Codex show who you are. Accounts use
 * it; projects and folders are plain text. No icons or emoji: saved ones are ignored.
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
