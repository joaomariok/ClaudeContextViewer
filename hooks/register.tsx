import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row, View } from '../types'

const view = atom({ plugin: 'context-viewer', key: 'view' } as const, null)

// The engine's /context colours repeat a grey across categories; these stay apart on dark and light themes.
const PALETTE = ['#e5735a', '#4fa3e0', '#9b7fe6', '#5cc48a', '#e8c547', '#e078b8', '#4cc9c0', '#c9a07a']
const GREY = '#808080'
const CLAUDE = '#D97757'

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

const label = (row: Row) => (row.kind === 'free' ? 'free' : row.name.toLowerCase())

export const register: Register = (on, options) => {
  const legend =
    options.legend === 'tokens' || options.legend === 'compact' || options.legend === 'off' ? options.legend : 'full'
  const hideBelow = typeof options.hide_below_percent === 'number' ? options.hide_below_percent : 0
  const separator = typeof options.separator === 'string' ? options.separator : '•'
  const showBuffer = options.show_buffer !== false
  const precise = options.numbers === 'precise'
  const usage = typeof options.usage === 'string' ? options.usage : 'both'
  const join = separator === '' ? ' ' : ` ${separator} `

  on('session.measure', async ($, e, next) => {
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (b) {
      const window = e.context.window
      const tokens = e.context.tokens ?? b.totalTokens
      let used = 0
      const rows = b.categories.flatMap(({ name, tokens, kind }) =>
        kind === 'deferred'
          ? []
          : [{ name, tokens, kind, color: kind === 'used' ? PALETTE[used++ % PALETTE.length]! : GREY }],
      )
      const fresh: View = {
        model: b.model,
        tokens,
        window,
        percent: e.context.percent ?? Math.round((tokens / window) * 100),
        compactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
        rows,
        limits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
        usd: e.cost?.usd,
      }
      await update($, view, () => fresh)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v === null || v.percent < hideBelow) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    // Filtered here rather than when measured, so a /config change applies without waiting for the next turn.
    const shown = showBuffer ? v.rows : v.rows.filter(row => row.kind !== 'buffer')
    // With no legend to tell the colours apart, the bar is one colour.
    const rows = legend === 'off' ? shown.map(row => (row.kind === 'free' ? row : { ...row, color: CLAUDE })) : shown
    const width = Math.max(10, e.props.bodyColumns)
    // At least one cell for any non-empty category, so small ones (a 2.5k system prompt in a 1M window) still show.
    const cells = rows.map(row =>
      row.kind === 'free' || row.tokens === 0 ? 0 : Math.max(1, Math.round((row.tokens / v.window) * width)),
    )
    const used = cells.reduce((a, b) => a + b, 0)
    const free = Math.max(0, width - used)

    const extras = usageParts(v, usage, precise, await $.clock.now())

    // The desktop draws in a proportional font, where a bar of cells misjudges its width and wraps; draw it as a vector.
    let bar = undefined
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      bar = (
        <Svg
          source={barSvg(rows, v.window)}
          alt={rows.map(row => `${label(row)} ${fmt(row.tokens, precise)}`).join(', ')}
          height={8}
        />
      )
    }

    return (
      <Box flexDirection="column">
        {/* A rule like the prompt box's, so the band doesn't run into the transcript; the desktop frames the band itself. */}
        {e.surface === 'terminal' && <Text dimColor>{'─'.repeat(width)}</Text>}
        <Text>
          {/* Claude Code's own spinner starburst, in Claude's orange. */}
          <Text color={CLAUDE}>✻</Text>
          <Text bold> {v.model}</Text>
          <Text dimColor>{join}</Text>
          {/* Only separators are dim: dimmed figures were hard to read. */}
          <Text bold>{fmt(v.tokens, precise)}</Text>
          <Text> of {fmt(v.window, precise)} (</Text>
          <Text bold>{v.percent}%</Text>
          <Text>)</Text>
          {v.compactAt !== undefined && (
            <Text>
              <Text dimColor>{join}</Text>
              compacts at <Text bold>{fmt(v.compactAt, precise)}</Text>
            </Text>
          )}
          {extras.map(([label, figure, tail]) => (
            <Text>
              <Text dimColor>{join}</Text>
              {label}
              <Text bold>{figure}</Text>
              {tail}
            </Text>
          ))}
        </Text>
        {bar ?? (
          <Text>
            {rows.map((row, i) =>
              row.kind === 'free' ? (
                <Text dimColor>{'░'.repeat(free)}</Text>
              ) : (
                <Text color={row.color} dimColor={row.kind === 'buffer'}>
                  {'█'.repeat(cells[i] ?? 0)}
                </Text>
              ),
            )}
          </Text>
        )}
        {legend !== 'off' && (
          <Box flexWrap="wrap" columnGap={1}>
            {rows.map((row, i) => (
              <Text>
                <Text color={row.color}>■</Text> {label(row)}
                {legend !== 'compact' && <Text bold> {fmt(row.tokens, precise)}</Text>}
                {legend === 'full' &&<Text dimColor> {pct(row.tokens, v.window, precise)}</Text>}
                {separator !== '' && i < rows.length - 1 && <Text dimColor> {separator}</Text>}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
