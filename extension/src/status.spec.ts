// A .spec.ts on purpose: `claude plugin test` runs every *.test.ts in the repo, and this is not a mod test.
import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_SETTINGS, hhmm } from '../../hooks/format'
import type { Settings, Snapshot, View } from '../../hooks/format'
import { bar, dot, parseSnapshot, pickSnapshot, statusText, tooltip } from './status'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const HOUR = 60 * 60 * 1000

const VIEW: View = {
  model: 'claude-opus-5-5',
  tokens: 87_000,
  window: 1_000_000,
  percent: 9,
  compactAt: 967_000,
  rows: [
    { name: 'System prompt', tokens: 2500, color: '#e5735a', kind: 'used' },
    { name: 'Free space', tokens: 869_000, color: '#808080', kind: 'free' },
  ],
  limits: [
    { kind: 'five_hour', percentUsed: 14, resetsAt: '2026-10-08T13:49:00Z' },
    { kind: 'seven_day', percentUsed: 15, resetsAt: '2026-10-13T22:00:00Z' },
  ],
  usd: 0.36,
}

const snapshot = (cwd: string, ageMs: number, sessionId = cwd): Snapshot => ({
  version: 1,
  sessionId,
  cwd,
  updatedAt: NOW - ageMs,
  view: VIEW,
})

test('pickSnapshot takes the newest session in an open folder', () => {
  const older = snapshot('D:\\GIT\\Engram', 2 * HOUR, 'older')
  const newer = snapshot('D:\\GIT\\Engram', HOUR, 'newer')
  const elsewhere = snapshot('D:\\GIT\\Other', 0, 'elsewhere')

  assert.equal(pickSnapshot([older, elsewhere, newer], ['D:\\GIT\\Engram'], NOW, true)?.sessionId, 'newer')
})

test('pickSnapshot skips other folders and stale sessions', () => {
  assert.equal(pickSnapshot([snapshot('D:\\GIT\\Other', 0)], ['D:\\GIT\\Engram'], NOW, true), undefined)
  assert.equal(pickSnapshot([snapshot('D:\\GIT\\Engram', 13 * HOUR)], ['D:\\GIT\\Engram'], NOW, true), undefined)
})

test('pickSnapshot matches paths across separators and, on Windows, case', () => {
  const s = snapshot('d:/git/engram/', 0)

  assert.equal(pickSnapshot([s], ['D:\\GIT\\Engram'], NOW, true), s)
  assert.equal(pickSnapshot([s], ['D:\\GIT\\Engram'], NOW, false), undefined)
})

test('parseSnapshot accepts the mod file and rejects anything else', () => {
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot('D:\\x', 0))), snapshot('D:\\x', 0))
  assert.equal(parseSnapshot('{"version":2}'), undefined)
  assert.equal(parseSnapshot('{"vers'), undefined)
})

const S: Settings = DEFAULT_SETTINGS
const decodeBar = (md: string) =>
  Buffer.from(md.match(/<img src="data:image\/svg\+xml;base64,([^"]+)"/)?.[1] ?? '', 'base64').toString()

test('statusText shows the context alone, whatever the plan windows and usage setting', () => {
  assert.equal(statusText(VIEW, S), '$(context-viewer-claude) • 87k/1M (9%)')
  assert.equal(statusText({ ...VIEW, limits: [{ kind: 'spend_limit', percentUsed: 42 }] }, S), '$(context-viewer-claude) • 87k/1M (9%)')
  assert.equal(statusText(VIEW, { ...S, usage: 'limits', separator: '|' }), '$(context-viewer-claude) | 87k/1M (9%)')
})

test('statusText follows numbers', () => {
  assert.equal(statusText(VIEW, { ...S, numbers: 'precise' }), '$(context-viewer-claude) • 87.0k/1.0M (9%)')
})

test('statusText puts the bar between the mark and the figures', () => {
  assert.equal(statusText({ ...VIEW, percent: 60 }, S, 10), '$(context-viewer-claude) • ▰▰▰▰▰▰▱▱▱▱ • 87k/1M (60%)')
  assert.equal(statusText({ ...VIEW, percent: 60 }, S, 0), '$(context-viewer-claude) • 87k/1M (60%)')
})

test('statusText separates its parts with the separator setting, or a space when it is empty', () => {
  const v = { ...VIEW, percent: 60 }

  assert.equal(statusText(v, { ...S, separator: '|' }, 10), '$(context-viewer-claude) | ▰▰▰▰▰▰▱▱▱▱ | 87k/1M (60%)')
  assert.equal(statusText(v, { ...S, separator: '' }, 10), '$(context-viewer-claude) ▰▰▰▰▰▰▱▱▱▱ 87k/1M (60%)')
  assert.equal(statusText(v, { ...S, separator: '' }, 0), '$(context-viewer-claude) 87k/1M (60%)')
})

test('bar rounds to the nearest cell and stays within its cells', () => {
  assert.equal(bar(0, 5), '▱▱▱▱▱')
  assert.equal(bar(100, 5), '▰▰▰▰▰')
  assert.equal(bar(130, 5), '▰▰▰▰▰')
  assert.equal(bar(-5, 5), '▱▱▱▱▱')
  assert.equal(bar(29, 5), '▰▱▱▱▱')
  assert.equal(bar(31, 5), '▰▰▱▱▱')
})

test('tooltip has the header, the bar, the full table and the usage line', () => {
  const md = tooltip(VIEW, S, NOW)

  // One fact per line, each line ending in a hard break but the last.
  assert.ok(
    md.startsWith(
      '<span style="color:#D97757;">✻</span> **claude-opus-5-5**  \n' +
        '🟢 Context: **87k** of 1M (**9%**)  \n' +
        'Compacts at: **967k**\n',
    ),
  )
  assert.ok(decodeBar(md).includes('fill="#e5735a"'))
  assert.match(md, /^<table width="100%">/m)
  assert.ok(md.includes('<tr><th align="left">Category</th><th align="right">Tokens</th><th align="right">Usage</th></tr>'))
  assert.ok(
    md.includes(
      '<tr><td><span style="background-color:#e5735a;border-radius:2px;">&nbsp;&nbsp;</span> System prompt</td>' +
        '<td align="right">2.5k</td><td align="right">0%</td></tr>',
    ),
  )
  assert.ok(md.includes(' Free space</td><td align="right">869k</td><td align="right">87%</td></tr>'))
  assert.ok(md.endsWith('\n\n🟢 5h: **14%** (1h49m)  \n🟢 7d: **15%** (5d10h)  \nSpent: **$0.36**'))
})

test('with the logo, the header draws the Claude mark in the band orange', () => {
  const logo = '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>'
  const md = tooltip(VIEW, S, NOW, logo)
  const src = md.match(/^<img src="data:image\/svg\+xml;base64,([^"]+)" width="14" height="14" align="absmiddle"> \*\*claude-opus-5-5\*\*  $/m)?.[1]

  assert.ok(src)
  assert.ok(Buffer.from(src, 'base64').toString().startsWith('<svg fill="#D97757" role="img"'))
  assert.doesNotMatch(md, /✻/)
})

test('tooltip columns follow the legend', () => {
  const tokens = tooltip(VIEW, { ...S, legend: 'tokens' }, NOW)
  const compact = tooltip(VIEW, { ...S, legend: 'compact' }, NOW)

  assert.ok(tokens.includes('<tr><th align="left">Category</th><th align="right">Tokens</th></tr>'))
  assert.ok(tokens.includes(' System prompt</td><td align="right">2.5k</td></tr>'))
  assert.ok(compact.includes('<tr><th align="left">Category</th></tr>'))
  assert.ok(compact.includes(' System prompt</td></tr>'))
})

test('legend off drops the table and draws the bar in one colour', () => {
  const md = tooltip(VIEW, { ...S, legend: 'off' }, NOW)
  const fills = [...decodeBar(md).matchAll(/<rect x="[^"]*" width="[^"]*" height="8" fill="([^"]*)"/g)].map(m => m[1])

  assert.doesNotMatch(md, /Category/)
  assert.ok(fills.length > 0)
  assert.deepEqual(new Set(fills), new Set(['#D97757']))
})

test('dot marks severity as ai-status-bar does', () => {
  assert.equal(dot(undefined), '○')
  assert.equal(dot(69.9), '🟢')
  assert.equal(dot(70), '🟡')
  assert.equal(dot(89.9), '🟡')
  assert.equal(dot(90), '🔴')
})

test('the context and each window get their own dot', () => {
  const md = tooltip({ ...VIEW, percent: 92, limits: [{ kind: 'five_hour', percentUsed: 75 }] }, S, NOW)

  assert.match(md, /^🔴 Context: /m)
  assert.match(md, /^🟡 5h: \*\*75%\*\*/m)
})

test('tooltip follows numbers, usage, separator and show_buffer', () => {
  const withBuffer: View = {
    ...VIEW,
    rows: [...VIEW.rows, { name: 'Autocompact buffer', tokens: 33_000, color: '#808080', kind: 'buffer' }],
  }

  assert.ok(tooltip(VIEW, { ...S, numbers: 'precise' }, NOW).includes(' System prompt</td><td align="right">2.5k</td><td align="right">0.3%</td></tr>'))
  assert.ok(tooltip(VIEW, { ...S, usage: 'cost' }, NOW).endsWith('\n\nSpent: **$0.36**'))
  assert.ok(tooltip(VIEW, { ...S, usage: 'limits' }, NOW).endsWith('\n\n🟢 5h: **14%** (1h49m)  \n🟢 7d: **15%** (5d10h)'))
  assert.doesNotMatch(tooltip(VIEW, { ...S, usage: 'off' }, NOW), /spent|5h/)
  // The popup is one fact per line, so the separator has nothing to join.
  assert.equal(tooltip(VIEW, { ...S, separator: '|' }, NOW), tooltip(VIEW, S, NOW))
  assert.match(tooltip(withBuffer, S, NOW), /Autocompact buffer/)
  assert.doesNotMatch(tooltip(withBuffer, { ...S, showBuffer: false }, NOW), /Autocompact buffer/)
})

test('hhmm is the local wall-clock time by default, zero-padded', () => {
  assert.equal(hhmm(new Date(2026, 9, 8, 9, 5).getTime()), '09:05')
  assert.equal(hhmm(new Date(2026, 9, 8, 23, 59).getTime()), '23:59')
})

test('hhmm applies a given UTC offset, across midnight', () => {
  assert.equal(hhmm(Date.parse('2026-10-08T08:19:00Z'), 60), '09:19')
  assert.equal(hhmm(Date.parse('2026-10-08T23:30:00Z'), 60), '00:30')
  assert.equal(hhmm(Date.parse('2026-10-08T02:00:00Z'), -330), '20:30')
})

test('tooltip header ends with the synced time when the view has one', () => {
  const at = new Date(2026, 9, 8, 14, 32).getTime()
  assert.ok(tooltip({ ...VIEW, syncedAt: at }, S, NOW).includes('Compacts at: **967k**  \nSynced: **14:32**\n'))
  assert.doesNotMatch(tooltip(VIEW, S, NOW), /Synced/)
})
