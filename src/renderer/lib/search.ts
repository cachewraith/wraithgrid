// Matching for the command palette, kept apart from the component so it is unit-testable.

/** Every word of the query must appear somewhere in the text, in any order, any case. */
export function matches(query: string, text: string): boolean {
  const hay = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}
