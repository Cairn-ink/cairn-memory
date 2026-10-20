# Local Raw V1 completion

Status: authorized implementation, not completed acceptance.
Base: `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.
Owner approval: 2026-10-21, local synthetic development/tests/PRs may proceed
before production G1/G2 receipts. Default-off; no real-user data, paid calls,
publication, deployment or operational database migration.

## What "V1 done" means

The goal remains one lightweight, reliable memory engine for MCP and harnesses.
Raw, Memory and private Knowledge Cards belong to the engine; the product
renders and authorizes access to it rather than maintaining a second engine.

The four remaining workstreams complete **standalone local V1** only after
their integrated acceptance passes. Product production readiness is separate.
They do not prove competitive semantic scores, complete automatic knowledge
consolidation, or general real-world reliability. Existing fixed benchmark
results and budgets are unchanged.

| Step | Deliverable | Exit evidence |
| --- | --- | --- |
| 1 | Exact selected/redacted Raw storage, bounded paged reads and usage, then atomic capture integration | Long Unicode messages reconstruct exactly; restart/replay do not duplicate or charge twice; partial sources remain visibly partial; failures leave no partial transaction or leaked text. |
| 2 | Raw source resolution for Memory/Card plus invalidation/deletion/exclusion | Bare Raw can support a Card without inventing a Memory; changing/forgetting support blocks stale current evidence; deletion preserves genuinely independent support; forgotten spans cannot return under new event IDs. |
| 3 | Claude Code/Codex continuation and local setup | Whole-message redaction precedes splitting; interrupted/lost-ack retries preserve identity and finish exactly once; first-part extraction retains existing budgets; unsupported hosts report unavailable, not full capture. |
| 4 | Installed system lifecycle | Actual package plus stdio/new process executes source → Memory/Card → read → correction/forget/deletion; source links, controls and fences survive restart. Product adapter gets the tested revision and its separate joint acceptance. |

Map final evidence to the three-layer contract's T01–T18 and Raw RL-1–RL-3
rosters, including clearly unimplemented capabilities and semantic vs mechanical
evidence. No checkbox is passed merely by another similarly named unit test.
T01–T03 semantic outcomes require separate model evidence; this packet makes
none. Generated summaries/vectors remain unavailable unless separately shipped.

## First packet: P1 internal Raw journal

This is the storage/read foundation **within step 1**, not the whole of RL-1.
Implement in the existing core SQLite store. Do not create another store or
wire a partially protected archive into current capture/MCP/hooks.

Allowed runtime seams: new `core/raw-*.mjs` modules, additive schema opening
in `core/database.mjs`, and an internal attachment in `core/runtime.mjs` if
needed by synthetic integration tests. No new public `openMemoryCore` mutation
or installed raw capability in P1. Its registration primitive is internal and
model-free; it cannot by itself create a Memory or Card. Later P2 integrates it
with capture/admission/episode/control transactions before exposing capture v2.

The internal primitive accepts a trusted exact namespace plus validated v2
message parts and host policy snapshot. Follow the Raw contract for immutable
identity, session HMAC, source text, usage and read DTOs. It must support joining
an enclosing synchronous transaction; no provider/crypto callback runs inside a
write transaction. Async preparation and final control/revision checks remain
separate. A trusted recheck callback is not a model-supplied permission flag.
Use the existing core error types, validation conventions, namespace identity,
owned workspace and file-permission behavior.

| ID | Observable P1 acceptance |
| --- | --- |
| P1-01 | Default open is unchanged. Explicit internal opt-in creates empty v24 records atomically from supported existing stores without fake backfill; option-off new openers preserve them and old openers reject v24. Injected migration failure rolls back. |
| P1-02 | Both supported clients preserve exact selected/redacted text, whitespace, escaping and Unicode over multiple >4,000-unit / >20,000-unit messages. Invalid Unicode/NUL, oversized parts, inconsistent metadata, duplicate ordinal, missing predecessor and wrong final totals fail with fixed errors and no partial transaction. |
| P1-03 | Exact event/part retry, overlapping retransmission and close/reopen return stable identities, consume zero extra bytes and cannot change recorded content/policy. Changed same-identity payload refuses, including when Raw was skipped. |
| P1-04 | Reserve the whole declared message bytes first; concurrent connections/processes cannot overspend an owner-wide cap across namespaces/clients. Over-cap messages are wholly skipped, with no eviction/backfill. Pending reservations survive restart. Existing reservations survive a cap decrease; only new admissions use the smaller cap. |
| P1-05 | Paged reads return whole parts in ordinal/part order within 65,536 serialized bytes. Cursors bind store/scope/conversation/revision/limit/epoch; foreign/malformed/stale cases refuse; missing/foreign content uses the same null shape. Unknown time and incomplete coverage stay explicit. |
| P1-06 | Sealing/opening validates exact AAD and decoded length/bytes; callback failure produces fixed errors without plaintext fallback or exception prose. Snapshot and commit/read-publication fences catch concurrent mutation. Callback inspection proves no write transaction is held. |
| P1-07 | Usage counts saved and reserved UTF-8 bytes, not SQL allocation; reads/duplicate retries do not mutate usage revision. Policy skips persist content-free dispositions and cannot be filled after policy changes. Pending-attempt closure releases reservations exactly once and keeps accepted parts. |
| P1-08 | A forced failure in an enclosing registration transaction rolls back Raw, ledger and usage together. No admission/episode atomicity claim until P2 actually joins those components. |
| P1-09 | Owner/scope isolation, no raw session IDs or text in metadata/error output, and read-untrusted markers hold. Only explicit `local-plain-v1` fixtures are used; no hosted encryption claim. No network, extraction, qualification or model invocation occurs. |
| P1-10 | Synthetic success and failure fixtures clean up via owned test workspaces. Core/generic validation and affected packaging/import gates pass with actual exit codes; key new paths run on Node 22.16 and 24.15. |

P1 does not claim capture-v2 registration, first-part extraction, legacy episode
deletion routing, Raw → Card, installed hooks, hosted encryption, notices,
account erasure or product launch. Those remain required before their capability
can be advertised. The journal must not be used with real data to bypass them.

## Subsequent packet boundaries

- P2: integrate prepared parts with the existing capture/admission and episode
  registration transaction; authoritative pause/project/client controls and
  deletion fences; preserve bounded first-part-only model work.
- P3: source refs/offset mapping and Raw → Card; D5 independent-source deletion,
  D6 forgotten-span exclusions, option-off mutation safety and durable effects.
- P4: both clients, schema/conformance/local setup, then installed lifecycle.
  Complete each packet's independent review before the next dependent delivery.

These are implementation subdivisions of steps 1–4, not additional launch
conditions. Re-scope with evidence if integration reveals a material conflict;
do not silently relax source deletion, permissions or test denominators.

### Next packet's integration checks

P2 must join the real existing registration seams, not call `register()` in a
separate transaction before or after capture and call that atomic:

- Ordinary capture: admission registration in `core/admission-storage.mjs`.
  Exercise no-staging and staged paths; preserve existing payload conflict,
  lease, overlap and ordered-capture behavior.
- Episode capture: reservation in `core/episode-storage.mjs`. Raw and the
  first-part admission reservation/episode observation share one commit; a
  forced failure after either side rolls everything back.
- Preserve Raw after successfully registered input later fails extraction,
  qualification or staging retention. That is different from rolling back a
  failed registration. Report incomplete interpretation separately from saved
  Raw coverage; a saved source is not proof that a Memory was extracted.
- Continuation-only batches invoke zero extractor/qualifier/classifier/episode
  interpretation calls and do not advance the accepted-batch debounce counter.
  Mixed batches process only their new first parts within existing budgets.
- A pause, project stop, client switch or session deletion during asynchronous
  sealing must win before commit. Test restart, replay, lost acknowledgement,
  existing reservations and an abandoned long-message suffix.

Use deterministic scripted models, actual SQLite transactions and independent
new processes first. Keep the internal path unavailable to real capture clients
until source invalidation/deletion/exclusion and installed-client acceptance
are integrated. Public capabilities cannot lead their protection mechanisms.

## Work and verification record

Primary: plan/integration/acceptance. Implementation: one bounded GPT 6.1 Sol
worker, high effort. Independent Standards and Spec reviewers: separate
non-authors on one fixed committed candidate. Requested/actual model and
commands/results will be recorded when known; no model cost is inferred.

### P1 verification, 2026-10-21

Runtime changes remain frozen for final gates and independent review. No review
pass or completed public Raw capability is claimed yet.

| Check | Observed result |
| --- | --- |
| Worker `npm run test:core`, Node 22.16 / 24.15 | Each 1,225 passed, zero failures/skips, actual exit 0. These runs loaded the code before the last barrier and explicit-null corrections; they are not represented as full-suite verification of those two changes. |
| Final `node tools/testing/run.mjs core/test/raw-journal.test.mjs core/test/raw-boundaries.test.mjs`, both versions | Each 27 passed, zero failures/skips, actual exit 0, including the two final corrections. |
| Primary new-process acceptance plus those two final suites, both versions | Each 28 passed, actual exit 0. An independent 47,600-unit / 64,600-byte Unicode message reconstructs exactly from pages after closing/reopening in a new process; retry usage is unchanged, ordinary Memory admission coexists, the actual old opener refuses v24, and the owned workspace is absent after cleanup. |
| Baseline full core, Node 24.15 | 1,200 passed, actual exit 0, at the prior integrated tree identical to fixed main. |
| Generic `npm test`, Node 24.15 | 635 passed, zero failures/skips, actual exit 0. |
| `npm run validate`; installed maintainer plugin validation | Each actual exit 0. The first plugin command exited 1 because dependencies installed with `--ignore-scripts` had no native tool; rebuilding that pinned maintainer dependency resolved setup without repository changes. |
| `npm run demo:store` and `npm run demo:private-cards`, both versions | Each actual exit 0. These retain their explicitly reported synthetic demo databases; they are not test-workspace residue. |
| Final serial `npm run test:mcp`, both versions | Each 125 passed, zero failures/skips, actual exit 0. |
| Final serial `npm run test:artifact`, both versions | Each 94 passed, zero failures, one native Windows-only skip on WSL, actual exit 0. This is the existing installed surface plus its new schema import, not installed Raw capture. |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle`, both versions | Each 25 passed, zero failures/skips, actual exit 0. Includes real successful/failed subprocess cleanup and preserves foreign/replaced roots. |

One actual P1 defect was reproduced before correction: a `capture_barrier`-closed
long-message suffix prevented a fresh higher message ordinal. The new regression
first exited 1 with `raw_part_out_of_order`; the fix permits the fresh message,
while late suffixes remain unsaved gaps and never regain reservations. Explicit
null cap/page-limit values now refuse rather than silently selecting defaults.

The first concurrent full MCP run on Node 24 exited 1 (124 pass, one H4 failure);
the first artifact run on Node 22 exited 1 (93 pass, one H5 failure, one native
Windows-only skip). Preserve both. An independent read-only GPT 6.1 Sol/high
diagnosis used actual stdio against baseline and candidate on both runtimes:
all four ordinary H4 runs exited 0, while a controlled 1,550 ms delay after
initial journal startup made all four reproduce the exact missing-classifier
failure with exit 1. The shared 1,500 ms deadline had already elapsed; an extra
stderr drain did not reveal a classifier call. The six relevant existing files
matched across trees. This establishes a sufficient mechanism on both versions,
not the unrecorded precise timing of the original failure.

H5's 1,000 ms budget similarly includes tokenization/token-count work before the
recorded extract request. A pre-model stdio probe reproduced its empty-stage
signature on both trees, but was not the installed H5 fixture. Serial full gates
follow the completed core load; no runtime or fixture deadlines were enlarged.

Local logs and independent acceptance are retained at
`/tmp/cairn-raw-p1-evidence.rktEiy`; the worker full-core records there are clearly
labelled final-console-summary excerpts, not full logs. Controlled diagnostic
logs are at `/tmp/cairn-mcp-h4-diagnosis.A2O1Rk`. No real data or model calls were
used. These local paths are reproducibility aids for this session, not portable
test dependencies; checked-in P1 tests use the owned-workspace runner.

Primary cross-checked the changed-file inventory by `git diff --name-only` plus
untracked files and independently by Git porcelain status: 17 files agree,
including plans, limitations, testing support and the packaging manifest.
The frozen old opener also matches the actual base byte-for-byte after removing
its two explanatory comments and relocating imports. An initial verifier
handled only single-quoted imports and exited 1; correcting the verifier to
handle both quote forms exited 0 without changing the fixture.

The reviewed candidate and independent Standards/Spec results will be recorded
in the delivery PR, followed by latest-head CI evidence. Local commands are not
a substitute for that final delivery gate.

## Existing contract coverage, before this packet

This is an implementation coverage audit at the fixed base, not new test results.
The existing private engine evidence is in
[`private-engine-v1-completion.md`](private-engine-v1-completion.md) and PRs
#447/#448. Each remaining observation must be exercised again on the integrated
Raw candidate before marking that row complete.

| Three-layer rows | Existing bounded behavior | Remaining observation |
| --- | --- | --- |
| T01–T03 | Existing decision/relation/temporal primitives and retained evaluation results | End-to-end meaning and source-link accuracy; four engineering steps do not establish a new semantic score. |
| T04, T17 | Note/receipt identities exist, but no persistent Raw refs | Exact Raw spans survive unrelated append/filing, while exclusions invalidate the right source. |
| T05 | Exact-scope private Memory/Card access and mappings | Apply the same isolation tests to Raw, continuations and source resolution. |
| T06 | No generated topic-summary capability | Keep unavailable; never fabricate a tested summary cache. If added, source/version invalidation becomes mandatory. |
| T07, T09 | Memory revision invalidates dependent drafts/current evidence | D5 independent-source deletion and D6 retained-Raw exclusions, including changed event IDs and option-off writes. |
| T08, T10 | Local authored Card CAS, content-free replay, purge and effects | Re-run with Raw source loss/deletion; no claim about unimplemented asynchronous model drafting or hosted publication. |
| T11 | Typed organization and reversible mappings | Re-run against the combined candidate; MOC remains navigation, not permission. |
| T12 | Explicit submitted-note route and excerpt-backed drafting | Bare Raw → Card without a Memory or invented note, including exact source identity and exclusion checks. |
| T13 | Ordinary capture/Memory confirmation does not create Cards | Preserve this invariant through new capture v2 and both clients. |
| T14 | Installed bounded note/receipt Card lifecycle and terminal confirmation | Repeat with the completed Raw path in actual installed processes/new sessions. |
| T15 | Bounded typed reads and current-source revalidation | Long multipart Raw, cursor/byte bounds and sealing failures. |
| T16 | Owned temporary-workspace infrastructure | Every new success/failure fixture must participate; no historical cleanup. |
| T18 | Existing trusted-action/final-evidence fences | Add Raw prepare/open/commit races and eventual product-adapter checks. |

Product issue #453 now records this development exception at
https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6298041894.
Product #490 is a separately owned local adapter, not approval to migrate or
deploy. Its capacity/import/multi-namespace and hosted gaps stay explicit;
completion of this journal does not close those product requirements.
