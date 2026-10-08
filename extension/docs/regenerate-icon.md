# Regenerate the status-bar icon

`assets/icons/claude.svg` is the single source of the Claude mark:

- The tooltip reads the SVG at activation and draws it in the band's orange.
- The status bar can't show an SVG. It shows `$(context-viewer-claude)`, one glyph (`U+E001`) of
  `assets/icons/claude.woff`, contributed in `package.json` under `contributes.icons`.

After you replace the SVG, rebuild the font. The font tools are not project dependencies, so run them from a
scratch folder outside the repo:

```sh
mkdir icon-build && cd icon-build
npm init -y
npm install --no-audit --no-fund svgicons2svgfont@16.0.0 svg2ttf@6.1.0 ttf2woff@3.0.0
```

Save this as `build.mjs` in that folder:

```js
// Usage: node build.mjs <claude.svg> <claude.woff>
import { createReadStream, writeFileSync } from 'node:fs'
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont'
import svg2ttf from 'svg2ttf'
import ttf2woff from 'ttf2woff'

const [svgPath, woffPath] = process.argv.slice(2)
const font = new SVGIcons2SVGFontStream({ fontName: 'context-viewer', fontHeight: 512, normalize: true, log: () => {} })
let svgFont = ''
font.on('data', chunk => (svgFont += chunk))
font.on('end', () => {
  const ttf = svg2ttf(svgFont, {})
  writeFileSync(woffPath, Buffer.from(ttf2woff(new Uint8Array(ttf.buffer)).buffer))
  console.log(`wrote ${woffPath}`)
})
const glyph = createReadStream(svgPath)
glyph.metadata = { unicode: [''], name: 'claude' }
font.write(glyph)
font.end()
```

Run it against the extension's icon folder:

```sh
node build.mjs <repo>/extension/assets/icons/claude.svg <repo>/extension/assets/icons/claude.woff
```

Then run `npm test`, `npm run package` and reinstall, and check both places the mark appears: the status bar
and the tooltip header.

## Constraints

- **Single colour:** VS Code draws the glyph in the status-bar foreground colour. The tooltip sets `fill` on
  the `<svg>` root, so the SVG must not hard-code fills on its paths.
- **Its own `<svg ` tag:** the SVG must open with `<svg ` (a space after the tag name), since the tooltip
  inserts `fill` there.
- **Don't use `fantasticon`:** v4.1.0 builds its glob with `path.join`. On Windows that gives backslashes,
  which its `glob` v11 doesn't match against drive-letter paths, so it fails with `No SVGs found`. The
  libraries above are the ones `fantasticon` wraps.
