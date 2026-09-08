# Source profile / local artifact integration

Base: `583225ce839fe51876506042e838cde67905fefe` (#26).
Integrate reviewed source profile `03e745d48ba2e149a8ee8e259e8ee777868c3c3b`
(#27) on an isolated branch, never GitHub/main. Preserve both sides' validation
commands and changelog entries. Hermes provider remains its separate PR #25;
this branch does not pretend it is present.

## Acceptance A01–A05

- A01: New runtime profiles.mjs is explicitly allowlisted in the generated local
  archive. All runtime bytes still come from public source; no copied engine or
  new cloud/client mode. Default model and MCP CLI behavior remain unchanged.
- A02: Archive content/hash checks cover the added module; a fresh isolated
  offline install can import the OpenAI adapter and start actual stdio tools.
  Exercise remember/inspect/restart/correct/stale/forget and no-key failure.
  Use no real credentials or paid calls. Record the new archive hash rather than
  reusing the previous archive's evidence.
- A03: Run all artifact, MCP and offline adapter/evaluation tests on Node22.16 and
  Node24, plus the documented plugin/JSON gates. A new installed import regression
  should catch future missing relative runtime modules. No typecheck is defined
  in this JS repository.
- A04: Source-level synthetic quality evidence remains narrow; do not say MCP
  automatically enables the experimental profile. Clearly state that MCP uses
  its existing default, and extraction profile is explicit programmatic opt-in.
  No publication, remote HTTP, automatic capture or real-human adoption claim.
- A05: Freeze verified integration and obtain independent Standards/Spec reviews
  before push/PR. Preserve prior evidence and document exact parent commits,
  tests and artifact hash. Do not merge/publish/deploy or alter user work.

## Integration evidence (2026-09-09)

The local merge preserves both parents' changelog entries, package commands and
CONTRIBUTING gates. Parent one is `583225ce839fe51876506042e838cde67905fefe`;
parent two is `03e745d48ba2e149a8ee8e259e8ee777868c3c3b`. No Hermes provider
implementation is brought into this branch.

The new installed-adapter import regression failed before adding `profiles.mjs`
to the archive allowlist (`artifact_command_failed` from the isolated import
subprocess). The same check passed after that single allowlist addition. It
imports the installed adapter in a fresh process and constructs both profiles
using a synthetic key plus a transport that throws on any network attempt;
it never imports the source checkout or calls a model.

Both Node22.16.0 and24.20.0 passed:

- All eight artifact tests, including installed byte hashes, dependency closure,
  adapter import, actual SDK lifecycle, restart, isolation, stale revisions,
  upgrade/uninstall and ancestor-project protection.
- All 15 MCP tests and all 81 offline adapter/evaluation tests.
- The offline provider lifecycle demo, 31 plugin tests and JSON/version checks.
- Marketplace validation and strict plugin validation.

The separate clean-cache regression passed on Node22.16.0: an unprepared fresh
cache failed its offline install, and explicit public metadata preparation made
the same isolated install pass. No paid provider requests were made.

The new 35-file archive is 44,628 bytes, SHA-256
`d24f9d7bc10fd49ccd8e9853f3534efa6db0fce6ea983fef7f3791aac9cc9b9d`.
Both runtime builds produced that hash. Retained build report:
`/tmp/cairn-local-artifact-uXb5rz/build-report.json`; its adjacent archive is
`cairn-memory-local-preview-0.0.0-preview.1.tgz`. The new runtime module hash is
`519d05fcb2aefc47f2d4d5c887533287114ceb6bb61245d06656726ca1d9da2b`.
These local temporary paths are retained diagnostics, not downloadable releases.
The old archive and its model-backed evidence remain historical evidence.

The documented SDK walkthrough additionally passed all six stages against fresh
offline installs on both runtimes: discovery, remember/inspect, restart/inspect,
correct/stale rejection, `model_not_configured`, forget/empty inspection. Retained
install directories are `/tmp/cairn-installed-preview-VSH9tT` (Node22) and
`/tmp/cairn-installed-preview-MEwPFK` (Node24); synthetic walkthrough stores are
`/tmp/cairn-walkthrough-ggv2Aa/memory.sqlite` and
`/tmp/cairn-walkthrough-K9fJjX/memory.sqlite` respectively.

MCP has no new profile flag and keeps its existing default. The experimental
profile is explicit programmatic adapter configuration only. No semantic recall
was run for this new archive; retained source-profile quality evidence is neither
an installed-MCP extraction claim nor human adoption evidence. Independent final
Standards/Spec review remains the gate before any push/PR.
