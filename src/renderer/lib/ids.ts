/** Short random id that satisfies the config schema's id pattern. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
}
