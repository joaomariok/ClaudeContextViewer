// Shared by the mod and the VS Code extension (extension/): plain TypeScript, no `claude-code` runtime import.

export type Row = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

// Mirrors types/index.d.ts, which must stay self-contained; tsc catches drift where register.tsx stores a View.
export type View = {
  model: string
  tokens: number
  window: number
  percent: number
  compactAt?: number
  rows: Row[]
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  usd?: number
}

// The mod's settings as resolved from /config, carried to the VS Code status bar so it follows them.
export type Settings = {
  legend: 'full' | 'tokens' | 'compact' | 'off'
  numbers: 'round' | 'precise'
  usage: string
  separator: string
  showBuffer: boolean
}

export const DEFAULT_SETTINGS: Settings = { legend: 'full', numbers: 'round', usage: 'both', separator: '•', showBuffer: true }

// What the mod writes to ~/.claude/context-viewer/<sessionId>.json for the VS Code status bar.
// `settings` is optional: snapshots from before it existed render with DEFAULT_SETTINGS.
// promptedAt: when the person last typed a prompt in the session, so the status bar can follow the one in use.
export type Snapshot = {
  version: 1
  sessionId: string
  cwd: string
  updatedAt: number
  promptedAt?: number
  view: View
  settings?: Settings
}

export const CLAUDE = '#D97757'

// The rows to draw: the buffer dropped when hidden, and one colour when there's no legend to tell colours apart.
export const shownRows = (rows: Row[], legend: Settings['legend'], showBuffer: boolean): Row[] => {
  const shown = showBuffer ? rows : rows.filter(row => row.kind !== 'buffer')

  return legend === 'off' ? shown.map(row => (row.kind === 'free' ? row : { ...row, color: CLAUDE })) : shown
}

// The bar as an SVG: a rounded translucent track (free space) with one segment per category, each at least a sliver.
export const barSvg = (rows: Row[], window: number) => {
  // Neighbours with the same fill merge into one run: anti-aliased edges between them show the track as seams.
  const runs: { x: number; w: number; color: string; translucent: boolean }[] = []
  let x = 0
  for (const row of rows) {
    if (row.kind === 'free' || row.tokens === 0) continue
    const w = Math.max(4, (row.tokens / window) * 1000)
    const translucent = row.kind === 'buffer'
    const last = runs[runs.length - 1]
    if (last && last.color === row.color && last.translucent === translucent) last.w += w
    else runs.push({ x, w, color: row.color, translucent })
    x += w
  }
  // An opaque run reaches one unit under the next opaque one, which covers the seam between different colours.
  const segments = runs.map((run, i) => {
    const overlap = !run.translucent && runs[i + 1]?.translucent === false ? 1 : 0

    return `<rect x="${run.x.toFixed(1)}" width="${(run.w + overlap).toFixed(1)}" height="8" fill="${run.color}"${run.translucent ? ' fill-opacity="0.5"' : ''}/>`
  })

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 8" width="100%" height="8" preserveAspectRatio="none">' +
    '<clipPath id="track"><rect width="1000" height="8" rx="4"/></clipPath>' +
    '<g clip-path="url(#track)"><rect width="1000" height="8" fill="#808080" fill-opacity="0.2"/>' +
    segments.join('') +
    '</g></svg>'
  )
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '')

// round: 4.2k, 76k, 1M. precise, as the Context usage dialog: 3.4k, 348.1k, 1.0M.
export const fmt = (n: number, precise = false) =>
  precise
    ? n < 1000 ? `${n}` : n < 999_950 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`
    : n < 1000 ? `${n}` : n < 10_000 ? `${trim(n / 1000)}k` : n < 999_500 ? `${Math.round(n / 1000)}k` : `${trim(n / 1e6)}M`

export const pct = (n: number, of: number, precise = false) => {
  const p = (n / of) * 100

  return !precise ? `${Math.round(p)}%` : p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`
}

const WINDOW: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// Time left until a window resets: 45m, 2h10m, 3d4h.
export const until = (resetsAt: string, now: number) => {
  const m = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60_000))

  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${m % 60}m` : `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
}

// The header's usage parts as [label, figure, tail], the figure drawn bold. Only the windows the engine reports:
// 5h/7d on a subscription, a spend limit through a gateway, none on an API key.
export const usageParts = (v: View, usage: string, precise: boolean, now: number): [string, string, string][] => [
  // `?? []`: a view stored by an older version of this mod, which had no limits, outlives a reload.
  ...(usage === 'both' || usage === 'limits'
    ? (v.limits ?? []).map((l): [string, string, string] => [
        `${WINDOW[l.kind] ?? l.kind} `,
        precise ? `${l.percentUsed.toFixed(1)}%` : `${Math.round(l.percentUsed)}%`,
        l.resetsAt === undefined ? '' : ` (${until(l.resetsAt, now)})`,
      ])
    : []),
  ...((usage === 'both' || usage === 'cost') && v.usd !== undefined
    ? [['spent ', `$${v.usd.toFixed(2)}`, ''] as [string, string, string]]
    : []),
]

export const label = (row: Row) => (row.kind === 'free' ? 'free' : row.name.toLowerCase())
