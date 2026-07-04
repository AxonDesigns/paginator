Fonts in this directory are raw TrueType (`.ttf`) conversions of the WOFF2 files shipped by the
`@fontsource/inter` and `@fontsource/source-serif-4` npm packages (both licensed
[SIL Open Font License 1.1](https://openfontlicense.org)), produced locally via `woff2_decompress`.

`registerFont()` accepts `.ttf`/`.otf`/`.woff`/`.woff2` directly (pdfkit's bundled fontkit decodes all
four before embedding) — these demo fonts are kept as raw `.ttf` simply because that's how they were
originally sourced/converted here, not because `.woff2` would be rejected.

- `inter-latin-400-normal.ttf` / `inter-latin-700-normal.ttf` — Inter, Copyright 2016 The Inter
  Project Authors (https://github.com/rsms/inter)
- `source-serif-4-latin-400-normal.ttf` / `source-serif-4-latin-700-normal.ttf` — Source Serif 4,
  Copyright Google Inc.
