# README illustrations

These illustrations follow Cairn's approved shared style ruler (v1.2,
2026-09-27): paper `#FAF7F2`, warm paper `#F4F0E8`, ink `#1F1D1A`, muted ink
`#6B6560`, moss `#5A7A4E` and stroke `#E5DFD4`. Display type uses EB Garamond;
body text and the Memory descriptor use Inter. They are concept illustrations,
not screenshots of an application or chat client.

The header reuses the official three ellipses from Cairn's `CairnStones`
component / `public/cairn-wordmark.svg`, with the same proportions, tilts and
opacity levels. The existing Cairn wordmark is followed by a separate Memory
descriptor. Do not replace the mark with bars or redraw it with a generator.

- `readme-hero.svg` / `.png`: the brand header.
- `readme-hero-mobile.svg` / `.png`: a simpler header for screens up to 600px,
  with larger type and the same official logo geometry. Both introductions
  select it through a responsive `<picture>` element.
- `memory-workflow.svg` / `.png`: an explicit-tool example of saving, inspecting,
  correcting and forgetting a reporting preference.

SVG files are the editable sources. PNG files are rasterized at the dimensions
declared in the SVGs for README display, with EB Garamond 400/500 and Inter
400/500/600 available to the renderer. The PNGs retain the intended typography
without relying on the reader's installed fonts. Keep source text and memory content
distinct; do not imply automatic capture, verified chat-client compatibility,
successful model-free semantic recall or secure disk erasure.

Both README introductions include the meaning of the illustrations in text so
readers do not need to read small text inside an image.
