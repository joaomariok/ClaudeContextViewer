import { mkdirSync, readdirSync, readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

import { parseSnapshot, pickSnapshot, statusText, tooltip } from './status'
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

export const activate = (context: vscode.ExtensionContext) => {
  // Claude Code's item has no priority, which VS Code treats as 0, so 1 sits directly left of it.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1)
  // The same mark the icon font is built from (docs/regenerate-icon.md), drawn orange in the tooltip.
  const logo = readFileSync(join(context.extensionPath, 'assets', 'icons', 'claude.svg'), 'utf8')

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
    const now = Date.now()
    const snapshot = pickSnapshot(readSnapshots(), folders, now, process.platform === 'win32')
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

  mkdirSync(DIR, { recursive: true })
  const watcher = watch(DIR, refresh)
  // Reset countdowns move with time, not only when a snapshot is written.
  const timer = setInterval(refresh, 30_000)
  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('contextViewer') && refresh()),
    { dispose: () => watcher.close() },
    { dispose: () => clearInterval(timer) },
  )
  refresh()
}

export const deactivate = () => {}
