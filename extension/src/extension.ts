import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

import { parseSnapshot, pickSnapshot, STALE_MS, statusText, tooltip, transcriptTitle } from './status'
import type { Focus } from './status'
import { DEFAULT_SETTINGS } from '../../hooks/format'
import type { Snapshot } from '../../hooks/format'

// Where the context-viewer mod writes one snapshot per Claude Code session.
const DIR = join(homedir(), '.claude', 'context-viewer')

const readSnapshots = (): Snapshot[] =>
  readdirSync(DIR)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try {
        return parseSnapshot(readFileSync(join(DIR, name), 'utf8')) ?? []
      } catch {
        return [] // removed or half-written between the listing and the read
      }
    })

// Where the engine keeps each session's transcript, under a folder named after the session's cwd.
const PROJECTS = join(homedir(), '.claude', 'projects')
const titles = new Map<string, { size: number; title: string | undefined }>()

// ponytail: reads the whole transcript whenever it has grown; read only its tail if transcripts get huge.
const titleOf = (sessionId: string) => {
  try {
    const project = readdirSync(PROJECTS).find(dir => existsSync(join(PROJECTS, dir, `${sessionId}.jsonl`)))
    if (project === undefined) {
      return undefined
    }
    const path = join(PROJECTS, project, `${sessionId}.jsonl`)
    const size = statSync(path).size
    const cached = titles.get(sessionId)
    if (cached?.size === size) {
      return cached.title
    }
    const title = transcriptTitle(readFileSync(path, 'utf8'))
    titles.set(sessionId, { size, title })

    return title
  } catch {
    return undefined
  }
}

// A Claude Code editor tab is a webview panel of this type, labelled with its session's title.
const claudeTabLabel = (tab: vscode.Tab | undefined) =>
  tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('claudeVSCodePanel') ? tab.label : undefined

export const activate = (context: vscode.ExtensionContext) => {
  // The Claude Code tab focused last; focusing a code editor or the sidebar keeps it.
  let lastTab: { label: string; at: number } | undefined
  // Claude Code's item has no priority, which VS Code treats as 0, so 1 sits directly left of it.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1)
  // The same mark the icon font is built from (docs/regenerate-icon.md), drawn orange in the tooltip.
  const logo = readFileSync(join(context.extensionPath, 'assets', 'icons', 'claude.svg'), 'utf8')

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
    const now = Date.now()
    const snapshots = readSnapshots()
    const focus: Focus | undefined =
      lastTab === undefined
        ? undefined
        : {
            ...lastTab,
            titles: new Map(
              snapshots
                .filter(s => now - s.updatedAt <= STALE_MS)
                .flatMap(s => {
                  const title = titleOf(s.sessionId)

                  return title === undefined ? [] : [[s.sessionId, title] as const]
                }),
            ),
          }
    const snapshot = pickSnapshot(snapshots, folders, now, process.platform === 'win32', focus)
    if (snapshot === undefined) {
      item.hide()
      return
    }
    // Snapshots from before the mod sent its settings render with the defaults.
    const settings = snapshot.settings ?? DEFAULT_SETTINGS
    const config = vscode.workspace.getConfiguration('contextViewer.statusBar')
    const cells = config.get<boolean>('showBar', true) ? config.get<number>('barCells', 10) : 0
    item.text = statusText(snapshot.view, settings, cells)
    const markdown = new vscode.MarkdownString(tooltip(snapshot.view, settings, now, logo))
    markdown.supportHtml = true // the swatches, the ✻ colour and the bar image
    item.tooltip = markdown
    item.show()
  }

  const onTabs = () => {
    const label = claudeTabLabel(vscode.window.tabGroups.activeTabGroup.activeTab)
    if (label !== undefined) {
      lastTab = { label, at: Date.now() }
      refresh()
    }
  }

  mkdirSync(DIR, { recursive: true })
  const watcher = watch(DIR, refresh)
  // Reset countdowns move with time, not only when a snapshot is written.
  const timer = setInterval(refresh, 30_000)
  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    // Only when the active tab itself changes: an unrelated tab's change must not take the focus back from a
    // prompt typed in the sidebar while a Claude tab stays the active one.
    vscode.window.tabGroups.onDidChangeTabs(e => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab
      if (active !== undefined && [...e.opened, ...e.changed].includes(active)) {
        onTabs()
      }
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(onTabs),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('contextViewer') && refresh()),
    { dispose: () => watcher.close() },
    { dispose: () => clearInterval(timer) },
  )
  onTabs()
  refresh()
}

export const deactivate = () => {}
