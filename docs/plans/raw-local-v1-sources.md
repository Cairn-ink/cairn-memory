# P3c — retained Raw support in the existing private Card engine

Status: frozen-source offline verification complete; fixed-candidate review and CI pending.
This is an internal packet, not a shipped Raw capability or complete local V1.
Fixed base: `50230c0390a0e035b8d15f0cdeb9c335f97e3ffb` (reviewed P3b;
PR #452 has 31/31 latest-head CI checks successful, ready and unmerged).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-v1-sources`.
Branch: `feat/raw-local-v1-sources`. This explicitly dependent branch does not merge
or change the product pin `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`. Reuse the three-layer contract §2–7 and the approved
local/synthetic exception. Do not expand to live data, installed host exposure,
model-assisted drafting, product UI or production adoption.

## Outcome and one-engine boundary

An authorized caller can resolve exact retained Raw spans to core-owned source
references and explicitly create an authored private Card from those references.
No Memory, submitted note, model call or copied Raw document is manufactured.
Existing Memory/receipt-backed Cards remain interpretation-dependent. Existing
notes/receipts, their synchronous signatures and strict default facade remain
compatible. No input automatically becomes a Card.

Use an internal opt-in source capability through `openRawCaptureCore` with the
existing trusted private Card authority. Its own boolean selector implies the
completed lineage/deletion schemas; public constructor/wire input cannot select
it. One additive migration, frozen prior opener rejection, no backfill. Allow
only the static import closure in packaged ordinary writers; this does not
advertise installed Raw capability.

## Acceptance to pin before actual dispatch

| ID | Observation |
| --- | --- |
| P3c-01 | Internal-only selection is strict and migration atomic. Default public options/methods/capabilities stay compatible. Current option-off/pre-upgrade handles enforce retained source invalidation without selecting a reader or crypto port. |
| P3c-02 | `resolveSourceReferences({namespace,anchors,budgets?},authority)` resolves all 1–16 explicit `{rawAnchor,expectedConversationRevision}` entries or fails without partial refs. Exact namespace, positive coarse revision, retained contiguous UTF-16/code-point spans, saved availability and D5/D6 are mandatory. Unknown/foreign/deleted/skipped source is unavailable, not guessed. No substring lookup, normalized offset or fabricated complete message. |
| P3c-03 | Core-keyed opaque identity binds store, purpose, scope, conversation/message, selected span and immutable retained content. Unrelated Raw append stales a coarse resolution snapshot but cannot invalidate an already-resolved unchanged source identity. Filing/reclassifying a locator Memory likewise is not source loss; actual exclusion/deletion is. Cross-store, cross-scope and tampered refs fail. |
| P3c-04 | Async Raw opening and host authority callbacks run outside SQLite write locks. Snapshot only selected parts, open/verify through the existing port, then recheck canonical bytes/metadata, coarse revision, exclusions and current authority with no callback between final check and return/commit. Exercise caller mutation, port failure, async deletion/exclusion/append and authority revoke. No stale plaintext or source handle escapes. |
| P3c-05 | Retained reads remain permitted while capture is paused/raw-off; capture policy is not read authorization. A missing opener fails for source text/identity preparation, never re-enables capture or fabricates missing text. Explicit host Card read authority is still required. |
| P3c-06 | Raw `getSource` returns only the selected span, absolute original `{start,end,text}` offsets, code-point boundaries, parts <=4,000 UTF-16 units, accurate coverage and a scoped bounded cursor. Partial conversation versus complete selected span are distinct. No surrounding text; changed/excluded source invalidates continuation. |
| P3c-07 | Explicit authored Raw Card creation reuses the private Card storage, action ledger, authority, confirm/edit/cancel/delete and typed evidence/MOC paths. Exact replay remains a content-free receipt after source loss, not a resurrected Card. Raw support has separate typed bindings, never a fake note/receipt/Memory foreign key. Required support is validated canonically by every read/write/evidence path. |
| P3c-08 | D5 conversation delete and D6 overlapping exclusion transactionally cancel/purge dependent drafts, block pending prepared creation, and invalidate current evidence. Confirmed authored body remains owner-private and qualified unavailable, not current evidence. Source-free operation receipts/effects are stable; disjoint spans and other scopes remain eligible. Source mutation failure rolls Card changes back with Raw/Memory changes. |
| P3c-09 | Source-only Raw support can survive an unchanged permitted locator interpretation/filing revision. Existing receipt-backed support retains its current Memory revision dependency. Demonstrate both paths side by side, including duplicate provenance that is not counted as independent corroboration. |
| P3c-10 | Persisted raw bindings are visible to ordinary current writers after restart, including no selected Raw reader. Canonical support checks never silently ignore unknown/new source types. Current evidence/organization snapshots stale after source loss. The active store cannot be opened by the actual frozen prior-version writer. |
| P3c-11 | Numeric bounds are observable: one shared per-call scan/open/response budget across all anchors, not one allowance per anchor; no unlimited tiny-part scan or source-open fallback. Raw-dependent live Card fanout is finite and enforced before creation/rebinding. Boundary+1 fails with no partial Card or orphan binding/action success. |
| P3c-12 | Independently constructed primary cases cover both capture clients, Unicode/redaction, exact/whole-message and partial saved sources, real restart/separate connections, authority/scheduling races, all source-consuming Card/evidence paths and rollback. Focused/full repository gates on both runtimes, cleanup proof, double mechanical inventory, frozen exact commit, independent Standards/Spec and latest-head CI precede delivery. |

## Finite execution policy — primary decisions after read-only seam audit

Apply contract budgets to actual work, not just returned text: defaults
sourceByteLimit 16,000, scanRowLimit 128, deadlineMs 1,000; maxima 64,000/1,024/5,000;
responseByteLimit default/max65,536. All anchors share the allowances. Only
overlapping saved parts are opened, each at most once per call. Charge full
opened-part bytes against sourceByteLimit because a one-unit selection still
requires opening the enclosing sealed part; selected text has its own output
bound. A documented fail-before-open on insufficient known metadata budget is
preferable to opening then falsely reporting a cheap read. Source byte limits
do not promise wall-clock latency for an uncooperative external crypto port.

Raw fanout: at most128 live draft/confirmed Cards per conversation,
counting unique Card IDs across all its span bindings. This permits one bounded
conversation-delete/overlap invalidation, not128 per anchor multiplied without
limit. Check all involved conversations inside the same creation/rebind
transaction, excluding the Card currently edited. Cancelled/deleted Cards free
live capacity. Raw bytes continue to count once in the existing owner ledger;
bindings do not silently create a second retained-text copy.

Compatibility: existing note/receipt methods remain synchronous. Raw resolver
and Raw `getSource` are explicitly async in the opted-in factory. Authored Card
mutations remain synchronous: a previously minted identity authenticates exact
span bounds and a bounded immutable retained-part manifest, including keyed
content digests, sealed-byte fingerprints, format and key version. Recompute
that manifest and current D5/D6 authority inside the actual Card transaction.
Only the async resolver can mint it after verified decoding/code-point checks.
An append or locator filing is not part of the content identity. Re-encryption
invalidates the old identity in this packet; it needs explicit re-resolution,
not a fallback or an asserted key-rotation guarantee. No hidden model call or
background retry is permitted.

Use own boolean `rawOptions.sources:true`, implying deletion and lineage, only
in the uninstalled factory and only with existing trusted private-Card authority.
Schema 28 adds typed Raw bindings and transactionally persistent invalidation;
freeze the actual v27 opener. Ordinary public capabilities remain unchanged.
On a selected store, old-mode calls encountering a required Raw-backed Card
fail `source_unavailable` before producing an unsupported DTO. This applies to
get/list/evidence/organization reads and source-consuming writes; do not silently
omit a row and claim completeness. Cancellation, deletion and content-free action
inspection remain available by ID. Replaying an input containing Raw refs still
requires the opted-in facade (the ordinary strict facade rejects that input);
the original content-free action result remains inspectable without a Raw
reader. Record this deliberate mixed-store browsing
limitation. DB-only invalidation applies even through those old-mode handles.

Raw-only getSource accepts `{namespace,source,limit?,cursor?,budgets?}`;
note/receipt calls retain their original strict fields and reject `budgets`.
The Raw-only budgets allowlist is exactly `sourceByteLimit,scanRowLimit,
deadlineMs,responseByteLimit`, with the numeric limits above. Unrelated common
evidence budget knobs are not implicitly accepted. Limit defaults to 20/max50.

Raw continuation cursors bind the exact normalized budget settings and trusted
host access generation as well as store, scope, source identity and page limit.
Changed settings fail `invalid_cursor`; changed access generation fails
`cursor_stale`, before opening source text. A cursor is never an authorization
grant. The source content identity itself remains independent of generation.

Resolver coverage is `{status:'complete',included:<anchor count>,omitted:0,
conversationCoverage:'unknown'}`. Raw getSource coverage is
`{status:'complete'|'budget_exhausted',completeness:'selected-raw-span',
conversationCoverage:'unknown',included:<returned part count>,omitted:0|null}`.
`complete` means the requested span traversal, not all submitted conversation
text. `precision:'whole-message'` still requires the entire message saved.
Card evidence containing only Raw refs uses `completeness:'selected-raw-span'`;
mixed source kinds including Raw use `completeness:'mixed-sources'`, keeping per-ref types and
existing `corroboration:'not-assessed'`. Do not claim duplicate sources constitute
independent evidence. Old note/receipt-only completeness stays byte-compatible.

Use fixed `source_budget_exceeded` when an all-or-nothing source preparation
cannot fit its byte/row budget, `source_timeout` when its explicit deadline has
expired, and `context_item_too_large` when an indivisible response cannot fit.
Both new codes are nonretryable; document them in the finite internal API.
Paged reads may stop at a whole part with budget_exhausted/continuation, but
cannot return a zero-progress cursor or a partial identity. No promise can bound
an uncooperative port's own execution; recheck the deadline on its return and
discard output when expired.

Before loading sealed BLOBs, query bounded part metadata and `length(sealed)`.
The approved formats have exact sizes: local-plain-v1 is byte_count;
envelope-aes-256-gcm-v1 is byte_count+28 (12-byte nonce+16-byte tag). Reject an
invalid size as `raw_crypto_unavailable` before loading/opening the payload.
Charge the full plaintext byte_count of each unique opened part; bounded row
count also bounds encryption overhead. Query by indexed conversation/message/
start with a limit/sentinel, rather than scanning an arbitrary message prefix.
Add the exact `(conversation_id,message_id,start)` index in schema 28: locate
the immediate predecessor at the selected start and then the bounded indexed
range. A predicate on `end` alone must not scan an arbitrary preceding prefix.
This P3c guard must not silently widen source scopes or accept a new crypto
format. Existing whole-conversation reads need not be redesigned in this packet.

Primary decision after implementation seam review: every Raw `getSource` page
authenticates the complete selected SourceRef manifest within that caller's
`sourceByteLimit` and `scanRowLimit`. Charge each unique touched enclosing part
once across snapshot, final canonical recheck and opening; an internal fixed
64,000-byte bypass is not allowed. If metadata proves the whole selected manifest
cannot fit, fail before loading sealed BLOBs or calling the opener. Paging bounds
returned/opened plaintext, not the size of whole-ref identity validation. A
selected source over the default 16,000-byte budget therefore needs an explicit
larger allowance even with `limit:1`, up to 64,000. A tiny page is not claimed
to make authentication of a larger selection cheap. No persisted validation
cache, duplicate text or alternate identity engine is introduced in this packet.

Audit completed by the implementation worker read-only on frozen P3b: same Card
engine and synchronous authored writes are feasible. Primary owns these final
policy choices; implementation proceeds only in the recorded isolated worktree.

### Compatibility details from primary seam inspection

Use the already specified RawSourceRef exactly: `{type:'raw',namespace,
conversationId,messageId,span:{start,end,precision},contentIdentity}`. Do not
add a fabricated sourceId, Memory revision or note completeness. Binding IDs
and duplicate checks use a stable core-keyed identity of the typed conversation,
message and exact span; two different spans in one message are not duplicates.
Exact duplicate refs are invalid input. The content identity remains core-keyed
and covers the immutable retained-part manifest; source and binding identities
do not establish independent corroboration.

Existing `authorize`/`isCurrent` host callbacks remain **synchronous** and must
reject Promises as before. Only opening Raw is async. Snapshot/freeze the strict
input first, bind the same trusted request fields and payload digest, authorize
and check generation before opening, then recheck host generation after awaits,
outside locks. Finally check canonical DB state without another callback/await
before returning. No new serialized grant or authority schema is introduced.
An internal Raw `getSource` returns a Promise; existing note/receipt getSource
continues to return the same synchronous envelope. Internal capability may
advertise `raw:true`, the added raw source type and resolver method; ordinary
capability must remain byte-compatible, with `raw:false`.

Canonical synchronous Card validation must enforce the existing aggregate
64,000-byte source-input ceiling across required sources. Count enclosing
retained part bytes conservatively when selected-span UTF-8 size cannot be
obtained without opening; disclose the bound. Avoid a fresh 64,000-byte
allowance for each of sixteen refs. Shared/overlapping parts may be deduplicated
by their exact canonical identity, never by equal plaintext.

Do not include mutable message assembly state or conversation revision in an
exact-span content identity. Completing the rest of a partially saved message
must preserve a previously resolved unchanged prefix. Whole-message eligibility
is still checked canonically. Re-encryption behavior remains as specified above.

Confirmed Raw bindings cannot require a live Raw-row foreign key: D5 purges that
source while retaining the authored Card's qualified owner-private history.
They retain only bounded typed metadata, not source text. Draft purge removes
its bindings. Deduplicate one source mutation's invalidation across multiple
overlapping spans of the same Card, and include all resulting revision/effect/
index updates in the source transaction. Use the current ordinary writer's
schema-presence guards, including already-open-before-upgrade handles; external
host cleanup and a best-effort later scan are not enforcement.

Keep the existing note-only usage projection byte-compatible; its Raw projection
is not implemented there. The opted-in caller uses the already separate
`getRawUsage` for actual saved/reserved Raw bytes. Do not claim a newly combined
note/Raw owner cap or double-charge source-only Card bindings. Changing the
approved note-retention/accounting policy is outside this packet.

Primary initially prepared 16 independent actual-API acceptance cases (eight per
client) outside the repository before implementation, expanded to 30 (15 per
client) during foundation work, then to 32 with two independent overlapping-range
budget cases. Syntax validation exits 0; the first corrected working checkpoint
passes 30/30 on Node 22.16.0, actual exit 0. This is not final frozen acceptance.
Cases cover bare Raw → authored
Card/evidence/restart with zero invented Memory/note; immutable prefix support
across completion; D5 lifecycle/replay; shared actual-open budgets; authority
revocation and caller mutation while opening; locator filing versus D6 through
an already-open option-off handle; and a late whole-transaction rollback.

Additional cases cover exact Unicode pagination, forged/cross-store references,
whole-message completeness, retained reading with capture off, append/deletion
during opening, malformed sealed sizes rejected before opening, Card MOC/current
evidence invalidation, old-mode source-consumer refusals and delete-by-ID, and the
128-unique-live-Card fanout boundary across overlapping span bindings.

## Audit questions before work starts

1. Identify every source consumer (inspect/mutate/evidence/organization/lineage),
   and who owns each final canonical check; no second Card engine.
2. Explain which immutable metadata can synchronously validate a minted source
   after a prior async opening, and which operation must reopen plaintext.
3. Pin actual method DTOs, coverage/error shapes and numeric bounds against
   existing strict facade compatibility before implementation.
4. Reuse source mutation transactions for Raw invalidation and preserve D5/D6;
   do not rely on a best-effort post-commit scan or only check at answer time.
5. List changed installed static import closure separately from the uninstalled
   capability. No product pin change or new issue until delivered evidence.

## Ownership and delivery record

One bounded implementation worker, `/root/raw_p2_capture_impl61`, actual GPT 6.1
Sol/high, owns core runtime/tests/fixtures and minimal source API documentation.
The primary owns this plan, completion plan, integration decisions and independent
acceptance. Separate non-author GPT 6.1 Sol/high Standards and Spec reviewers
inspect the same final committed diff. No paid/model calls, real-user databases,
installed Raw exposure, release, deployment, merge or product pin change.

Required order: typed persistence and bounded reader → existing Card/source
consumers and transactional invalidation → primary integration acceptance →
Node 22.16.0/24.15.0 focused/core/generic/plugin/MCP/artifact/installed rationale/
workspace/demos → exact freeze, independent review and latest-head CI. Each
claimed pass records its actual exit code and cleanup; retained failures remain
visible. No semantic score follows from these scripted integration checks.

2026-10-21 initial primary evidence: two selected bare-Raw acceptance cases ran
on the frozen P3b base, not the changing implementation. Both registered Raw
successfully then failed at the absent resolver (`target[method] is not a
function`), 0/2, actual exit 1. This is the expected pre-feature red. Local
primary cases and evidence are under `/tmp/cairn-raw-p3c-evidence.n7PShP`; no
scratch path is a dependency of checked-in tests. All three isolated dependency
installs (`npm ci --offline` under Node 24.15.0) and owned-runner public package
metadata preparation exited 0 without changing tracked lockfiles.

Approved installed closure is limited to `raw-source-schema.mjs`,
`raw-source-input.mjs` and `card-raw-sources.mjs` plus their existing ordinary
writer callers. The async reader/factory remains uninstalled. Worker owns the
corresponding `packaging/artifact-files.json` update and affected artifact tests.

Primary working diagnostic record (2026-10-21): the initial 30-case run passed
28 and failed two D6 disjoint-source assertions, actual exit 1. The primary fake
extractor incorrectly read `input.messages[0].id`, but the real normalized model
input is `{index,role,content}`. Both synthetic interpretations became the same
string and intentionally deduplicated to one Memory. A separate two-case run
failed before deletion on an explicit distinct-ID assertion (exit 1), proving
the fixture precondition was false. Reading `.content` and retaining that
distinct-ID assertion produces 30/30, exit 0; no runtime behavior was relaxed.
The owned parent workspace was empty and removed after both full runs.

A separate actual runtime defect was reproduced before correction: partially
overlapping anchors `[0..10,0..4500]` on two stored parts fail with an allowance
of two unique rows (both clients, 0/2, exit 1). Reversing the order permits the
large-first pair, while the small-first pair still fails; a diagnostic allowance
of three permits both with exactly two opener calls (2/2, exit 0). That control
is not the fix: primary acceptance is restored to two rows. Cached prefix rows
are being queried/count-charged again when extending a selected range. The
worker independently reproduced overlapping extensions and implemented a bounded
uncovered-range traversal plus tracked left/right-extension and cached-island
regressions. Its full bounds suite passes 15/15, actual exit 0 on Node 22.16.0.
Primary's original two-row acceptance now passes within its full 32/32 suite,
actual exit 0 (`working-overlap-corrected-primary-22.16.0.log`), with an empty
owned parent removed after completion. Original failure logs and controls are
retained under the primary evidence directory above. These are still working
checkpoints, not fixed-commit delivery evidence.

The pre-freeze legacy compatibility probe then confirmed another required D6
case: actual frozen P2 keep on schema25, from already-saved Raw A into a
cross-client consumer B, stamps the kept receipt with B and has no v26 lineage.
After upgrade and authored source-only A Card confirmation, an already-open
option-off `forget` initially returned success with zero A exclusions and an
eligible Card. Both clients fail (0/2, actual exit 1,
`worker-source-legacy-red22.log`). This is a runtime defect, not the earlier
primary fixture error. Correction is scoped to using the existing P3b proven
keep-origin authority before the normal tuple fallback, with the existing
span maps/conservative whole-message fallback. Missing or ambiguous keep proof
must refuse before mutation, never guess a consumer, union or textual match.
The worker owns regression coverage for this shared D6 seam and its rollback;
ordinary nonlegacy/no-Raw behavior stays compatible.

The corrected legacy suite now passes all six cases on Node 22.16.0, actual
exit 0: both clients, forget/correct, and missing recorded keep authority with
whole-transaction rollback. The first correction run was 4/6 (exit 1) because
two new correction fixtures used admission fields instead of the existing
strict correction DTO; fixing those fixtures did not relax validation. The
original runtime failure and fixture failure remain in their separate logs.

Before the full primary matrix, implementation bytes are frozen and independently
inventoried: the base diff plus untracked paths and a separate base-tree/blob/
filesystem comparison agree on 30 changed paths, including 26 non-document
paths. The actual frozen v27 opener matches its fixed-base source exactly after
the documented header/import relocation: 22,229 bytes, SHA-256
`89fed2bc36c1555c6cf8042cb24f727149965ccf434b0bbebdab79e086e879bd`, actual exit 0.
The worker's 15 affected suites pass 276/276 on Node 22.16.0, actual exit 0,
with no skips. Full final matrix, fixed commit, independent reviews and remote
checks are still pending; a working checkpoint is not completed delivery.

The subsequent actual-P2 differential probe found a separate compatibility
regression: after an ordinary cross-client keep with no retained Raw, deleting
the consumer episode removes its recorded keep-source proof. Frozen P3b still
allows ordinary forget/correct, while the P3c candidate refuses all four
client/operation combinations with `raw_lineage_unavailable`. The probe asserts
an active Memory and exactly zero target-namespace Raw conversations: four
baseline passes and four candidate failures, actual exit 1. This is a real
regression, not a fixture failure (`worker-no-raw-legacy-first22.log`).

Bounded correction acceptance before implementation:

- With no Raw conversations in the exact owner/scope/project namespace, both
  clients' ordinary legacy keep memories remain forgettable and correctable
  after their consumer episode is removed, including after schema upgrade.
- Retained Raw in another namespace must not block those operations or change
  that other namespace's data. Assert both preconditions and resulting states.
- When Raw exists in the target namespace, absent or ambiguous recorded keep
  authority still refuses atomically; never infer roots from text or recency.
- Preserve direct stored lineage, retained-Raw exclusion and authored-Card
  invalidation. Existing six legacy tests and affected lineage/deletion/Card
  suites remain required alongside the new ordinary-memory regression cases.

The same bounded implementation worker owns only the lineage seam, its tracked
legacy regressions/fixtures and minimal limitations/API documentation. The
primary retains plan ownership and will rerun independent acceptance. The old
candidate matrix is intentionally interrupted before editing: Node 22's 22
commands and Node 24's primary/focused/core commands completed with actual exit
0; Node 24 MCP received deliberate SIGTERM through its owned runner (exit 143),
then the matrix stopped (exit 1). The interrupted invocation's owned parent was
empty and removed. Retain all logs and the old source freeze; they are not final
evidence for the corrected source. Freeze and verify a separately named new
round before commit and independent review.

Primary added twelve independent compatibility cases using the actual clean P2
public capture/keep, a runtime-created same-client consumer and a current ordinary
handle opened before the Raw upgrade. They assert the missing consumer-source
proof, active Memory, zero target Raw, and zero/one foreign Raw conversations
before attempting forget/correct. All twelve reproduced the same refusal before
the scoped correction (actual exit 1). Initial fixture development instead
deleted the sole source episode (legitimately deleting its Memory) and omitted
the synthetic foreign-capture token counter; those failed preconditions were
corrected before identifying a runtime regression.

The first combined post-correction primary run was 38/44, actual exit 1,
`compat-working-primary-22.16.0.log`. All operations succeeded; six correction
cases then failed an overbroad unchanged-table assertion: an explicit replacement
must legitimately record its one new independent receipt origin. The assertion
now allows exactly that returned receipt ID with `kind: independent`, while
requiring every other Raw table/row to remain unchanged. This is a fixture
correction, not a runtime relaxation or permission to ignore arbitrary changes.
The original 32 source/Card cases remained passing. The owned parent was empty
and removed after this failed command.

The corrected compatibility candidate passes the worker's 15 affected suites,
288/288 on each Node 22.16.0 and 24.15.0, actual exits 0. Primary's combined
44-case acceptance passes, actual exit 0, after checking that the explicit
replacement origin is the only permitted table difference. The new
`compat-final` freeze records 26 non-document paths and both primary suites;
no implementation edit occurred during that matrix.

That matrix stopped on its Node 22 full-core command: 1,613/1,614, actual exit 1,
with no skipped tests or owned scratch residue. The only failure is the existing
`D2/D3 output serialization crossing expiry rejects before admission` case:
the capture returned the expected `model_timeout`, but `serialized` was 0, not
1. The test expects a 500 ms invocation budget to reach a serialization hook
which then pauses 700 ms. The deadline/model-call/test files are unchanged from
the fixed base. A separate minimal owned-runner invocation of that exact case
passed 1/1, actual exit 0; that alone does not explain or dismiss the failure.
The complete failed matrix/log is retained. Bounded read-only differential
diagnosis is in progress before another full gate round; no deadline or
production behavior has been relaxed to make a test pass.

The read-only differential loop now demonstrates the same timing-sensitive
premise on the actual P3b base and P3c on both runtimes. Keeping the original
500 ms deadline/700 ms serialization hook, adding only a 600 ms pre-output delay
reproduces `serialized=0` and `model_timeout` in both. Without that delay each
enters serialization in roughly 13–24 ms and correctly expires there. Each
runtime reports four passing controls/four exact-assertion failures, exit 1;
the unmodified P3b selected test separately passes 1/1, exit 0. No Memory,
receipt, initial-classification or MOC rows are created; the expected
content-free pending admission claim remains. The original full-run expiration
point was not instrumented, so this is not proof of its exact scheduler history.
The probe's first run queried a nonexistent extra table and failed in its
instrumentation; it is retained separately from the corrected differential.

The host reports 32 available parallel slots. A new `compat-bounded` matrix
therefore retains the identical frozen source, full test roster, assertions and
product deadlines while running `npm run test:core -- --test-concurrency=4`.
Only local test-file scheduling changes; all other gates retain their commands
and remote CI retains the repository configuration. The original failure is not
erased or counted as a pass. The two source inventories still agree: 30 changed
paths, 26 non-document paths, frozen-v27 exact match, actual exit 0.

Supervision caught a harness-only scheduling mistake in that first bounded
attempt: npm appended the Node option after all expanded file names, and seven
test-file children were still active despite the requested four. The primary
stopped the verified owned runner via SIGTERM (core 143, matrix 1), checked empty
scratch/removal, and retained that interrupted round. The corrected
`compat-scheduled` invocation puts `--test-concurrency=4` before the entire
`core/test/*.test.mjs` roster in the owned runner. The roster is independently
cross-checked from directory entries versus Git tracked/untracked matches; no
file is excluded. Production source, tests and deadlines remain unchanged.

### Final offline matrix before candidate commit

The corrected `compat-scheduled` matrix is complete:44/44 commands have actual
exit0, signal null and empty owned scratch; the matrix process itself exits0.
Both Node22.16.0 and24.15.0 use the same frozen26 non-document paths and primary
suites. The two inventory routes still agree on30 P3c paths (77 cumulative
paths against main), and the actual frozen v27 opener still matches exactly.

| Gate, per runtime | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| Independent primary acceptance | 44/44, exit0 | 44/44, exit0 |
| Five new source suites | 60/60, exit0 | 60/60, exit0 |
| Full104-file core roster, concurrency4 before files | 1,614/1,614, exit0;474.286s | 1,614/1,614, exit0;467.560s |
| Generic npm test | 635/635, exit0 | 635/635, exit0 |
| MCP actual stdio | 125/125, exit0 | 125/125, exit0 |
| Existing installed artifact | 94pass,1native-Windows skip, exit0 | 94pass,1native-Windows skip, exit0 |
| Installed synthetic rationale | 4/4, exit0 | 4/4, exit0 |
| Workspace lifecycle | 25/25, exit0 | 25/25, exit0 |
| JSON and maintainer plugin validation | both exit0 | both exit0 |
| Twelve required synthetic demos | all exit0 | all exit0 |

All eight owned lane parents are verified empty and removed. No test process
from this matrix remains running. No test deadline, assertion or runtime policy
was enlarged. The original timing-sensitive full-run failure and both deliberate
matrix interruptions remain in the preceding record and limitations; the final
local scheduling adjustment is not a remote CI modification or semantic score.

The primary now commits only the scoped30-path packet, then dispatches separate
non-author GPT6.1Sol/high Standards and Spec reviews against the fixed P3b base.
Post-commit acceptance, exact SHA, review findings and latest-head CI belong in
the delivery PR. No merge, release, deployment, user data or product-pin change.
