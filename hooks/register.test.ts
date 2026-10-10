import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { parseOffset, usageParts } from './format'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const PLAN = [
  { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-08T14:10:00Z' },
  { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-11T16:00:00Z' },
]

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({
  name,
  tokens,
  color: 'permission',
  isDeferred: kind === 'deferred',
  kind,
})

const SURFACES = ['terminal', 'desktop'] as const

// Stands in for the engine beneath the plugin: its own band, the usage breakdown, and one measurement.
// `env` is the host's environment; `canRun: false` refuses every command, as outside the CLI.
const engine = (on: On, { env = {}, canRun = true }: { env?: Record<string, string>; canRun?: boolean } = {}) => {
  mock.clock(on, { now: NOW })
  mock.env(on, env)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // The OS asked for its UTC offset, as `date +%z` or PowerShell prints it; two zones so a test tells them apart.
  on('process.run', (_, e) => {
    if (!canRun) throw new Error('no process access')

    return {
      value: {
        exitCode: 0,
        stdout: e.argv[0] === 'date' ? '+0100\n' : '+02:00\r\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: 'engine band' })
  })
  on('session.usage', () => ({ value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      tokens: 90_000,
      window: 1_000_000,
      percent: 9,
      breakdown: {
        categories: [
          row('System prompt', 4200),
          row('System tools', 17_000),
          row('MCP server instructions', 731),
          row('Deferred MCP tools', 30_000, 'deferred'),
          row('Autocompact buffer', 33_000, 'buffer'),
          row('Free space', 897_000, 'free'),
        ],
        totalTokens: 90_000,
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        autocompactSource: 'model-default',
        percentage: 9,
        gridRows: [],
        model: 'claude-opus-5-5',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        autoCompactThreshold: 987_000,
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
  } }))
}

const measure = ($: Engine, usage: Pick<SessionMeasureInput, 'rateLimits' | 'cost'> = { rateLimits: PLAN, cost: { usd: 1.234 } }) =>
  $.session.measure({
    context: { tokens: 90_000, window: 1_000_000, percent: 9 },
    ...usage,
    changed: ['context'],
  })

// find() matches a string by inclusion; anchor it so extra header parts fail the check.
const whole = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

const HEADER = '✻ claude-opus-5-5 • 90k of 1M (9%) • compacts at 987k'
// NOW (12:00 UTC) at the +0100 offset the stand-in's `date` reports.
const SYNCED = 'synced 13:00'

test('the band shows the context breakdown', async ($, on) => {
  engine(on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  }

  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(
      await ui.find({ type: 'Text', text: whole(`${HEADER} • 5h 24% (2h10m) • 7d 41% (3d4h) • spent $1.23 • ${SYNCED}`) }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: whole('✻') })).toMatchObject({ props: { color: '#D97757' } })
    expect(await ui.find({ type: 'Text', text: /mcp server instructions 731 0%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k 0% •/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /autocompact buffer 33k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free 897k 90%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /deferred/ })).toBeUndefined()
    const swatches = await ui.findAll({ type: 'Text', text: /^■$/ })
    const [prompt, tools] = swatches.map(s => s.props.color)
    expect(prompt).not.toBe(tools)
    // The first bar segment is the system prompt's, though 4.2k of 1M over 80 columns rounds to 0 cells.
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: prompt } })
    } else {
      const source = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(source.match(/<rect x="[^"]*" width="[^"]*" height="8" fill="([^"]*)"/)?.[1]).toBe(prompt)
    }
    await ui.unmount()
  }
})

test('legend off draws the header and bar only', { options: { legend: 'off' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /of 1M/ })).toBeDefined()
    expect(await ui.find(surface === 'terminal' ? { type: 'Text', text: /^█+$/ } : { type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /system prompt/ })).toBeUndefined()
    // No legend to tell colours apart: every segment is Claude's orange.
    if (surface === 'terminal') {
      const blocks = await ui.findAll({ type: 'Text', text: /^█+$/ })
      expect(blocks.length).toBeGreaterThan(1)
      expect(new Set(blocks.map(b => b.props.color))).toEqual(new Set(['#D97757']))
    } else {
      const source = String((await ui.find({ type: 'Svg' }))?.props.source)
      const fills = [...source.matchAll(/<rect x="[^"]*" width="[^"]*" height="8" fill="([^"]*)"/g)].map(m => m[1])
      expect(fills.length).toBeGreaterThan(1)
      expect(new Set(fills)).toEqual(new Set(['#D97757']))
    }
    await ui.unmount()
  }
})

test('legend tokens drops the percentages', { options: { legend: 'tokens' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k •/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4\.2k 0%/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /free 897k$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('legend compact shows the names only', { options: { legend: 'compact' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole('■ system prompt •') })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: whole('■ free') })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4\.2k/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the band stays hidden below the threshold', { options: { hide_below_percent: 10 } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of 1M/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the separator is configurable', { options: { separator: '|' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k 0% \|/ })).toBeDefined()
    expect(
      await ui.find({
        type: 'Text',
        text: whole(`✻ claude-opus-5-5 | 90k of 1M (9%) | compacts at 987k | 5h 24% (2h10m) | 7d 41% (3d4h) | spent $1.23 | ${SYNCED}`),
      }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /•/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the autocompact buffer can be hidden', { options: { show_buffer: false } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /autocompact buffer/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /free 897k 90%$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('precise numbers use one decimal, as the Context usage dialog', { options: { numbers: 'precise' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(
      await ui.find({
        type: 'Text',
        text: whole(`✻ claude-opus-5-5 • 90.0k of 1.0M (9%) • compacts at 987.0k • 5h 23.5% (2h10m) • 7d 41.0% (3d4h) • spent $1.23 • ${SYNCED}`),
      }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k 0\.4%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mcp server instructions 731 <0\.1%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free 897\.0k 89\.7%$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a spend-limit plan shows only its spend window', async ($, on) => {
  engine(on)
  await measure($, { rateLimits: [{ kind: 'spend_limit', percentUsed: 42, resetsAt: '2026-10-13T12:00:00Z' }] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole(`${HEADER} • spend 42% (5d0h) • ${SYNCED}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('nothing is added without limits or cost', async ($, on) => {
  engine(on)
  await measure($, { rateLimits: [] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole(`${HEADER} • ${SYNCED}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('usage limits shows the windows only', { options: { usage: 'limits' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole(`${HEADER} • 5h 24% (2h10m) • 7d 41% (3d4h) • ${SYNCED}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('usage cost shows the spend only', { options: { usage: 'cost' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole(`${HEADER} • spent $1.23 • ${SYNCED}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('usage off shows neither', { options: { usage: 'off' } }, async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: whole(`${HEADER} • ${SYNCED}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('a view stored by an older version yields no usage parts instead of throwing', () => {
  // The shape the mod stored before it tracked limits and spend: no `limits`, no `usd`. State outlives a
  // reload, so the reloaded module reads it until the next measurement replaces it.
  const stale = { model: 'claude-opus-5-5', tokens: 90_000, window: 1_000_000, percent: 9, compactAt: 987_000, rows: [] }

  expect(usageParts(stale as never, 'both', false, NOW)).toEqual([])
})

test('header figures are not dimmed', async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-viewer', surface, ...BAND })
    for (const figure of ['90k', '9%', '987k', '24%', '$1.23']) {
      const found = await ui.find({ type: 'Text', text: whole(figure) })
      expect(found).toMatchObject({ props: { bold: true } })
      expect(found?.props.dimColor).toBeUndefined()
    }
    expect(await ui.find({ type: 'Text', text: /5h 24% \(2h10m\)/ })).toMatchObject({ props: {} })
    expect((await ui.find({ type: 'Text', text: /5h 24% \(2h10m\)/ }))?.props.dimColor).toBeUndefined()
    await ui.unmount()
  }
})

test('the desktop draws the bar as an SVG, the terminal as text', async ($, on) => {
  engine(on)
  await measure($)

  const desktop = await $.ui.mount({ plugin: 'context-viewer', surface: 'desktop', ...BAND })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const source = String(svg?.props.source)
  for (const color of ['#e5735a', '#4fa3e0', '#9b7fe6']) expect(source).toContain(`fill="${color}"`)
  expect(svg?.props.alt).toContain('system prompt 4.2k')
  expect(await desktop.find({ type: 'Text', text: /░/ })).toBeUndefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'context-viewer', surface: 'terminal', ...BAND })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /░/ })).toBeDefined()
  await terminal.unmount()
})

test('the terminal sets the band off with a rule, the desktop does not', async ($, on) => {
  engine(on)
  await measure($)

  const terminal = await $.ui.mount({ plugin: 'context-viewer', surface: 'terminal', ...BAND })
  expect(await terminal.find({ type: 'Text', text: whole('─'.repeat(80)) })).toMatchObject({ props: { dimColor: true } })
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'context-viewer', surface: 'desktop', ...BAND })
  expect(await desktop.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
  await desktop.unmount()
})

test('the desktop bar has no seams between segments', async ($, on) => {
  engine(on)
  await measure($)

  const ui = await $.ui.mount({ plugin: 'context-viewer', surface: 'desktop', ...BAND })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  const rects = [...source.matchAll(/<rect x="([^"]*)" width="([^"]*)" height="8" fill="[^"]*"( fill-opacity)?/g)].map(m => ({
    x: Number(m[1]),
    w: Number(m[2]),
    translucent: m[3] !== undefined,
  }))
  expect(rects.length).toBeGreaterThan(2)
  for (let i = 0; i + 1 < rects.length; i++) {
    const [a, b] = [rects[i]!, rects[i + 1]!]
    // Opaque neighbours overlap; any neighbour at least touches.
    if (!a.translucent && !b.translucent) expect(a.x + a.w).toBeGreaterThan(b.x)
    else expect(a.x + a.w).toBeGreaterThanOrEqual(b.x - 0.1)
  }
  await ui.unmount()
})

test('with one colour the desktop bar is one run plus the buffer', { options: { legend: 'off' } }, async ($, on) => {
  engine(on)
  await measure($)

  const ui = await $.ui.mount({ plugin: 'context-viewer', surface: 'desktop', ...BAND })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect([...source.matchAll(/<rect x="/g)]).toHaveLength(2)
  await ui.unmount()
})

test('each measurement writes a snapshot for the VS Code status bar', async ($, on) => {
  engine(on, { env: { USERPROFILE: 'C:/Users/test' } })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'D:/GIT/project' }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  await measure($)

  expect(writes).toHaveLength(1)
  // The engine hands the path on in the platform's separators.
  expect(writes[0]?.path.replaceAll('\\', '/')).toBe('C:/Users/test/.claude/context-viewer/session-1.json')
  const snapshot = JSON.parse(writes[0]!.text)
  expect(snapshot).toMatchObject({ version: 1, sessionId: 'session-1', cwd: 'D:/GIT/project', updatedAt: NOW })
  expect(snapshot.view.tokens).toBe(90_000)
  expect(snapshot.view.limits).toHaveLength(2)
  expect(snapshot.view.syncedAt).toBe(NOW)
  expect(snapshot.settings).toEqual({ legend: 'full', numbers: 'round', usage: 'both', separator: '•', showBuffer: true })
})

test('parseOffset reads date +%z and PowerShell zzz, and falls back to UTC', () => {
  expect(parseOffset('+0100\n')).toBe(60)
  expect(parseOffset('+01:00\r\n')).toBe(60)
  expect(parseOffset('-05:30')).toBe(-330)
  expect(parseOffset('')).toBe(0)
})

test('without process access the synced time is UTC', async ($, on) => {
  engine(on, { canRun: false })
  await measure($)

  const ui = await $.ui.mount({ plugin: 'context-viewer', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /synced 12:00$/ })).toBeDefined()
  await ui.unmount()
})

test('on Windows the offset comes from PowerShell, elsewhere from date', async ($, on) => {
  engine(on, { env: { OS: 'Windows_NT' } })
  await measure($)

  const ui = await $.ui.mount({ plugin: 'context-viewer', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /synced 14:00$/ })).toBeDefined()
  await ui.unmount()
})
