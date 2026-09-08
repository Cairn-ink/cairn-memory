# Source profile / local artifact integration

Base: `583225ce839fe51876506042e838cde67905fefe` (#26).
Integrate reviewed source profile `03e745d48ba2e149a8ee8e259e8ee777868c3c3b`
(#27) on an isolated branch, never GitHub/main. Preserve both sides' validation
commands and changelog entries. The final integration also incorporates reviewed
native Hermes provider `e63ad0af68888656118e02ec1aecc37114a197fc` (#25), so its
actual pinned-host lifecycle can be verified against the new artifact together.

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
- A06: Preserve reviewed Hermes provider behavior, and run its actual pinned-host
  five-test lifecycle suite against the new installed artifact on both Node
  versions. No paid calls, full chat or new automatic capture claim. Distinguish
  historical real-model proof from this fresh no-key integration proof.

## Integration evidence (2026-09-09)

The local merge preserves both parents' changelog entries, package commands and
CONTRIBUTING gates. Parent one is `583225ce839fe51876506042e838cde67905fefe`;
parent two is `03e745d48ba2e149a8ee8e259e8ee777868c3c3b`. This first integration
candidate was `a221a27e507972ac6e8b51682e237725554c3b7b`. The subsequent local
merge adds the already reviewed native Hermes provider, preserving both
changelog additions; its new-artifact verification is recorded below.

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

## Native provider integration verification

The DRI also integrated reviewed Hermes provider commit
`e63ad0af68888656118e02ec1aecc37114a197fc`. No provider implementation was
rewritten. The pinned Hermes 0.21.1 host at upstream commit
`c8aa5608c24e3636e77c267650c0f1f52e44adb0` ran its canonical
`scripts/run_tests.sh` against `integrations/hermes/test/test_provider.py`,
with the installed executable and Node runtime passed explicitly.
All five tests passed on Node22.16 (22.9 seconds) and Node24.20 (20.0 seconds).
They exercise actual provider discovery/MemoryManager, profile identity,
reopen/correction/forgetting, key isolation, inert unsupported contexts and child
cleanup against the new archive. These are no-key integration tests; historical
model-backed provider evidence retains its original archive scope.

After that merge the DRI independently reran all 23 artifact/MCP tests on both
Node versions and JSON validation. Both rebuilt archives still have SHA-256
`d24f9d7bc10fd49ccd8e9853f3534efa6db0fce6ea983fef7f3791aac9cc9b9d`:
Hermes plugin files are installed separately and do not change the npm archive.
