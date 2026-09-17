# Demo GIF

`cairn-memory-loop.gif` shows one real, keyless run of the five MCP tools
against an installed local preview: remember, inspect the receipt, restart the
process, inspect again, correct at the inspected revision, attempt recall
without a model key, forget, and inspect an empty store. The frames are
rendered from `transcript.txt`, the actual tool responses of that run, trimmed
to the fields named on screen. No model call was made and nothing is staged.

## Regenerate

1. Install the local preview as described in the root README and install the
   isolated SDK client: `npm ci --prefix adapters/mcp`.
2. Record a fresh transcript (synthetic content, temporary database):

   ```sh
   node adapters/mcp/demo-transcript.mjs /abs/path/to/cairn-local/app/node_modules/.bin/cairn-memory > docs/demo/transcript.txt
   ```

3. Render frames and the GIF. Needs Python 3 with Pillow, DejaVu Sans Mono and
   ffmpeg. The font is read from `/usr/share/fonts/truetype/dejavu`; set
   `CAIRN_DEMO_FONT_DIR` to the directory holding `DejaVuSansMono.ttf` and
   `DejaVuSansMono-Bold.ttf` on other systems:

   ```sh
   python3 docs/demo/render-gif.py
   cd docs/demo/frames && ffmpeg -y -f concat -safe 0 -i list.txt \
     -vf "fps=10,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=none" \
     -loop 0 ../cairn-memory-loop.gif
   ```

The memory id and timestamps in the GIF come from that recorded run; a
regenerated GIF will show different ones.
