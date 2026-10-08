import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { barSvg, CLAUDE, fmt, label, pct, shownRows, usageParts } from './format'
import type { Settings, Snapshot, View } from './format'

const view = atom({ plugin: 'context-viewer', key: 'view' } as const, null)
const promptedAt = atom({ plugin: 'context-viewer', key: 'promptedAt' } as const, null)

// The engine's /context colours repeat a grey across categories; these stay apart on dark and light themes.
const PALETTE = ['#e5735a', '#4fa3e0', '#9b7fe6', '#5cc48a', '#e8c547', '#e078b8', '#4cc9c0', '#c9a07a']
const GREY = '#808080'

// For the VS Code status bar (extension/): VS Code draws no mod UI, but these hooks still run there.
// ponytail: one file per session and none are deleted ($.fs has no delete); the extension skips stale ones.
async function writeSnapshot($: EngineInterface, v: View, settings: Settings) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) {
    return
  }
  const sessionId = await $.session.id()
  const snapshot: Snapshot = {
    version: 1,
    sessionId,
    cwd: await $.session.cwd(),
    updatedAt: await $.clock.now(),
    promptedAt: (await read($, promptedAt)) ?? undefined,
    view: v,
    settings,
  }
  await $.fs.write(`${home}/.claude/context-viewer/${sessionId}.json`, JSON.stringify(snapshot))
}

export const register: Register = (on, options) => {
  const legend: Settings['legend'] =
    options.legend === 'tokens' || options.legend === 'compact' || options.legend === 'off' ? options.legend : 'full'
  const hideBelow = typeof options.hide_below_percent === 'number' ? options.hide_below_percent : 0
  const separator = typeof options.separator === 'string' ? options.separator : '•'
  const showBuffer = options.show_buffer !== false
  const precise = options.numbers === 'precise'
  const usage = typeof options.usage === 'string' ? options.usage : 'both'
  const join = separator === '' ? ' ' : ` ${separator} `
  const settings: Settings = { legend, numbers: precise ? 'precise' : 'round', usage, separator, showBuffer }

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
      await writeSnapshot($, fresh, settings)
    }

    return next(e)
  })

  // A typed prompt marks this as the session in use (a continuation's text is empty).
  on('turn.start', async ($, e, next) => {
    if (e.text !== '') {
      const now = await $.clock.now()
      await update($, promptedAt, () => now)
      const v = await read($, view)
      if (v !== null) {
        await writeSnapshot($, v, settings)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v === null || v.percent < hideBelow) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    // Applied here rather than when measured, so a /config change shows without waiting for the next turn.
    const rows = shownRows(v.rows, legend, showBuffer)
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
