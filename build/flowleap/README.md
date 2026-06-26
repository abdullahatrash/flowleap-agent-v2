# FlowLeap branding assets

## `codicon.ttf` — FlowLeap-branded codicon font

A copy of `@vscode/codicons` `codicon.ttf` with the eleven `copilot-*` glyphs
(see `src/vs/base/common/codiconsLibrary.ts`) replaced by the FlowLeap logo.
Badge overlays (warning, error, success, slash, zZ, ...) are preserved from the
stock font and composed around the new logo with a knockout halo.

`build/lib/compilation.ts` (`copy-codicons` / `watch-codicons`) copies this file
— instead of the one from `node_modules` — to
`src/vs/base/browser/ui/codicons/codicon/codicon.ttf` (gitignored) on every
build, so this committed font is the single source of truth.

### Regenerating

Needed after an `@vscode/codicons` package bump (otherwise codicons added by
upstream will be missing from the patched font and render as empty boxes):

```bash
brew install fontforge   # one-time
fontforge -script build/flowleap/patch-copilot-glyphs.py \
    node_modules/@vscode/codicons/dist/codicon.ttf build/flowleap/codicon.ttf
```

If upstream adds new `copilot-*` codicons to `codiconsLibrary.ts`, add their
code points to `CORE` in `patch-copilot-glyphs.py` first.

The same script also brands the built-in copilot extension's icon font
(`extensions/copilot/assets/copilot.woff`, glyphs A/B/C from `contributes.icons`).
Run it against a stock copy of the woff (e.g. restore the unbranded font from git
first, since the script reads and overwrites in place):

```bash
fontforge -script build/flowleap/patch-copilot-glyphs.py --woff \
    <stock-copilot.woff> extensions/copilot/assets/copilot.woff
```

### Quick visual check

```bash
brew install harfbuzz    # hb-view (TTF only; it cannot open WOFF)
hb-view --font-size=96 build/flowleap/codicon.ttf -u ec1e   # plain logo
hb-view --font-size=96 build/flowleap/codicon.ttf -u ec38   # warning badge
```

## `flowleap-logo.svg`

Monochrome, fill-only version of the FlowLeap logo used as the glyph source
(square viewBox, no strokes, no opacity — font glyphs only understand fills).
