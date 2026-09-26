# Installed qualified source-pair launch

Status: frozen contract for one offline implementation packet after G #227
passed primary two-runtime gates, independent Standards/Spec, and all17 CI jobs
at `4f21039d9a8fc7892e5aef4b0f3303f567df11e9` (run36103361927).
Fixed review base: `4f21039d9a8fc7892e5aef4b0f3303f567df11e9`.
Branch/worktree: `feat/qualified-source-pair-launch` / `qualified-source-pair-launch`.
Primary owns architecture, acceptance and subsequent experiment decisions.
One GPT-6 Sol/high author implements; two non-authors independently review the
same original-base/final-SHA diff after primary verification.

## Goal and boundaries

The product remains a lightweight, source-backed reliable memory layer for
Hermes/MCP and other harnesses, compared fairly with existing solutions. This
packet connects the accepted two-source-policy generation, scoring and guard
to a reproducible installed-engine experiment. It does not itself establish
answer quality, improve MOC navigation or complete the installed-host milestone.

Reuse N (`qualifiedSourcePairProtocol`, `runQualifiedSourcePair`) and P
(`scoreQualifiedSourcePair`, `aggregateQualifiedSourceScores`) unchanged, and
G except for the pair-only installed-deadline correction frozen below.
Both arms use source-bound-v2 qualification; qualified-prefix versus indexed
windows isolates source exposure, not qualification or MOC versus vector search.
The older three-arm public-pilot CLI, smoke wrapper and their report schemas
remain unchanged; their projections cannot be repurposed as a two-arm proof.

This packet is OFFLINE: synthetic prepared inputs, temporary ledgers, installed
local artifacts and fake HTTP only. No real corpus/key/operator ledger/config,
cap transition, paid requests, merge, release or deployment. Existing US$200
cumulative authority is not permission to skip any frozen launch gate. Old
terminal cohorts are never retried, relabeled or relaunched.

## L1 — Closed private plan and read-only preflight

Add a narrow maintainer runner/CLI under `evaluation/live/qualified-source-pair*`.
The command contract is `--plan <absolute-private-json> (--dry-run | --launch)`;
reject unknown/duplicate/missing/contradictory flags. No implicit launch.

Use a versioned exact-schema plan with bounded safe integers, dense unique
rosters and rejected unknown fields. Bind the execution ID, prepared-input
digests/selection, installed artifact identity/source hashes, harness identity,
exact ledger configuration and settled checkpoint, full monetary parent grant,
common policy/stages, answer/recall limits, per-question arm order and expected
protocol digests, private output/launch paths, and finite phase request and
reserved-micro-dollar ceilings. No defaults selected after answers are seen.
The author may choose field names but must document the exact schema and bounds.

Frozen implementation seam: `qualified-source-pair-launch-cli.mjs` exports
parseArguments/main; `qualified-source-pair-launch.mjs` owns preflight and run;
`qualified-source-pair-phase-quota.mjs` exposes the maintainer-only
`createQualifiedSourcePairPhaseQuota({guard, policy, stages, phaseCaps})`, returning
only wrapped cairnFetch/answerFetch/judgeFetch, execution and immutable snapshot.
The CLI's injectable fetch/readKey/streams are trusted test/application seams,
not flags or permission to bypass the guard. CLI defaults use one native fetch
attempt and the explicit private key file only in launch mode.

Plan keys are schemaVersion, executionId, prepared, installed, harness, ledger,
parent, checkpoint, answerModel, limits, judgeTimeoutMs, roster, phaseCaps,
outputDirectory and keyFile; optional referenceSidecar is a private path/hash
pair validated by the existing reference-rendering loader. Non-string references
require that verified capability; do not silently stringify or discard a case.
prepared holds directory plus manifest/history/questions/evaluator hashes;
installed holds receiptPath/receiptSha256/artifactSha256; harness holds pinned
commit and a closed set of critical sourceHashes. Derive the installed package
root from the verified existing installation receipt, not a separate arbitrary
module path. checkpoint holds requestCount/reservedMicroUsd/attemptsSha256.
roster is prepared-order {questionId, armOrder, protocolDigest}. phaseCaps holds
generation/scoring, each {requests, reservedMicroUsd}; their safe sums cannot
exceed remaining cumulative headroom. Stage-derived subquotas are conservative
upper bounds, not permission to continue after one latches a global halt.
Derive marker path from the private plan directory and bounded executionId;
output must be a fresh disjoint sibling, never an ad-hoc marker path.

Reuse the prepared-v2 loader/evaluator boundary. Independently derive every
full N protocol from the selected prepared history/question, namespace, common
limits and frozen arm order; compare it with the frozen digest BEFORE a claim.
Only then derive G's compact roster. Reject changed inputs, mismatched IDs,
duplicate scopes, reordered/extra/missing cases, incompatible common settings,
unverified reference serialization and malformed artifact/parent bindings.
Evaluator answers never enter extraction, retrieval or answer requests.

Preflight verifies the frozen installed artifact/build receipt and actual
regular runtime files used for imports, not merely an arbitrary packageRoot
label. Core and OpenAI adapter must be loaded from that verified installation;
N/P/G remain the pinned maintainer harness. Preserve locked dependencies and
ordinary package contents; no evaluator or operator secrets enter the package.
Document the integrity boundary without claiming hostile same-user isolation.

Private reads are bounded, regular, non-symlink files with private modes and
checked ancestors/identity; secrets are never printed or written to artifacts.
Here private reads mean plan/prepared/evaluator/ledger-binding inputs; ordinary
installed public runtime files need integrity/identity checks, not0600 modes.
Use a separate immutable plan/input namespace from fresh output paths. Validate
path collisions and refuse reuse/overwrite. Reuse safe existing exported helpers
where suitable; do not change old runner behavior just to share private helpers.

Dry-run performs no provider/credential access, marker/capability/claim creation,
database creation/migration/cap change or output mutation. Use the existing
read-only ledger snapshot, not writable reopen. Return only redacted counts,
configuration fingerprints and validation status. Snapshot tests must prove
unchanged bytes and absence of new files, not just a successful exit.

Feasibility decision: the legacy100-parent loader uses writable reopen, so it
cannot serve dry-run. Permit one narrow maintainer export in request-guard.mjs:
`inspectQualifiedSourcePairParent({ledger, policy, benchmarkExtension})`.
It snapshots exact inputs once, validates the existing100/200 full file-bound
parent with the existing private verifier, uses ONLY
`inspectExperimentBudgetSnapshot`, requires open fully settled state and returns
that immutable state. No callback, files, claim, cap transition, writable reopen
or new transport grant. Preserve all old loaders and G behavior. Test both
parents, tampering and byte/file nonmutation; instrument constructors to prove
read-only connection use. This avoids duplicating the monetary-chain validator
inside the launcher. This was the initial narrow G-module addition; the
reproduced installed-deadline correction below is an additional scoped seam.

## L2 — Conservative phase quota before every guarded dispatch

G remains the authority for durable cumulative accounting. Add a private,
launcher-owned quota; do not add a new G profile or weaken its validators.
Every Cairn count/generation, answer and judge route must pass through a closed
wrapper before invoking the SAME G instance. No raw guard/fetch/ledger reaches
model/core/N/P callers. Inject one non-retrying provider fetch only into G.

Derive endpoint, stage and reservation from immutable policy/parent snapshots
that are identical to G's inputs. Cairn count/generation and answer are generation;
judge is scoring. Never infer phase from mutable current-loop state. Unknown
endpoint/route or inconsistent configuration fails closed before dispatch.

Synchronously check and pre-debit one request and its FULL worst-case guard
reservation before invoking a route, with no await between check/debit/invoke.
Use safe arithmetic. Refuse if either frozen phase ceiling would be exceeded;
latch a global phase halt and make no guard call. Do not refund a shadow debit
when G later rejects, times out or fails: this conservative counter is NOT an
actual charge. Concurrent/late callbacks cannot reset or reuse its quota.

Expose wrapped execution.isHalted as guard halt OR quota/launcher halt. Latch
globally on classification/accounting/wrapper/phase-bound failures; do not turn
G's recognized local deadline into a global failure. All other G global stops
(including429/external abort) remain global. No retry or second baseline call.

Keep shadow dispatch requests/reservations and actual durable ledger deltas,
known/unknown cost, pending rows and guard attempts separate in output. Assert
that durable owned requests/reservations never exceed their corresponding
shadow totals. This proves a hard ceiling for this trusted single-process
launcher's routed dispatches, not a native G phase cap or arbitrary egress
sandbox. The consumed, nonresumable launch is necessary to prevent quota reset.

### Reproduced installed-core deadline correction (primary decision)

Primary actual-installed CLI probes on Node22 and24 reproduced a RED after
the first installed extraction timed out: only two sends, global halt and all
four score slots unresolved. The core's existing30s timer was accelerated in
test instrumentation only; G's60s transport timer and N/P backups were not
changed. A separate same-code/different-module-origin probe confirmed that
checkout and installed `core/model-call.mjs` have distinct private WeakSets.
G recognized only the checkout copy's genuine timeout, misclassifying the
installed copy's timeout as an external abort. Earlier judge-timeout passes
did NOT establish installed core-timeout isolation.

Extend this packet narrowly, without changing core files, monetary parents,
old guard profiles, N/P, timeout limits or global handling of external aborts.
Add a maintainer-only installed provenance loader under experiment-budget.
It accepts only an exact packageRoot input; before importing the fixed
`core/model-call.mjs`, it checks regular non-symlink bounded files and canonical
paths, and verifies the exact closed dependency set against trusted checkout
bytes: core/model-call.mjs, core/model-budget.mjs, core/model-diagnostics.mjs,
core/validation.mjs and plugins/cairn-memory/lib/redact.mjs. The launcher must
already verify that installation's receipt/artifact and runtime integrity.
This is not a general module loader and accepts no caller-provided predicate.

The loader issues a frozen opaque in-process token backed by a private WeakMap
to the actual installed predicate. Only the qualified-source-pair G factory
may optionally accept `installedCoreDeadline` as that token; reject forged,
cloned or arbitrary callback tokens before a claim. Keep the old checkout
recognizer, and additionally recognize genuine signals from exactly the verified
installed module for this guard. No global registry/setter, shared core WeakSet,
string/Symbol-based signal trust or change to older guard constructors.
The launcher owns and supplies the token; do not expose it to model callbacks.
Bind the new helper and its closed dependencies in the harness hash list.

Regression before fix: persist an actual installed capture/recall timeout case
that fails with the observed global halt, then prove local unknown settlement,
full reservation retention and continuation of later preselected slots. Retain
an external abort negative, a foreign-module signal negative, invalid-token
negatives and a changed installed-helper dependency refusal before import.
Re-run the original primary CLI reproduction on both runtimes, affected full
gates and both independent review axes against the same original base. This
extends offline integration correctness, not semantic quality or paid authority.

## L3 — One irreversible launch and fixed-roster terminal accounting

After read-only validation, --launch revalidates before creating a create-only,
private, fsynced launch marker bound to the complete frozen plan. Load a key
only in explicit launch mode after nonsecret preflight; do not verify it with
an extra network call. Tests use synthetic credentials exclusively.

Provision/verify G's exact capability and consume its claim once. Provisioning
or initialization failure after marker creation leaves the launch consumed;
never delete/repair a partial marker or claim. Two competing launchers cannot
both proceed. A process crash is nonresumable, not a new-session retry.

Derive distinct fresh database paths per selected case and arm inside a new
private output tree. Open actual installed cores with the correct qualification
and source policy. Verify freshness and never reuse a prior case's store.
Compute/store trusted protocols before calling N. Generate ALL selected pairs
in frozen order before ANY scoring, then call P with trusted evaluator data
and independently computed expected protocols, never a result's self-digest.
Set guard-owned deadlines ahead of N/P backup timers with explicit margin.

Keep failed/unrun cases and both arms in P's fixed roster. Never fabricate a
resolved result for a blocked slot, drop failed cases or edit N/P result schemas
to accommodate a launcher error. P already supports missing scoring records
in its fixed denominator. Retain partial generation/scoring observations and
the first failure; a later persistence/accounting failure is also visible.

Persist private per-case results plus a versioned terminal launch report with
plan/artifact/protocol identities, stage status, fixed-roster aggregate, quota
snapshot, accounting observations and available latency/storage measurements.
Use create-only durable writes; no overwrite of evidence. After post-marker
failure, best-effort persist a bounded redacted failure record without replacing
the first cause. If persistence itself fails, leave the marker consumed and
exit nonzero; do not falsely promise a complete report. A killed process may
leave only its marker and ledger; document that honestly.

CLI stdout/stderr and public summaries must contain only bounded allowlisted
codes/aggregates, not question/answer/source text, credentials, raw provider
errors, private paths or evaluator labels. Detailed private outputs remain
0700 directories/0600 files; prevent accidental inclusion in commits/artifacts.

## L4 — Observable offline and installed acceptance

Use actual temporary SQLite and real N/P/G. Required positive control: at least
two synthetic cases with opposite arm orders, four fresh INSTALLED cores,
actual installed adapter extraction/qualification/filing/recall, answer and
judge through one guard. Assert source-tail contrast, source-only context,
no generated-summary/label leakage, all-generation-before-all-scoring, exact
attempt/ledger/dispatch counts and retained pre-existing ledger reservations.

Exercise both complete monetary parents (100 and chained200) with synthetic
ledgers only. The launcher does not itself transition caps. Preserve old guard
denials and default core/adapter/three-arm-runner behavior.

Negative checks include malformed/extra/reordered plan data, altered prepared
input/artifact/protocol/parent/checkpoint, privacy/symlink/path collisions,
existing output/marker/claim, competing launches, failure after marker before
claim, and partial write/fsync/terminal-output failures. No unauthorized HTTP
or replacement ledger may be created. Dry-run cannot consume or mutate a grant.

Quota tests: exact dollar/request boundary, denied predebit retention,
overlapping/escaped calls, route-derived phase at scoring transition, wrong
endpoint and guard-state failure. Every refusal must assert whether a dispatch,
guard reservation and HTTP send occurred. Deadline/late-body tests preserve the
failed slot and unknown reservation while allowing the next preselected slot;
429/accounting/external abort/phase exhaustion stop subsequent sends without
retry and keep all unrun slots in the denominator. Constructor/crash/relaunch
tests retain consumed authority and never reset counters or replace failures.

Test ordinary CLI parsing/redaction/preflight and explicit launch with synthetic
inputs/fake HTTP, plus an installed-engine run. Keep instrumentation in tests,
not new arbitrary runtime fault hooks or permissive provider endpoints.

## L5 — Scope, gates and delivery

Allowed: the L1 read-only inspector and the reproduced L2 installed-deadline
loader/token seam in the pair-only G factory, scoped guard tests/registration, new
narrowly named live runner/CLI/private quota/helper/tests, one
installed regression under packaging/test using existing artifact machinery,
technical docs/limitations/CHANGELOG/this plan, and registration in existing
package scripts if necessary. No core/adapter/N/P semantic changes or other G
behavior changes beyond the explicitly scoped installed recognizer; no public
schema/version changes, old-runner rewrites, dependency/lockfile/workflow edits,
production data or new registry publication. Escalate a genuine boundary/API
contradiction to primary before widening implementation; primary can re-scope
within user authority and must document the decision.

Both Node22.16/24.15: required live-offline, guard, budget, LongMemEval and
generic suites; five budget/guard/LME demos; JSON; local pinned Claude2.1.260
strict validation. For the installed case, follow CONTRIBUTING: install both
locked adapter sets, run/read packaging cache preparation, and run artifact
tests on both runtimes. Use existing CI jobs, not a new skipped-only gate.
Recheck dependency-free budget/LME from a clean final archive. No typecheck
gate exists in this JavaScript repo.

Primary reads actual final diff/tests, personally runs independent quota and
installed acceptance paths and both-runtime gates. Freeze a scoped local
candidate, independently review Standards and Spec against the original base,
correct/retest/review both axes as necessary, then push a dependent PR. Exact
final-head ALLCI and mergeability precede ready status. No automatic merge.

## L6 — Next experiment checkpoint, not completed by this packet

After offline delivery: audit the unchanged campaign ledger read-only, freeze
fresh development and untouched holdout rosters disjoint from earlier exposed
cohorts, deterministic selection/arm order, numeric phase ceilings and N,
models/scorer/resource limits and decision criteria BEFORE paid scoring.
Installed-launch rehearsal and independent safety/fairness checks precede
calls. Rebalance prospective phases only within remaining US$200 authority;
never reset/refund old rows or retry prior cases. No real IDs or phase dollar
allocation is selected in this offline implementation contract.

Report correct/wrong/unresolved, completion, paired differences, costs,
uncertainty, latency and deployment weight separately. 95% completion is not
accuracy; development informs changes but cannot be passed off as holdout.
No parity/gain claim from a small pilot. Matched Mem0 comparison, installed
Hermes/MCP growth and cold onboarding remain later product gates.

Historical pre-implementation checkpoint: G was accepted offline but not
merged. Read-only author feasibility confirmed the closed wrapper/installed
path after primary approved the narrow read-only parent inspector above. Main
installed locked maintainer dependencies and prepared public package metadata
(no model requests). The bounded Sol6/high implementation was then released.

Current local implementation checkpoint (not yet independently reviewed or
accepted by CI): the read-only parent inspector, closed-plan CLI, installed
two-arm runner and synchronous phase quota are implemented in this worktree.
The installed fixture is owned by the packaging suite because CI prepares
artifact metadata there, not in the live-offline job. A dependency-light CLI
parser test and quota tests remain in the live suite; the inspector is
registered in the guard suite. Synthetic focused tests exercise both runtimes,
including one real installed two-case/four-core path, a first-halt plus terminal
write failure, consumed marker/replay, and altered frozen inputs. Primary's
separate synthetic read-only, actual-G quota, installed normal/deadline/429/cap
probes passed during implementation; those do not establish semantic quality
or authorize paid work. Full exact-candidate L5 gates, clean-archive check,
two independent full-base reviews and CI remain pending. No actual ledger,
private corpus, provider or paid score was used. The next paid packet remains
excluded.

Correction checkpoint: primary's actual installed-core timeout probe was RED
on both Node versions before the verified-origin token: the first installed
extraction abort was treated as external, globally halting after two requests
with all four judgment slots unresolved. The author then persisted an actual
installed-core timeout regression; it was RED on Node22 before the correction
and GREEN on both Node22/24 after it. Primary independently reran the same
installed CLI case GREEN on both versions with later preselected slots
continuing, and a Node24 native 30-second core-timer variant also passed.
The corrected guard+packaging focused suites passed 39/39 on both versions;
synthetic forged/cloned-token, changed-helper-before-import, genuine checkout,
foreign-module and external-abort cases are included. This proves the
local deadline-provenance boundary, not remote cancellation or billing.
The earlier synthetic fixture setup errors in primary probes were corrected
before acceptance and were not product regressions. Full exact-byte L5 and
artifact gates, clean archive, independent reviews and CI remain pending.

Final-byte primary verification checkpoint: both Node22.16 and24.15 passed
budget25, guard227, live360 total (330 pass, 30 pre-existing opt-in skips),
LongMemEval123, generic112, all five budget/guard/LongMemEval demos, JSON,
and the locally pinned Claude2.1.260 strict validation. The installed artifact
suite passed77/77 without skips on both. Primary's independent eight-scenario
installed matrix, ready-barrier two-process launch race, read-only parent and
opaque-token boundary probes passed on both. These are synthetic local checks;
clean-archive verification, two independent full-base reviews and exact-head
CI remain pending. No provider, actual ledger, private corpus or paid call was
used.
