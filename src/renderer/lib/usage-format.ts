// How usage numbers read: compact, never more precise than useful.

/** `$0.14`, `$12.40`, `$1.2K`; tiny amounts read `<$0.01`. */
export function fmtCost(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1000) return `$${usd.toFixed(2)}`
  return `$${(usd / 1000).toFixed(usd < 10_000 ? 1 : 0)}K`
}

/** `940`, `12.9K`, `1.2M`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/** Time until `at`: `2h 14m`, `42m 10s`, `3d 4h`; `now` once it has passed. */
export function fmtUntil(at: number, now: number): string {
  const s = Math.max(0, Math.round((at - now) / 1000))
  if (s === 0) return 'now'
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

export type Severity = 'ok' | 'warn' | 'err'

/** How full a limit is: under 70% fine, under 90% a warning, then serious. */
export function severity(utilization: number): Severity {
  return utilization >= 0.9 ? 'err' : utilization >= 0.7 ? 'warn' : 'ok'
}
