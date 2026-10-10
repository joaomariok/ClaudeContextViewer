import { barSvg, CLAUDE, fmt, hhmm, pct, shownRows, usageParts } from '../../hooks/format'
import type { Settings, Snapshot, View } from '../../hooks/format'

const STALE_MS = 12 * 60 * 60 * 1000

const normalize = (p: string, ignoreCase: boolean) => {
  const s = p.replaceAll('\\', '/').replace(/\/+$/, '')

  return ignoreCase ? s.toLowerCase() : s
}

// The newest snapshot of a session running in one of the open folders, written in the last 12 hours.
export const pickSnapshot = (
  snapshots: Snapshot[],
  folders: string[],
  now: number,
  ignoreCase: boolean,
): Snapshot | undefined => {
  const open = new Set(folders.map(f => normalize(f, ignoreCase)))

  return snapshots
    .filter(s => open.has(normalize(s.cwd, ignoreCase)) && now - s.updatedAt <= STALE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

// A file the mod wrote, or undefined for anything else in the folder.
export const parseSnapshot = (text: string): Snapshot | undefined => {
  try {
    const s = JSON.parse(text)

    return s?.version === 1 && typeof s.cwd === 'string' && typeof s.view?.tokens === 'number' ? s : undefined
  } catch {
    return undefined
  }
}

// ▰▰▰▱▱: status-bar items take text only, in one colour, so the bar is shapes.
export const bar = (percent: number, cells: number) => {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

// <logo> • ▰▱▱▱▱▱▱▱▱▱ • 87k/1M (9%), the logo from the contributed icon font: the context alone; plan windows
// and spend live in the tooltip. 0 cells, no bar.
export const statusText = (v: View, s: Settings, cells = 0) => {
  const precise = s.numbers === 'precise'
  const parts = [
    '$(context-viewer-claude)',
    ...(cells > 0 ? [bar(v.percent, cells)] : []),
    `${fmt(v.tokens, precise)}/${fmt(v.window, precise)} (${v.percent}%)`,
  ]

  return parts.join(s.separator === '' ? ' ' : ` ${s.separator} `)
}

// Severity as ai-status-bar marks a window: green below 70%, yellow from 70%, red from 90%.
export const dot = (percent: number | undefined) =>
  percent === undefined ? '○' : percent >= 90 ? '🔴' : percent >= 70 ? '🟡' : '🟢'

// A coloured block, as the Context usage dialog marks each category; hovers allow only these span styles.
const swatch = (color: string) => `<span style="background-color:${color};border-radius:2px;">&nbsp;&nbsp;</span>`

// Hovers take images only as data: URIs.
const svgData = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// The Context usage dialog's layout (bar, then category / tokens / usage) in the mod's look and settings.
// logo is the Claude mark's SVG text; without it the header falls back to the band's ✻.
export const tooltip = (v: View, s: Settings, now: number, logo?: string) => {
  const precise = s.numbers === 'precise'
  const rows = shownRows(v.rows, s.legend, s.showBuffer)
  const mark =
    logo === undefined
      ? `<span style="color:${CLAUDE};">✻</span>`
      : `<img src="${svgData(logo.replace('<svg ', `<svg fill="${CLAUDE}" `))}" width="14" height="14" align="absmiddle">`

  // One fact per line (a markdown hard break is two trailing spaces).
  const header = [
    `${mark} **${v.model}**`,
    `${dot(v.percent)} Context: **${fmt(v.tokens, precise)}** of ${fmt(v.window, precise)} (**${v.percent}%**)`,
    ...(v.compactAt === undefined ? [] : [`Compacts at: **${fmt(v.compactAt, precise)}**`]),
    ...(v.syncedAt === undefined ? [] : [`Synced: **${hhmm(v.syncedAt)}**`]),
  ].join('  \n')
  const bar = `<img src="${svgData(barSvg(rows, v.window))}" width="320" height="8">`

  // Raw HTML, since a markdown table can't take the bar's full width; hovers keep width and align attributes.
  const columns = s.legend === 'full' ? 3 : s.legend === 'tokens' ? 2 : 1
  const head = ['<th align="left">Category</th>', '<th align="right">Tokens</th>', '<th align="right">Usage</th>']
  const table =
    s.legend === 'off'
      ? []
      : [
          '<table width="100%">' +
            `<thead><tr>${head.slice(0, columns).join('')}</tr></thead><tbody>` +
            rows
              .map(row =>
                [
                  `<td>${swatch(row.color)} ${row.name}</td>`,
                  `<td align="right">${fmt(row.tokens, precise)}</td>`,
                  `<td align="right">${pct(row.tokens, v.window, precise)}</td>`,
                ]
                  .slice(0, columns)
                  .join(''),
              )
              .map(cells => `<tr>${cells}</tr>`)
              .join('') +
            '</tbody></table>',
        ]

  // usageParts lists the windows first, in the order of v.limits, then the spend.
  const windows = s.usage === 'both' || s.usage === 'limits' ? (v.limits ?? []) : []
  const footer = usageParts(v, s.usage, precise, now).map(([name, figure, tail], i) => {
    const label = `${name.trim().charAt(0).toUpperCase()}${name.trim().slice(1)}:`
    const limit = windows[i]

    return `${limit === undefined ? '' : `${dot(limit.percentUsed)} `}${label} **${figure}**${tail}`
  })

  return [header, '', bar, '', ...table, ...(footer.length > 0 ? ['', footer.join('  \n')] : [])].join('\n')
}
