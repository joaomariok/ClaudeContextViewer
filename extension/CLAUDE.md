# context-viewer-status (VS Code extension)

A status-bar item and hover showing the newest context-viewer snapshot for a session running in an open
folder. The mod draws nothing in VS Code, so this extension is the only VS Code surface.

## Verify

```
npm test                 # tsc, then node:test on out/extension/src/*.spec.js
npm run package          # builds context-viewer-status-0.1.0.vsix
code --install-extension context-viewer-status-0.1.0.vsix --force   # then Developer: Reload Window
```

Also run the root gate (`../CLAUDE.md`) whenever `../hooks/format.ts` changes.

## Layout

- `src/status.ts` holds the pure logic: picking a snapshot, the status text, the hover markdown. Test it in
  `src/status.spec.ts`.
- `src/extension.ts` is only the VS Code wiring: the item, the file watch, the settings.
- `../hooks/format.ts` is shared with the mod: `View`, `Snapshot`, `Settings`, `fmt`, `barSvg`, `usageParts`.
  Reuse it rather than re-implementing it.
- Tests are `*.spec.ts`, never `*.test.ts`. `claude plugin test` at the repo root would pick up `*.test.ts`.

## Gotchas

- **Settings come from two places.**
  - The mod's settings (`legend`, `numbers`, `usage`, `separator`, `showBuffer`) arrive in the snapshot.
  - The extension's own settings (`contextViewer.statusBar.*`) are for things that exist only in VS Code.
- **Status-bar text is plain text in one colour.** The item takes plain text plus `$(icon)`, so the bar is
  `▰▱` and the logo is the contributed icon font. To change the logo, see `docs/regenerate-icon.md`.
- **Item priority is 1.** Claude Code's own item has priority 0, so 1 keeps ours directly left of it. Don't
  change it.
- **Hovers are sanitized.**
  - `style` survives only on `<span>`, and only `color`, `background-color`, `display:inline-block` and
    `border-radius`.
  - `width` and `align` survive on any tag.
  - Images must be `data:` URIs.
  - Check the installed `workbench.desktop.main.js` before relying on any other HTML.
