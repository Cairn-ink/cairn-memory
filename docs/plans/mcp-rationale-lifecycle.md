# MCP three-source rationale lifecycle

## Frozen scope and sources (2026-10-05)

Implementation base: `8485f04566a7ac43d23912981e1f33e24f2833f3`, branch
`test/mcp-rationale-lifecycle`, dependent on NR #333 and the separately reviewed
clock/timeline integration. Requested/actual worker: GPT-6.1 Sol/high.
Only three new files are allowed: this plan, the MCP lifecycle test and its
stdio fixture. No production, configuration, package, lock, CI or default changes.

The following submitted user receipts are fixed before implementation/execution.
Each is captured separately through `capture_memory`, not admitted or seeded
through a trusted core API. Receipt identity is assigned by the real host/core.

| Batch | Exact submitted text | Expected role in the scripted proposal |
| --- | --- | --- |
| decision | I chose A for my offline field notes. | Current decision A |
| premise | A supports offline work for my field notes. | Separate supporting premise |
| challenge | I checked: A cannot work offline for my field notes. | Later challenge to that premise |
| backup | I keep a paper backup for my field notes. | Unrelated retained rule |

Correction text, used only in the correction history:
`I rechecked: the offline limitation was a mistaken report.`
This explicit correction invalidates the old proposal; it does not certify that
A works offline. Submitted text/roles and scripted relationship assignments remain
untrusted evidence, not authenticated adoption or permission.

## Acceptance frozen before implementation (H1–H8)

- **H1 — Owned lifecycle.** Use `createTestWorkspace`, immediately defer actual
  SDK client/stdio closure, and forward only validated standard `TMPDIR`/`TMP`/
  `TEMP` paths in the explicit child environment. Do not forward credentials or
  arbitrary application/user settings. Account for the SDK's own documented
  default environment. Failure/cleanup errors propagate; no SQL seeding or
  historical cleanup. Verify workspace removal after closing all sessions.
- **H2 — Real entrypoint and graph.** The fixture uses existing
  `createCairnServer` and actual SDK stdio. A scripted extractor/qualifier/relater
  proposes premise → decision (`supports-decision`) and challenge → premise
  (`challenges-premise`), tied to the exact actual receipts. Ordinary host tools
  establish current unchanged A and `reconfirmation-suggested`, not replacement B.
  Capture the independent backup and prove it remains unchanged.
- **H3 — Cold evidence.** Close/reopen the actual server. Scripted select/rank
  derive references exclusively from request-visible catalogs/candidates and
  query, never warm IDs or an expected-source roster. Assert cold returned graph,
  source receipts and rank-input graph agree with the warm observation.
- **H4 — Two histories.** Independently correct or forget the challenge through
  host tools. A stale correction/forget/inspection must fail without changing
  graph or observed memory state. Correction retains the explicit new text and
  receipt; forgetting makes the challenge unavailable through normal reads.
  Restart and prove old challenge evidence is absent from A's rationale/rank
  input while A, premise and backup remain exact. Logical forgetting is not
  physical erasure of SQLite journals/backups.
- **H5 — Unknown stays unknown.** After invalidation, rationale is `unassessed`,
  not confirmation, decision cancellation or operation authority. No
  `bindQualifiedClaim`, `transitionQualified`, direct rationale review or SQL.
- **H6 — Observed ports.** Keyless inspection/correction/forget make no scripted
  model-port calls. Explicit cold recall calls only select/rank. Observe requests
  through bounded, test-only stderr framing, separate from MCP stdout; no real
  provider key, HTTP request or operational ledger.
- **H7 — Preserve capabilities/claims.** Assert existing five default tools and
  seven tools with explicit v2/rationale opt-ins. No automatic enabling, semantic
  accuracy, full M2, lightweight, native Hermes, automatic adoption or score claim.
  Existing installed cold-forget tests already cover simpler graphs; do not
  alter packaging or replicate them as a new installed gate.
- **H8 — Verification/delivery.** Run the focused ordinary SDK suite through the
  canonical owned runner on Node 22.16.0 and 24.15.0 in keyless environments;
  retain any failure and cleanup outcome. Primary inspects the combined diff,
  reruns key paths and applicable full MCP/contributor/artifact gates, then
  separate nonauthors review Standards/Spec on the same fixed base/head before
  dependent PR/latest-head CI. No worker Git/PR/merge/release actions.

## Expected observations and limits

Warm/cold A context contains exactly three source memories and the two directed
proposals; the backup is not a rationale source. Correct/forget removes only the
challenge proposal, leaving the premise→A support proposal and two-source A
context `unassessed`. A's memory/receipts and the backup's memory/receipts do not
change. Stale failures must leave inspected state and graph identical. These are
mechanical host-integration expectations, not real-model semantic judgments.

The native Hermes provider has no rationale capture/profile/inspection setting.
Its possible future explicit cooperative deadline ≤110000 ms is a separate
decision; this packet changes neither its 120-second SDK envelope nor any
production deadline. Historical rationale reconstruction is not exercised.

Implementation and execution are pending at this pre-test contract checkpoint.
Paid/provider calls are zero; scripted model-port calls will be asserted, not
misreported as zero. Real SDK/server/SQLite processes are the intended test path;
no opt-in native Mem0/Hermes execution is included.

### Preimplementation H4 API clarification

Primary confirmed the actual `core/runtime.mjs` `forgetMutation` boundary before
implementation/tests: a revision mismatch on a live challenge rejects mutation
and revision-bearing `inspect_rationale`. After deletion, `inspect_rationale`
and correction reject `memory_not_found`, whereas repeat forgetting succeeds
with `forgotten:false` before any revision comparison and changes nothing.
The correction history also tests actual older refs after its revision increment.
Both histories compare the surrounding A/premise/backup/current graph before and
after each refused or idempotent action. `inspect_memory` has no revision input;
it returns the current record by ID. This clarifies H4 without changing a guard
or inventing a deleted-row refusal.

### Pre-test documentation scope clarification

Primary added one fourth allowed file to comply with CONTRIBUTING's evidence
rule: a compact H-section in `docs/limitations.md` immediately before the
NULL-title section, after existing M2 evidence. The initial three-file scope above
is retained as the historical freeze. This changes documentation scope only;
H1–H8, all sources and expected observations remain unchanged. No ROADMAP gate
or global milestone changes. The section must distinguish ordinary three-source
stdio mechanics from installed/Hermes, semantic or automatic-adoption evidence.

## Retained implementation feedback

The first Node22 focused invocation exited 1 (1 pass / 2 fail of 3,
6,013.862192 ms). Both histories built the intended graph, then returned
`recall_failed`. One narrowed correction-history invocation reproduced the
fixture failure (0 pass / 1 fail, 3,967.519609 ms). Bounded port instrumentation
reported rank's `Cannot read properties of undefined (reading 'startsWith')`:
actual candidate memory fields were exactly `id`, `revision`, `currentness`.
Source-context DTOs intentionally omit generated content, as documented in
`core/source-evidence.mjs`. This was an authored scripted-ranker/expected-shape
mistake, not a product failure. The ranker now sorts using request-visible
receipt excerpts; returned sources assert the closed public projection while
independent host inspection still asserts full unchanged memories/receipts.
Temporary diagnostic instrumentation was removed. No runtime/guard/assertion
criterion was weakened, and both failed observations remain recorded.

The next Node22 invocation also exited 1 (1 pass / 2 fail of 3,
2,810.526667 ms): recall now completed, but the authored expectation read
`currentness` from the inspection DTO instead of its `state:'active'` field.
The source-context DTO explicitly returns `currentness:'current'`. The assertion
now checks both documented representations; no absent field is accepted.

## Worker verification checkpoint (2026-10-05)

Both ordinary SDK histories now exercise all frozen H1–H8 conditions: four
separate source captures, three-source/two-edge rationale, cold recall, strict
live stale-ref refusals, correction or forget and another cold recall with
two-source/one-edge unassessed rationale. Receipt provenance includes the actual
host client/session and deterministic submitted-message event hash. Exact
namespace listing proves no extra replacement memory appeared. Observed relate
inputs contain only local indices, excerpts and roles, not internal source IDs.

Each invocation observes 44 scripted model-port calls across the two histories:
four extract/qualify/classify/relate sequences per history and three select/rank
pairs per history. Inspection and correction/forget add none. All registered
stdio sessions reach actual transport close and stderr EOF with the fixture's
core-close marker; workspace cleanup and owned-root absence are asserted.
Provider/HTTP/paid calls and opt-in native/operational-ledger calls are zero.

| Runtime | Final focused result | Duration |
| --- | --- | --- |
| Node 22.16.0 | 3/3; natural exit 0; zero fail/skip/cancel/todo | 3,648.736931 ms |
| Node 24.15.0 | 3/3; natural exit 0; zero fail/skip/cancel/todo | 2,746.997792 ms |

Final tested SHA-256 bindings:

- `adapters/mcp/test/rationale-lifecycle.test.mjs`:
  `d46b023d6b2f727b70114dd14b00ce2f58a49e5e5feac25acdd44984fea73115`.
- `adapters/mcp/test/fixtures/rationale-lifecycle-server.mjs`:
  `1586c5d6a4346176cf96690b7e5fd09ba6d624d1806e7b72bdc68a5ccd20878a`.

Earlier successful focused runs (4,012.139201 / 3,095.507953 ms) preceded the
final receipt-provenance/source-only input/exact-listing assertions and are not
substitutes for the final table. All initial fixture failures above remain
retained; they do not establish a runtime bug or regrade any historical result.

Run from `adapters/mcp` (substitute `v24.15.0` for the second runtime):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin LC_ALL=C TZ=UTC NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node ../../tools/testing/run.mjs test/rationale-lifecycle.test.mjs
```

No package/install/runtime/configuration/default/timeout/schema changes were
made. Locked SDK preparation belongs to primary. Full MCP/contributor checks,
primary direct final-candidate acceptance, both independent review axes and
dependent latest-head CI remain pending. Worker edits pause at this checkpoint.

## Primary integrated verification checkpoint (2026-10-05)

Historical implementation base remains
`8485f04566a7ac43d23912981e1f33e24f2833f3`; feature checkpoint `d40835a`
was integrated with the accepted timeline dependency at
`1aab63637af2f16bdaa7eb68ae248373d04c505f`. Final review/delivery base is
`9f86dc5e2238767c67379bc51c2901da906039e4`. This integration only merged the
feature dependency: runtime and test bytes did not change, including both final
test/fixture SHA-256 bindings above. Actual author model/effort was GPT-6.1
Sol/high. Primary directly inspected the integrated diff and reran the key paths.

All results below are primary's integrated executions, naturally exiting 0 with
zero failed, skipped, cancelled or todo tests; durations are milliseconds.

| Gate | Node 22.16.0 result / duration | Node 24.15.0 result / duration |
| --- | --- | --- |
| Focused rationale lifecycle | 3/3 / 5,867.737348 | 3/3 / 4,971.348794 |
| Full MCP | 116/116 / 35,411.433684 | 116/116 / 34,185.224539 |
| Affected core timeline + deadline | 22/22 / 20,295.384940 | 22/22 / 20,279.094304 |
| Workspace lifecycle | 25/25 / 20,430.206576 | 25/25 / 20,524.218264 |
| Generic suite | 591/591 / 298,921.219141 | 591/591 / 302,652.560565 |
| JSON/version validation | 10 files + version 0.3.0; exit 0 | 10 files + version 0.3.0; exit 0 |

Locked Claude 2.1.260 marketplace and strict plugin validation both exited 0
against the MCP worktree; the owned validator root was removed. This JavaScript
repository has no typecheck gate. The inherited M2 full-core 1163-test result is
M2 evidence, not a newly executed MCP full-core gate. All worker and authored
fixture-failure history above remains unchanged.

At this dated checkpoint, separate nonauthor Standards/Spec reviews on the
fixed final base/head and latest-head CI are still pending. Existing CI
clean-cache, artifact and installed-rationale jobs are separate gates; no local
result substitutes for them. No artifact runtime allowlist, wire contract,
package, configuration or default changed. This evidence makes no native Hermes,
semantic-quality, full M2 or score claim. Paid/provider calls remained zero;
scripted model-port calls were asserted. No public-main merge, release, deploy
or historical cleanup was performed. Documentation edits pause here for primary
candidate freeze and independent review.
