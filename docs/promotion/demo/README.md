# Cairn Memory developer-preview demo

[Watch the 36-second demo](cairn-memory-preview.mp4) · [Poster](poster.png) · [Storyboard](STORYBOARD.md) · [Full transcript](transcript.txt)

A silent, English, 1280×720 / 30 fps presentation of one **real model-free run** of the local MCP tools. This is an edited presentation of selected response fields, not a screen recording or a semantic-recall success demo. The lower caption and persistent model-free label make that scope visible.

The recording came from [fresh installation attempt 01 on Node 22.16.0](../install-validation/attempt-01-node22/), source commit `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`. The installed local archive is `cairn-memory-local-preview@0.0.0-preview.1`, SHA-256 `ce2851621a9c7361523f3c7083998200b95665637c6b52c3fa20f269ff523646`; the repository/plugin release version is a separate version. The original retained [tool output](../install-validation/attempt-01-node22/tool-transcript.stdout.txt) is copied unchanged as `transcript.txt`.

| Scene | Time | Evidence shown |
| --- | --- | --- |
| s01-save | 0–5 s | Explicitly save a synthetic tabs/spaces preference; revision 1 |
| s02-source | 5–10 s | Inspect the submitted source text in its receipt |
| s03-restart | 10–15 s | Close session A; inspect the same memory in a fresh process |
| s04-correct | 15–21 s | Correct at expected revision 1; receive revision 2 |
| s05-recall | 21–26 s | `recall_memory` returns `model_not_configured` without a key |
| s06-forget | 26–32 s | Forget at revision 2; inspect an empty active-memory list |
| s07-try | 32–36 s | GitHub and model-free walkthrough call to action |

The real memory ID is `42304c69-efd1-4270-a93b-7ec5bcd8ba77`. [evidence.json](evidence.json) contains the parsed calls, receipt ID and recorded timestamp. [build.py](build.py) derives every displayed tool value from the transcript and checks the memory ID, revision chain, recall error and final empty list. Missing JSON fields are omitted for legibility; display timing is edited and is not a latency benchmark.

Receipts record submitted text, not an independently authenticated conversation. Forgetting excludes a memory from active recall; this demonstration does not prove physical erasure or rejection of every paraphrase. Semantic recall requires an explicitly supplied provider key and sends selected context to that provider. No model call was made for this video, and no human adoption or reader-testing result is implied.

## Reproduce

Prerequisites: Python 3, Node/npm, FFmpeg, and a local Chromium supported by HyperFrames. Fonts and GSAP are local assets. The CLI is pinned; there are no checked-in `node_modules`.

From this directory:

```sh
python3 build.py
npm run check
npm run preview -- --background
npm run render
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json cairn-memory-preview.mp4
```

To replace the transcript with another real, keyless synthetic run, install the local preview using the root README and run this from the repository root:

```sh
npm ci --prefix adapters/mcp
node adapters/mcp/demo-transcript.mjs /abs/path/to/cairn-local/app/node_modules/.bin/cairn-memory > docs/promotion/demo/transcript.txt
```

Then rebuild, check, inspect snapshots and render. The transcript runner creates a temporary database and strips provider keys from its child process environment. New IDs and timestamps will differ.

The first render attempted in the automation runner exited with `render_cancelled_parent_exited` before frame capture because the tool wrapper exited. Running the same command in a retained PTY session resolved that process-lifetime issue; it did not require a composition change.

## Review and verification

- [Validation report](validation.json): lint, runtime, layout and contrast results.
- [Contact sheet 1](contact-sheet-1.jpg), [sheet 2](contact-sheet-2.jpg), [sheet 3](contact-sheet-3.jpg): scene holds and cuts. Original full-size frames were inspected because the reduced sheets can obscure small type.
- [Decoded output proof](decoded-proof.jpg): actual MP4 scene and boundary frames, retained after encoding.

## Source assets

Created with the [HyperFrames](https://github.com/heygen-com/hyperframes) product-launch workflow and its code-editorial preset. Output-line reveal timing adapts the registry's `code-terminal-run` pattern; the progress indicator follows `stat-bars-and-fills`. The composition is authored in seven scene files, with source generation in `build.py`.

The three font families ship with SIL Open Font Licenses in [assets/fonts](assets/fonts/): EB Garamond, Inter and JetBrains Mono. GSAP 3.14.2 is vendored in [assets/gsap.min.js](assets/gsap.min.js), preserving its copyright/license header. No stock imagery, voice, or music was used.
