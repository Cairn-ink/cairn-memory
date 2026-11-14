# README illustrations

These illustrations follow Cairn's approved shared style ruler (v1.2,
2026-09-27): paper `#FAF7F2`, warm paper `#F4F0E8`, ink `#1F1D1A`, muted ink
`#6B6560`, moss `#5A7A4E` and stroke `#E5DFD4`. Display type uses EB Garamond;
body text and the Memory descriptor use Inter. They are concept illustrations,
not screenshots of an application or chat client.

The header reuses the official three ellipses from Cairn's `CairnStones`
component / `public/cairn-wordmark.svg`, with the same proportions, tilts and
opacity levels. The name is set as Cairn.ink in the wordmark's typeface,
followed by a separate Memory descriptor. Do not replace the mark with bars or
redraw it with a generator.

- `readme-hero.svg` / `.png`: the brand header. A hand-drawn island carries a
  cairn of three stones, labelled Cards, Memories and Conversations for the
  three layers the README describes. The labels sit on clear paper beside the
  drawing, never on top of it.
- `readme-hero-mobile.svg` / `.png`: a simpler header for screens up to 600px,
  with larger type, the same official logo geometry and the island without
  labels. Both introductions select it through a responsive `<picture>`
  element.
- `readme-hero-island.png`: the hand-drawn island from Cairn's island set,
  reused unchanged (570×335). Both header SVGs reference it.
- `memory-workflow.svg` / `.png`: an explicit-tool example of saving, inspecting,
  correcting and forgetting a reporting preference.

SVG files are the editable sources. The illustration PNG is rasterized at the
dimensions declared in its SVG. The two header PNGs are rasterized at twice
the declared dimensions and reduced to a 256-colour palette, with EB Garamond
400/500, Inter 400/500/600 and JetBrains Mono 500 available to the renderer. The PNGs retain the intended typography
without relying on the reader's installed fonts. Keep source text and memory content
distinct; do not imply verified chat-client compatibility,
successful model-free semantic recall or secure disk erasure.

Both README introductions include the meaning of the illustrations in text so
readers do not need to read small text inside an image.
