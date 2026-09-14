# Capture-to-basis loss localization

Fixed base: `2e8aa3c2445fdf4784e189ba9b16d23f956dd568` (PR94 merged).

## Acceptance

- A bounded synthetic driver exercises actual source-window capture, closes and
  reopens the store after every window, then recalls source evidence through MOC.
  It must not manually admit ideal memories or preselect model refs by rubric.
- Compare recalled refs with a simple lexical source baseline and all captured
  current source refs (oracle control), all through the same original basis port.
  If all sources exceed the six-ref port cap, mark oracle unavailable instead of
  silently choosing favorable sources. Empty recall is missing evidence, not a
  successful semantic result. Failed capture must remain visible downstream.
- Use only newly created temporary SQLite stores; no credentials, implicit
  provider calls, mutable defaults, production data, or automatic retry. A live
  caller still requires separately pinned artifact, guarded transport and budget.
- Retain raw captures, warm/cold snapshots, recall and basis envelopes, source-ID
  coverage and missing source IDs separately from semantic judgments. Never send
  required source IDs or rubric metadata to any model method.
- Preserve evidence for capture omissions, select omissions, rank omissions,
  exact-but-wrong basis output, and failed basis output in scripted regression
  tests using the real shared core. Do not equate scripted tests with quality.
- Verify Node22.16/24 live-evidence offline suites and generic/JSON/strict plugin
  checks, plus independent dual review. Paid experiments are a later gate.
