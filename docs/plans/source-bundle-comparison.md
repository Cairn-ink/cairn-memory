# Source-bundle paired comparison — prospective offline contract

Primary decision 2026-10-11. Continue the supported-first-answer algorithm
experiment specified in the frozen source-bundle QA24 contract. This packet
implements its executable comparison and preflight, not a paid launch or scorer.
No closed cohort/run/result/judgment changes, new grants, GitHub/main merge, release, deploy,
historical cleanup, key discovery or operational-ledger access. Record the exact
accepted corpus/QT dependency SHA before full runner implementation. A bounded
CF-only store/preflight subpacket may start as specified below. D12 and Stage2/3
remain uncleared.

## Scope

Exactly five paths in a new dependent worktree:

- evaluation/algorithm-development/source-bundle-store.mjs
- evaluation/algorithm-development/source-bundle-runner.mjs
- evaluation/algorithm-development/test/source-bundle-runner.test.mjs
- docs/plans/source-bundle-comparison.md (preserve this contract verbatim)
- docs/limitations.md (append only)

Primary integration decision before implementation: CF and QT are independently
delivered from their common accepted QB base. Primary may locally integrate the
exact accepted QT commit into a fresh dependent worktree at the accepted CF
commit, resolving only their append-only limitations tails (QT before CF) and
preserving both histories. Record both accepted SHAs and this integration SHA
before full runner author dispatch. This is dependency integration, not merging GitHub/main.
The worker changes only the five paths above relative to that fixed integrated
base; it must not alter inherited CF/QT files. The eventual dependent PR targets
the accepted CF branch and therefore also carries the already reviewed QT
dependency. Primary independently inventories both the five-path author delta
and the full PR delta, and both final reviewers inspect the entire combined PR
diff, with CF/QT contracts preserved. All gates and latest-head CI refer to the
combined candidate, not solely the author's delta. No additional integration PR
or hidden dependency rewrite is needed.

To parallelize without depending on an unaccepted transport, the same future BR
author may first implement ONLY `source-bundle-store.mjs`, its store/preflight
tests in `source-bundle-runner.test.mjs`, and this exact tracked plan on the
accepted CF commit. No runner or limitations write in that subpacket, no ledger,
key, grant, network/provider or QT construction. Implement BR1 fully with real
core and actual existing local tokenizer/ordinary fake serializer, then stop
with the three new files uncommitted. Primary can locally integrate accepted QT
while preserving these nonoverlapping files (never stage them into the dependency
merge), records the new fixed integrated base, and only then releases BR2–BR5
runtime work. Before the merge verify that its index contains only the accepted
dependency delta; after it independently confirm preflight file bytes unchanged.
The final full gates and independent review still cover the combined candidate;
subpacket tests do not substitute for them. No intervening paid run is allowed.

No old transport/guard/profile/scorer/core/adapter/ledger/default/dependency/CI
changes. Import the accepted CF profile, QT transport, QB wrapper/assembler,
ordinary createAlgorithmDevelopmentTransport, actual core and generic pure
preparation/verifier/packer by their existing APIs. Never import or run a closed
cohort-specific runner/scorer. No evaluator rubric or support anchors in runtime.
One bounded actual GPT-6.1 Sol/high author; primary owns direct inspection,
integration, scope and independent acceptance, followed by two nonauthor axes.

## BR1 — Query-independent stores and complete preflight

Provide an explicit offline preparation entrypoint, with no environment, HTTP,
key, ledger or auto-execution. Validate/freeze exactly the accepted 24 CF cases
and prepare all stores before any paid eligibility. The output root must be an
existing fresh private directory; exclusive case-directory/file creation rejects
collisions rather than overwriting. Use actual core.capture with deterministic
scripted extraction: one item per input source window, literal window content,
exact source index, kind context and no inferred claims. Classification sets no
parent IDs (all unfiled). Never inspect query, family or rubric to choose memory
content or placement. Capture each case exactly once; keep full source/receipt
mapping and capture outcomes. No fake direct database insertion.

Close/reopen actual stores. Assert each has exactly twelve active one-receipt
cards, each original role/window accounted for once, one authorized namespace,
and one exhausted complete map page. Preserve original source/event times.
Derive a logical full-table snapshot with deterministic row ordering, plus file
bytes as a resource; do not assume SQLite byte identity after harmless reopen.
Each subsequent QA/probe checks the same logical snapshot before and after.

Offline preflight uses actual bounded-source-scan recall with scripted rank that
records its untouched input and returns empty refs; unexpected select throws.
Require exactly one rank call, twelve distinct candidates in the map's actual
order, one full receipt each and zero core candidate/receipt/character omissions.
Bind the exact IDs/revisions/roles/excerpts/order/query/limit and canonical
question to the retained preparation. Independently serialize the ordinary rank
wire using existing adapter serialization with fake HTTP and the bundle wire
using its fixed documented shape. Require prepared and both full provider
envelopes to fit 6,000 actual local tokens. The preflight may use injected fake
HTTP only to serialize; no network/provider or ledger. Record limits, hashes,
counts, measured sizes and failures. A missing/failed precondition makes the
whole preparation ineligible; do not shrink sources or remove hard cases.

Use a process-local unforgeable preparation capability (detached/frozen public
observations are not that capability). Its future manifest includes all 24
source/plan/state/request hashes and the accepted version/model/policies/order.
One preparation can be consumed by the comparison only once, including failure.
The later launch separately freezes this manifest and authorizes the first run.

## BR2 — Paired QA and separate upstream probe

Exactly24 ordinary QA slots,24 source-bundle QA slots and24 natural-selection-
only probes. Use CF's odd/even arm order, each case's probe AFTER both QA slots
settle. Both QA arms cold-open the identical prepared store, source policy
bounded-keyset-v1, source-evidence, limit6, selectionMode bounded-source-scan.
Unexpected select fails, never falls back. Compare the actual live rank input
against its offline attestation and across both arms before dispatch; no omitted
or altered source, identity, scope, role, revision, order or query allowed.

Ordinary arm uses unchanged ordinary paid rank, verifiedRoleEvidence with actual
core.get and packMixedAnswer. Bundle arm injects the separately named QT planner
into unchanged createBundleRankModel, obtains the actual returned sidecar,
assembles against actual successful recall/core.get and uses
packSourceBundleAnswer. No forced bundle or retry after malformed output. Both
answer through the unchanged ordinary transport.answer using the verified units
and canonical {text:plan.originalQuestion.text,date:plan.canonicalQuestionDate}.
Compare that call's actual packed request byte-for-byte with the precomputed
ordinary/bundle packed request. Same answer instruction/model/512 output cap;
actual answer input <=6,000, no omitted/duplicate evidence or partial bundle.

After both answers settle, run one separate actual ordinary select on the same
cold state with selectionMode omitted. Scripted rank records the actual post-
fetch/post-pack input then returns empty refs; it never invokes paid rank/answer.
Record map visibility, selected refs, rank-visible receipts and omissions,
without gold lookup. One complete map bounds this probe to one logical select
(count+generation); unexpected continuation/call is a visible failure. Probe
output never changes either QA input or counts as QA recovery efficacy.

## BR3 — Ledger ownership, limits and durable observations

Construction/run dependencies are explicit: accepted preparation, detached
configuration/checkpoint/history witness, a separately bound frozen manifest,
apiKey, fetchImpl and synchronous observation/checkpoint callbacks. No implicit
credential, URL, model or network fallback. Do not accept arbitrary core/model/
transport factories in the live API; offline tests exercise the real imported
transports against fake HTTP and synthetic ledgers.

Only one bound ledger handle may be open at once. At each phase transition read
and retain the old owner's exact final state/history witness, close it, then
construct the next owner using that witness. No independent handles interleave,
no snapshot rebase/refund/reset after foreign writes. The existing ordinary
constructor's protected30USD plus10USD/1968request allowance remains mandatory
at every bind. Original cumulative <=400USD ledger, no pending attempts, known
prices versus unknown reservations, and immutable history prefix are preserved.

Healthy owner transitions can obtain state before closing. Ordinary fatal health
makes its state() unavailable: after settlement, close and inspect through the
existing read-only schema2 inspector for final diagnostic evidence only, then
stop without any rebind. Do not turn inability to read a fatal owner's state
into a new run/owner. Ordinary auth/redirect/credential errors may retain unknown
usage because the unchanged transport rejects before pricing; preserve that
conservative reservation and report the limitation, not QT-style known-usage
parity or retrospective repricing.

Ordinary transport internal ordinal starts at1 after rebind. Record that raw
ordinal faithfully and separately preserve actual CF case ordinal/slot identity;
do not pretend transport local counters enforce the global experiment. Ordinary
baseline/full are internal adapter slots, not public experimental arm names.

Coordinator enforces global case/slot/method/HTTP/reservation/deadline ceilings
across all rebinds. Exactly one first invocation per planned logical slot, no
automatic retries/resume/replacement. Max192 physical intents,960000microUSD
reserved: each case ordinary rank2+answer1,bundle planner2+answer1,probe select2.
Count unsent but durably reserved intents against cap too. Validate room before
starting each bounded method; no callbacks after closure or cap renewal.
Case20min/run8hours/call inherited30s logical core and200s answer physical caps,
with a single absolute case/run deadline propagated across owner changes.
QT gets min remaining absolute deadlines. Ordinary answer has no external signal
port: an explicit guarded fetch enforces the coordinator's remaining deadline
including late/never-resolving HTTP/body, without restarting or abandoning a
settlement. Never silently extend a deadline by opening another transport.

Persist immutable pre/post records using real transport observations, retaining
raw internal IDs plus external case/arm/phase identity and exact redacted wire,
actual outcomes/usage/known-price/reservation and dispatched status when exposed.
Synchronous callback must return undefined. Exceptions/non-undefined/promise
returns are fatal; do not lose ledger settlement or print raw errors/secrets.
One attemptId yields one physical-intent count and one final record; pre and post
are not two requests. Ordinary transport reports update records rather than a
phase field: normalize from observed attempt identity without mutating originals.

## BR4 — Failure semantics and evidence

Initialize all48 answers and24 probes unresolved/not-run before execution. Every
planned case remains in denominator even on failure. Ordinary settled model/
provider/output/timeout failure consumes its slot and may proceed to other
predeclared slots only if transport/accounting healthy and frozen state intact.
Precondition drift, provenance mismatch, new unauthorized call, model/usage/auth/
credential/accounting/record-persistence anomaly or resource exhaustion stops
the entire run; mark every remaining slot not-run with that reason. Never swallow
fatal health into an empty successful recall. Preserve unresolved separately
from an executed answer that judges may later label wrong.

Retain capture sources/outcomes/receipts, exact map/rank/planner input/output,
sidecar declarations, final core reads, verified evidence, actual packed request,
first answer, scoped failures, state witnesses and resource totals. No score or
semantic success decision here. Source-bundle organization is unverified, not
identity/truth/adoption/authority. Separate reported token/known-price/latency/
database-byte measures; peak RSS is unknown unless measured, not inferred.
Successful run means first slots accounted for, not useful answers or readiness.

## BR5 — Offline acceptance and delivery

Tests use all24 real CF source cases through actual core/scripted capture,
both imported transports with deterministic fake HTTP and fresh owned synthetic
schema2 ledgers, never production campaign/configuration. Fake outputs are
source-index-based controls, not gold-informed efficacy. Prove all preconditions
for all24, exact rank equality and canonical question, supported whole-source
assembly, unchanged answer wire and store, counterbalanced order and probe
isolation,192maximum intent accounting, one ledger owner, retained old history,
no retry/resume, output collisions, cancellation/timeout between phases and
within answer, late/never-resolving response/body, record failure, foreign append,
insufficient inherited headroom, malformed proposal and unchanged denominator.
Prove actual owned resources removed after success/assertion/setup failure;
retained formal experiment output is a separate later launch responsibility.

Primary reads all five files and independently derives inventory via Git and
tree routes. Run focused tests, full test:algorithm-development, generic tests,
budget/guard regression, validate and both Claude validators on22.16/24.15,
actual exits/logs/no skipped required paths. No TypeScript gate exists. Freeze
exact tested commit; independent nonauthor Standards/Spec review same full diff.
No push before both pass; latest remote head CI/mergeability for delivery, no
merge/release/deploy. Append documented failures and honest boundaries. A later
independent scoring packet and reviewed frozen live launch remain required.

## BR1 author checkpoint — bounded CF-only subpacket

The fixed author base is accepted CF commit
`51bf373de67680d1fcf5ac0a7b29de1ae0f7055b`, on the isolated
`experiment/source-bundle-comparison` branch. This subpacket changes only the
new store module, its store/preflight test file and this plan. It does not add
the comparison runner or a limitations entry; those remain deferred until the
primary integrates accepted QT and explicitly authorizes BR2–BR5. The complete
14,669-byte prospective contract above is preserved; its SHA-256 is
`a46ba400f38456b861ee957277f80cd6251fe55aa114da7dcdeacfca69a43a26`.

The store entrypoint imports the frozen CF source profile and accepted QB request
preparer. Actual core and existing OpenAI serialization/token counting are lazy
imports. Scripted extraction receives only actual source windows and returns
their literal contents and indices; classification returns empty parent IDs.
Cold actual source-scan recall supplies the rank attestation. Its map page is
observed through the actual envelope passed to the real counting callback, not
through a synthetic ranker or a guessed public-map order. Core exposes nonzero
recall omission counters only: retained zero counters explicitly record that
basis, alongside the raw recall and exact full-source identity checks.

Ordinary wire serialization uses the unchanged adapter with a hardcoded
synthetic serializer-only credential and process-local fake HTTP. No real
credential or network/provider is used. Bundle serialization follows the fixed
QT2 documented envelope, read-only contract SHA-256
`f4f9a3b02fc87cae2c8306a51b31f3f1d6d5ee287b44d91580a65f15df91ebbc`.
This does not construct QT or prove byte parity with its future paid execution.

The only transient ignored dependency is a real
`adapters/openai/node_modules` directory containing a `tiktoken` symlink to the
existing relation-binding-probe worktree's locked installation. Lockfile
comparison exited 0; the target package is 1.0.22 and `git check-ignore` confirms
the link is ignored. No install, lockfile edit or shared-target mutation occurred.

Initial short checks exited 1 with two distinct author mistakes: null options
escaped closed validation, and the cleanup-success fixture lacked map's token
counter. One bounded correction each passed the two short checks on both pinned
Nodes (exit 0). The first full focused Node22 run then exited 1 (2/4 passed),
blocking both preparation tests at the first capture. A one-window actual-core
diagnostic exited 0 and proved the precise mismatch: indexed receipt.eventId is
the source message.id, not the capture-envelope eventId. The assertion and its
independent source check now preserve and distinguish both identities. Neither
source data nor invariants were weakened. The original TAP and diagnostic logs
are retained under `/tmp/cairn-br1-author.IiyKJfy5/`; scratch cleanup completed.
Both pinned `npm run validate` checks exited 0. Final corrected all24 focused
verification remains pending at this checkpoint while primary QT gates run.

Read-only primary integration notes were inspected for future accepted verifier,
assembler and transport interfaces. They grant no runner work. This packet has
no ledger, paid grant, model answer, evaluator rubric lookup, score, efficacy
claim, ordinary/QT parity claim, or D12/Stage2/3 clearance.

### Final BR1 focused verification

The corrected store and test bytes passed the complete focused suite on both
pinned runtimes: Node 22.16.0, 4/4 with actual exit 0 and no skips (178.8 seconds);
Node 24.15.0, 4/4 with actual exit 0 and no skips (169.4 seconds). Each runtime
tested two independent complete 24-case preparations. Each preparation captured
each case once, producing 288 actual active unfiled cards and 288 exact receipts.
The first preparation proved all cold maps, full-table snapshots, complete
source-scan rank inputs and wire bounds, then consumed successfully once. The
second used actual core.correct to change one store, proving whole-preparation
drift rejection and consumption on failed first use. There were no direct SQL
writes, omitted hard cases, model answers or rubric-guided controls.

Maximum measured local tokens across each runtime's positive all24 preparation:

| Runtime | Ordinary prepared | Bundle prepared | Ordinary count / generation | Bundle count / generation |
| --- | ---: | ---: | ---: | ---: |
| 22.16.0 | 2280 | 1856 | 2803 / 2818 | 1952 / 1967 |
| 24.15.0 | 2274 | 1850 | 2797 / 2812 | 1946 / 1961 |

These are real local tokenizer measurements of the complete prepared JSON and
serialized envelopes, not provider-count evidence or token parity across
independently generated store IDs. Database file bytes and full logical hashes
are measured in every case observation and preparation manifest. Peak RSS was
not measured. Suite wall time is not model/provider latency or efficacy.

Success, deliberate assertion failure and setup failure each exercised actual
SQLite ownership through child test runners; all closed resources and removed
their owned scratch. The first complete Node22 runner root was additionally
checked absent with actual exit 0. This is owned-test cleanup, not a promise to
remove retained formal preparation output or a historical-directory sweep.

Both final validation commands exited 0 after the evidence append. The independent
inventory compares Git diff/untracked paths against a full filesystem walk and
fixed-base Git blob/mode comparison, excluding only Git metadata and ignored
node_modules. It reported exactly the three authorized new paths (exit 0). Retained
logs and the inventory helper are under `/tmp/cairn-br1-author.IiyKJfy5/`.
The initial failure logs remain retained and are not counted as successes.

No full algorithm/generic gate is claimed for this subpacket. Primary will run
the complete required matrix on final integrated bytes. STOP before dependency
integration and BR2–BR5; no commit, push or merge is authorized here. Actual QT
wire byte comparison, paid/model answer execution, independent scoring and
supported-first-answer improvement remain unproven.

## BR2–BR5 implementation dispatch and retained schema

Primary authorized this continuation after accepting CF
`51bf373de67680d1fcf5ac0a7b29de1ae0f7055b` and QT
`21f4bf0a512fa22f54bec637f5ef5a70c478b1f5` (each latest-head CI 27/27,
QT's two full-diff independent reviews PASS). The fixed local integration base
is `4423cd2bf91e3c479767bd1bebac3a6510846f07`, with those exact two parents.
Primary independently verified the six-path dependency delta, preserved the
three BR1 STOP hashes, and ran accepted QB/QT tests 84/84 plus validation with
actual exit 0 on both pinned Nodes. This is local dependency integration, not a
GitHub/main merge. Actual author remains GPT-6.1 Sol/high; cost is unknown.

The explicit public runner takes preparation, manifest, configuration,
checkpoint, historySha256, apiKey, fetchImpl, onRecord, onCheckpoint and signal.
All are required; no factories, clock/test flags, implicit credential/network,
resume or observation rebranding. The genuine preparation is consumed before
subsequent validation. A pure manifest builder projects public preparation
observations but creates no capability or spending grant.

Manifest v1 contains version, preparationManifestSha256, the complete BR1
preparationManifest, exact dependency commits, fixed limits and the 24-case
schedule (id, ordinal, arm order and three public slot IDs). Runtime derives
immutable run/case absolute deadlines from monotonic start times and inherited
8-hour/20-minute maxima. QT receives those same deadlines, never renewed owner
budgets. Formal files are exclusively created in the preparation's new private
comparison directory; preparation artifacts remain retained.

Result v1 contains manifest/hash, limits, execution status/global stop reason,
24 case records, distinct physical intents/reservations, owner transitions and
final ledger diagnostic/state. Each case contains id, ordinal, canonical
question, arm order, preparation hashes, two QA slots and a separate probe slot.
QA slots distinguish unresolved/answered, not-run/failed/completed, whether an
answer was invoked, first answer, closed failure, actual recall/rank/sidecar,
authoritative get reads, verified evidence, packed request and store checks.
Probe records actual map/select/rank visibility and omissions, never efficacy.

Trace v1 events bind sequence, caseId/caseOrdinal, external arm, slotId, phase,
owner kind and unchanged raw transport record. Normalization adds pre/post,
physical ordinal, attemptId and separately observed dispatch status. Count a
reserved but unsent attempt once; ordinary update records do not create another
intent. Preserve transport-local ordinal1/internal arm independently. Exact
redacted wire, outcomes, usage/known prices/unknown reservations, source hashes,
sidecar declarations and old/new complete history witnesses remain inspectable.
No rubric, score, semantic verdict, inferred RSS or retrospective repricing is
added. Synchronous record/checkpoint callbacks must return undefined.

Ownership phases are ordinary rank, ordinary answer, QT planner, bundle answer
and ordinary probe. Every transition settles, records exact final state/history,
closes the owner, checkpoints, then binds its successor. Fatal ordinary health
uses close-first read-only schema2 diagnostics and never rebinds. A concrete
guard shared by runtime and tests bounds HTTP and body reads, sanitizes native
redirect and opaque errors, cancels late bodies and awaits transport settlement.
Caller abort is global; healthy settled ordinary failures consume their slots
without retry and may continue only while all frozen state remains valid.

BR5 will use one all24 happy-path real comparison, grouped nonfatal controls in
another complete run where appropriate, and fresh preparations for fatal
end-to-end scenarios. Lower-level guard/normalization controls use the same
runtime helpers and actual imported transports with fresh synthetic ledgers.
Coverage will name each BR requirement and concrete entrypoint. No consumed
capability is reset/reused, no fake core/model factory or alternate test runtime
is permitted, and no time/deadline cap is relaxed.

## BR1–BR5 author handoff: implemented boundaries and retained evidence

This appendix records offline implementation, not model efficacy or a paid
launch. The original 14,669-byte prospective contract above is unchanged.
The primary accepted the exact CF/QT dependency commits and integration base
listed above before authorizing BR2–BR5. Only the store, runner, runner test,
this plan and an append-only limitations note are in the author delta.

The implementation imports the actual core contract, accepted QB rank wrapper,
source-bundle assembler, mixed-evidence verifier/packer, ordinary algorithm
transport, accepted QT transport and schema-2 budget inspector. All24 preparation
uses real literal-window capture, real receipt/card creation, cold reopen,
complete public map, actual source-scan rank input and unchanged ordinary wire
serialization. The source-only preparation module never imports the evaluator
rubric. Runtime uses the original question text and canonical date, preserves
the original source/role/date joins and complete bundle units, and compares each
actual answer intent wire byte-for-byte with the recorded packed request.
Neither scorer nor semantic reference answers enter a model port.

### Exact exported and retained fields

The exports are prepareSourceBundleComparison, consumeSourceBundlePreparation
and assertSourceBundleStoreUnchanged in the store, and
createSourceBundleComparisonManifest, runSourceBundleComparison,
createSourceBundleGuard, deliverSourceBundleObservation and
sourceBundleFailureCode in the runner. The guard and observation exports are the
same concrete boundaries used by runtime, not alternative runtimes or factories.
The manifest's schedule slots are the canonical 48 QA plus 24 probe slot IDs.
Each owner phase also has a phaseId and method; unchanged raw ordinary/QT local
IDs and ordinals remain separate. The manifest binds the complete preparation,
exact dependency commits, limits and odd/even counterbalanced schedule.

Result fields are version, manifest, manifestSha256, status, stopReason, limits,
deadlines, cases, history, resources, intents, transitions and finalState. Each
case retains id, ordinal, question, armOrder, preparationHashes, caseDeadline,
answers.ordinary, answers.source-bundle and probe. Each QA slot retains status,
execution, answerInvoked, answer, failure and artifacts. The artifacts have
rankRequest, rankOutput, rankFailure, plannerRequest, plannerOutput,
plannerFailure, recall, sidecar, authoritativeReads, evidence, packed,
answerResult, beforeStore, afterRecallStore, beforeAnswerStore and afterStore.
Authoritative reads retain exact input and returned values; raw recall and
partial reads are retained even if later validation stops. Evidence retains
the assembler/verifier's structured provenance, not a flattened substitute.
The actual answer receives evidence.units; packed.request is independently
bound to the observed answer intent. A null artifact means not reached, whereas
an observed empty result is retained as empty. The separate natural probe never
substitutes for a QA result. Execution status accounted is not a success score.

Physical intent records retain ordinal, attemptId, caseId, canonical slotId,
phaseId, method, ownerKind, dispatched and final. Events retain caseOrdinal,
external arm, method phase, owner kind, normalized pre/post/physical ordinal and
the unchanged raw transport record. Closed owner transitions bind their original
absolute run/case deadlines, health and compact actual ledger state. Every owner
settles and closes before checkpoint delivery or binding a successor. Fatal
ordinary health uses close-first read-only diagnosis and never rebinds.

### Exact cumulative-history reconstruction and resource limits

An actual ordinary state with 57,655 pre-existing attempts cannot fit the shared
500,000-node JSON observation budget even once; that limit was not raised.
Dedicated strict schema-2 scalar/attempt validation instead writes the complete
initial history once, before any first dispatch, into exclusive 0600
initial-ledger-history.json. The writer streams bounded chunks, handles partial
writes, fsyncs, caps the artifact at 128 MiB and records its exact SHA-256, byte
count, row count and header. It permits at most one million historical rows.
Persistence failure closes the owner and stops without spending. The complete
internal prior witness remains available for immutable-prefix checks and exact
successor binding; no ledger is repriced, reset or truncated.

history explicitly uses initial-artifact-plus-transition-deltas-v1, not a fake
empty complete state. Normal transition/final states use
base-plus-ordered-delta-v1 with base, header, prefixUnchanged, deltaStart,
appendedAttempts and diagnostic. Reconstruct attempts by reading the exact base
artifact and appending each ordered transition delta (and any separate fatal
diagnostic delta); verify the final actual history SHA/header. If a prefix changes
or a foreign append exceeds the small delta bound, an exclusive complete final
history artifact is retained under exact-history-artifact-v1 instead. Historical
arrays are not duplicated into callback, transition or final result snapshots.
The owned 57,655-row regression initializes a real synthetic schema-2 ledger,
seeds only its ledger rows, exercises four actual ordinary/QT owner transitions,
then stops by predeclared caller abort. It proves exact reconstruction, unchanged
old prefix, checkpoint exports below 5 KiB and final export below 2 MiB. It never
inserts memory/card SQL or reads an operational ledger.

resources distinguishes physicalIntents, reservedMicroUsd, preparedStoreBytes,
transportLatencyMs, elapsedMs and unknown peakRss. knownMicroUsd is only the
partial-known sum: knownMicroUsdCoverage is partial-known-only,
unknownUsageIntents and unknownUsageReservedMicroUsd retain unpriced reservations,
and missingFinalRecords counts absent actual final records. Historical ledger
prices remain in the initial header/artifact; these fields concern new intents.
No missing usage or null price is presented as zero total spend.

### Concrete coverage and observed corrections

| Boundary | Actual control retained in the runner test |
| --- | --- |
| BR1 preparation | All24 real stores, 288 source receipts/cards, cold full logical snapshots, exhausted map, exact 12-candidate rank, omission counters, both independent wire/token routes; whole-preparation drift and single-use failure consumption |
| BR2 paired execution | All24 happy path: 48 QA plus 24 later probes, counterbalanced order, canonical questions, exact get/provenance, whole bundle evidence, actual rank/answer/select wire, 192 physical intents and 960,000 reserved microUSD |
| BR3 accounting/ownership | Actual ordinary/QT transitions and closed owner checkpoints; 57,655-row exact historical prefix/base/delta reconstruction; partial-known/unknown/missing-final accounting |
| BR4 consumed failures | Grouped all24 provider, malformed rank/answer, opaque error, actual ordinary 30-second never-response and actual QT 30-second never-response; no retry, settled records, remaining planned slots continue |
| BR4 global stops | Fresh genuine preparations for callback throw, event persistence collision, foreign append, actual core store drift, caller cancellation at answer and output-directory collision; fixed 48+24 slots retained, no next owner/dispatch |
| Runtime boundaries | Same concrete guard tests synchronous/late/never HTTP and body, caller versus local abort, hostile errors, and a real owned loopback native redirect with no follow; strict callback undefined/promise/accessor controls |
| Cleanup and real consumers | Actual ordinary rank/answer/select envelopes and healthy old-envelope rejection; actual SQLite child success/assertion/setup-failure cleanup with the owned workspace helper |

The first happy-path attempt exited 1 with 168 intents: fake HTTP envelopes did
not satisfy the unchanged ordinary adapter. A namespace-only fixture correction
also exited 1. The short actual consumer control isolated the mandatory object
fields (response and chat.completion); corrected envelopes passed actual rank,
answer and select, and the old envelopes remained rejected. The next all24 happy
path exited 0 with 192 intents. These are offline fixture interoperability
findings, not semantic model failures. An answer affordability assertion initially
exited 1 because it expected budget_blocked; the actual unchanged constructor
boundary returns ledger_failed before any intent. The assertion was corrected to
that observed closed code without changing the inherited transport.

The original added actual QT 30-second timeout control was green, not a reproduced
global-stop bug. Before structural hardening, runner SHA-256 was
f94132aa80f872e1bc757d7b623eefbc44a6587826b255c4650e3176c7386310 and test
SHA-256 was f166c1d3e237707df5999e577578ccec12d3971ce99e4b7e345469808c9ead7b.
Its unchanged raw QT failureCode was cancelled with settlementPersisted true;
core recall reported model_timeout and the remaining 24 probes completed.
The subsequent bounded ordering hardening explicitly awaits the actual in-flight
rank/select port after core's logical Promise.race resolves, before owner state,
close or successor binding. It also records raw and normalized planner failure,
health, caller-aborted and original-absolute-deadline observations. A local QT
timeout is normalized to consumed model_timeout only after healthy consumed
settlement, while caller signal and original case/run deadlines remain live and
no global fatal state exists. Raw QT records and the general fatal mapping are
unchanged. The hardened actual ordinary/QT 30-second group exited 0, retained the
raw cancelled/settlementPersisted record, and completed all24 probes. This proves
the tested ordering/control behavior, not that the earlier suspected race failed.

### Author commands and acceptance ownership

All logs remain under /tmp/cairn-br-runner-author.ok2ABBV6. Actual exits, not tails,
were captured. happy-first-node22.log and happy-diagnostic-node22.log exited 1;
consumer-complete-node22.log, happy-corrected-node22.log,
history-first-node22.log and answer-boundary-corrected-node22.log exited 0.
answer-boundary-node22.log exited 1 and is retained. focused-first-node22.log
records the full pre-hardening author run, 18/18, no skips/cancelled, actual exit 0
(about 479 seconds). It does not cover the final structural hardening.
planner-timeout-original-node22.log records the green original added QT control;
planner-timeout-hardened-node22.log records the final targeted actual group,
1/1, no skips, actual exit 0 (about 113 seconds). The original full diagnostic is
retained; final console projection includes only slot, failure, raw QT code,
settlement and continuation counts.

For final short checks, both pinned executables ran tools/testing/run.mjs with
--test-name-pattern='concrete guard|runtime observation|actual ordinary headroom|native loopback|actual ordinary transport consumes|preparation accepts|owned actual SQLite'
and evaluation/algorithm-development/test/source-bundle-runner.test.mjs.
short-final-node22.log and short-final-node24.log each record 7/7, no skips or
cancelled, actual exit 0. No final full18 author pass is claimed. Primary explicitly
owns the final fixed-byte complete algorithm-development suite on both pinned
Nodes, including every CF/BR scenario, plus its other eight required gates.
This avoids repeating the same expensive all24/history/timeout controls; it does
not remove a required test, expectation or final acceptance gate. Validation and
independent five-path inventory are recorded in the closing appendix below.

Closing author checks used /home/chichieh/.nvm/versions/node/v22.16.0/bin/node
and /home/chichieh/.nvm/versions/node/v24.15.0/bin/node. PATH selected each matching
bin before /usr/bin:/bin for npm run validate; both actual exits were 0, retained
in validate-final-node22.log and validate-final-node24.log. The owned runner's
seven-boundary checks included real child SQLite cleanup after success, assertion
failure and setup failure, with each exact owned child scratch path absent after
settlement. No broad cleanup was used, and no child remains running.

The closing inventory compares Git's fixed-base diff plus untracked/nonignored
paths with an independent filesystem walk, Git base blobs, content hashes and
file modes. Both routes have exactly five paths: docs/limitations.md,
docs/plans/source-bundle-comparison.md,
evaluation/algorithm-development/source-bundle-store.mjs,
evaluation/algorithm-development/source-bundle-runner.mjs and
evaluation/algorithm-development/test/source-bundle-runner.test.mjs. The helper
also asserts the unchanged fixed HEAD/branch, zero staged paths, byte-exact
14,669-byte contract prefix and full append-only inherited limitations prefix.
The original accepted BR1 store SHA-256 remains
efbed849309adbda3bb9c659cf03779222cea3a1b7f3a346ba20423dc227201f.
Its ignored tokenizer-only symlink and shared target are unchanged; no install,
lockfile, source fixture, rubric or inherited dependency source was modified.
inventory-final.json retains the complete candidate hashes and two-route proof.

Observed preflight on the corrected all24 happy run had 288 cards/receipts and
maximum local wire token counts of 2,787 ordinary count, 2,802 ordinary generation,
1,941 bundle count and 1,956 bundle generation, all below 6,000. Random store IDs
can change exact counts across fresh captures; every preparation checks its own
actual fixed wires. This observation is not a live-provider parity or usefulness
claim. Peak RSS, real provider behavior/prices, semantic first-answer support and
improvement remain unmeasured. No closed cohort, scoring run, paid launch,
operational ledger, real credential, D12 repair or Stage 2/3 clearance is claimed.

STOP WRITES for primary fixed-byte inspection and final acceptance. This is an
uncommitted five-path handoff; the author did not commit, push, merge or dispatch
a provider. Primary's final complete two-Node matrix and independent reviews
remain required before delivery or any later separately authorized launch.

## BR4 correction1 — resource overflow is a global stop

This bounded correction starts from fixed candidate
`f9ad1477bebe2756a92f035f37a01827facf0ae4`, after its complete primary
two-Node, eleven-command matrices passed but its final independent Spec review
found an uncovered resource-stop path. Those green matrices remain historical
evidence for f9ad, not acceptance of the corrected bytes. The full PR base stays
`51bf373de67680d1fcf5ac0a7b29de1ae0f7055b`; the integrated author base stays
`4423cd2bf91e3c479767bd1bebac3a6510846f07`. The original 14,669-byte contract
and every existing plan/limitations byte are preserved as prefixes.

The primary froze the prospective packet before dispatch at
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/bundle-comparison-correction1-contract.md`,
SHA-256 `040bfa2cc937700dad9b5c813a3fd21ed9f0af13ebbfdb629a1a3e16521bed3e`.
Its complete final Spec report is retained in
`bundle-comparison-reviews-candidate1.md`, SHA-256
`864b8642fc77aa2ff0b5fe52591c38abdde17a2fd5c069ef0cf830b909eaa724`.
Only the coordinator, its test, this append-only plan and append-only limitations
are in this correction. The accepted store, ordinary adapter/transport, QT/QB/CF,
core, corpus, rubric, limits and dependencies remain unchanged. The separate
three-file SJ3 subpacket remains stopped and byte-identical. Author model/effort
is actual GPT-6.1 Sol/high; model cost is not exposed and is not inferred.

### Observed red paths and causal correction

Both new controls first ran against the unchanged f9ad runtime. Each creates a
fresh owned complete 24-case preparation and uses the actual imported ordinary
transport, core and runner with the existing fake envelopes, changing only one
BQ01 count response to valid `input_tokens: 7025`. They use deterministic stage
identity, not evaluator answers or gold-informed selection. The rank control
actually exited 1 (0/1, zero skips, about 49.5 seconds): status `accounted`,
no stop reason, ordinary slot `provider_failed`, 190 calls/intents and 119 closed
owners. The separate natural-probe select control actually exited 1 (0/1, zero
skips, about 45.5 seconds): status `accounted`, probe `invalid_model_output`,
191 calls/intents and 120 closed owners. Both retained the exact raw count
failure `context_budget_exceeded`, provider count 7025 and a settled unknown
5,000-microUSD reservation with no pending attempt. Both retained 48 QA and 24
probe slots, but erroneously continued the remaining schedule.

These are reproduced offline coordinator failures, not semantic model outcomes.
The actual chain has two normalization seams: ordinary transport rejects the
count while persisting its raw closed cause; unchanged adapter `post` normalizes
the rejection to provider failure; core can then return an error envelope.
The former probe path discarded even the settled port cause. The review also
identified a potential core-timeout priority masking path; the two count controls
do not independently reproduce a delayed-overflow/time-race variant.

The coordinator now classifies `context_budget_exceeded` as globally fatal.
After a successfully persisted, already attempt/wire-bound ordinary final
record, its exact closed overflow code sets the coordinator stop without
throwing from the record callback or changing any raw field. This avoids a false
persistence failure and preserves the inherited transport's healthy status.
Rank and select wrappers retain the coordinator fatal cause before an adapter
or core envelope can mask it; select records `artifacts.selectFailure: {code}`.
The select catch also encloses local pre-dispatch validation/serialization
failures. Fatal settled port causes have priority over logical timeout
projection. No exception is treated as authority through an arbitrary error
string or accessor. Actual in-flight settlement is still awaited before owner
state/close; there is no retry, deadline renewal, cap change or transport edit.

The pre-fix runtime SHA-256 was
`d4fe4e382be0d63aa5f4146e132bd9239c3f341a99ba65ff83aeeb7f0e0f2c07`.
Final corrected runtime SHA-256 is
`564fed8502536e6b8612ae018479527ffe356bec0fed5aa7570747ae284c7f89`.
The same red/green test file SHA-256 is
`b44dace759ba566013418b0d398c8beb1a8559906f374f73721e7dab0af50c5c`.
An initial corrected Node22 run passed both controls; after indentation-only
alignment, both final-byte runtime checks below were rerun. Earlier logs are
retained rather than overwritten.

### Final correction verification

Evidence directory: `/tmp/cairn-br-correction1-author.O9vPAsa7`.
The owned runner command for each pinned executable was
`node tools/testing/run.mjs --test-name-pattern='provider count overflow at BQ01 ordinary' evaluation/algorithm-development/test/source-bundle-runner.test.mjs`.
`green-final-overflow-node22.log` actually exited 0, 2/2, zero skips or
cancellations, about 55.8 seconds. `green-final-overflow-node24.log` actually
exited 0, 2/2, zero skips or cancellations, about 64.3 seconds. The two fresh
preparations run sequentially within each invocation; heavy invocations never
overlap. Both boundaries stop with exact `context_budget_exceeded`: rank has
only one count intent and one healthy closed owner; probe has seven total
intents and five healthy closed owners, including its two already-completed QA
answers. Neither dispatches the failed boundary's generation or binds any later
owner. The tests independently inspect the owned schema-2 ledger, proving no
pending attempts and the conservative unknown 5,000-microUSD count reservation.
Every remaining slot is not-run with the exact stop reason; all 48 QA and 24
probe denominators remain. Both exact owned workspaces are removed in `finally`,
including the initial assertion failures, and the genuine preparation remains
single-use.

The existing actual ordinary/QT logical-timeout/nonfatal continuation group was
also rerun on final bytes using Node22 and
`--test-name-pattern='healthy malformed, provider and logical-timeout'`.
`nonfatal-timeouts-final-node22.log` actually exited 0, 1/1, zero skips or
cancellations, about 108.8 seconds. Healthy provider/malformed/local-timeout
failures still consume their slots and continue; ordinary and planner failures
remain `model_timeout`, raw QT `cancelled` remains unchanged with settlement
persisted, global stop remains null and all 24 probes complete. No real 30-second
timeout, fixture or expectation was shortened or relaxed.

The final seven selected boundary checks use
`--test-name-pattern='concrete guard|runtime observation|actual ordinary headroom|native loopback|actual ordinary transport consumes|preparation accepts|owned actual SQLite'`.
Both pinned Nodes actually exited 0, 7/7, zero skips/cancellations, retained in
`short-final-node22.log` and `short-final-node24.log`. These include owned child
SQLite cleanup after success, assertion and setup failure. Node22.16.0 and
Node24.15.0 are the pinned executables under `/home/chichieh/.nvm/versions/node`;
no dependency install or shared-target mutation was performed. Final validation,
syntax, whitespace and independent four-path inventory are closing checks.
Primary owns the corrected complete eleven-command matrices on both runtimes
and fresh full ten-path Standards/Spec reviews before any delivery. The author
does not claim a new complete algorithm/generic matrix from selected controls.

The retained red logs are `red-rank-node22.log` (SHA-256
`d6826ee0c9ed37fa0547d45900f41ad89e8f982d38f1fb33759ce040a4c862d7`)
and `red-select-node22.log` (SHA-256
`a4481e3f8a9abdbd41871592e72f8f9377cd9971366795012f56300ff750a153`).
`red-input-hashes.txt`, `green-input-hashes.txt` and `final-input-hashes.txt`
bind the exact tested source snapshots. Final inventory compares Git's diff
against f9ad with an independent filesystem/base-blob/mode scan, checking four
correction paths, zero staged paths, append-only documentation and unchanged
store/dependencies plus all three stopped SJ3 hashes. No operational ledger,
real key/provider, paid authority, efficacy score, D12 repair or original Stage
2/3 clearance is involved. STOP uncommitted/unstaged for primary acceptance.

Closing validation actually exited 0 on both pinned Nodes, retained in
`validate-final-node22.log` and `validate-final-node24.log`; syntax checks on
both runtimes and `git diff --check` also actually exited 0. The independent
inventory actually exited 0, count four, zero staged paths. It proves the full
prior plan and limitations prefixes are append-only, the original contract is
unchanged, every other f9ad base blob/mode including the accepted store is
unchanged, and all three stopped SJ3 hashes still match. The existing ignored
tokenizer-only symlink was verified with `git check-ignore` and `ls -ld`, with
its same relation-binding-probe target untouched. `inventory-final.json` retains
the four final candidate hashes. No owned test invocation or subprocess remains
active; no broad cleanup was used. The author is now STOP WRITES.

## Prospective correction2 contract (verbatim)

# BR4 correction2 — bounded aggregate report retention

Prospective primary decision, 2026-10-11 21:20 UTC. No paid launch, new algorithm,
metric, retry, budget, transport/model/output/token relaxation or main merge.

Worktree `/home/chichieh/Github/cairn-memory-worktrees/source-bundle-comparison`,
branch `experiment/source-bundle-comparison`, current runtime
`d60855fc6fc8563d32441ae2d76504a672c8158d`.
Full review base remains `51bf373de67680d1fcf5ac0a7b29de1ae0f7055b`; integration
base remains `4423cd2bf91e3c479767bd1bebac3a6510846f07`.
The diagnostic test is the only existing uncommitted change, SHA256
`96509ff99cfe244585ba4915be45581caabaf590a3ecd02199d7a9ce67be1be6`.

## Diagnosis and scope

Actual original all24 runner regression exited1:192 dispatched and settled
intents,120 healthy closed owners, no pending attempts, all192 literal callback
and durable post records retained, consumed preparation rejected a second call.
Raw response strings total36,175,872 bytes; final snapshot's32MiB byte charge
throws invalid_options before result.json. Error stack identifies byte charge,
not node/depth rejection or disk writing. Owned inner and outer scratch cleanup
passed. Preserve `/tmp/cairn-br-correction2-author.GpNPzFdN/red-node22.log` and
its original inventory/diff unchanged.

Primary independently ran `probe-bundle-report-budget.mjs`, actual0: the real
snapshot helper rejects those body strings at32MiB, accepts them with a separate
literal-response allowance under the SAME500000-node/depth28 checks, and still
rejects excessive nonresponse metadata. This is a pure minimizing control, not
a substitute for the actual runner regression.

Allowed correction files only:

- evaluation/algorithm-development/source-bundle-runner.mjs
- evaluation/algorithm-development/test/source-bundle-runner.test.mjs
- docs/plans/source-bundle-comparison.md (append only)
- docs/limitations.md (append only)

Do not change store/QT/QB/CF/core/ordinary transport, corpus/rubric, provider
serialization, ceilings, dependencies/CI, scored results or the SC worktree.

## C2.1 — separate the aggregate raw-body allowance

Keep the existing default32MiB/500000-node/depth28 defensive snapshot for every
ordinary input, callback, individual raw record and structured observation.
Only final report construction may add an allowance equal to the UTF-8 byte
length of its already retained intent.final.responseBody strings. Those strings
appear once each in the final report, and must remain literal: no trimming,
summarization, replacement by hashes, dropped intents or missing slots. The
nonresponse aggregate budget remains32MiB, nodes/depth unchanged. Do not globally
raise copy()'s ordinary limit or accept a caller-supplied report budget.

The aggregate allowance must itself be bounded by the existing192 intents and
the existing physical body ceiling. A conservative bound is192*262144*3 bytes:
the unchanged ordinary transport decodes UTF-8 with replacement (at most3 UTF-8
bytes per physical input byte); QT uses a fatal decoder and is tighter. Count
bodies remain65536 and generation/answer bodies262144 physical bytes. Secret
redaction does not expand these admitted bodies. Validate finite safe bounds,
do not reinterpret this as new network permission. This yields at most176MiB
of admitted string/key bytes in the final defensive snapshot; it is NOT a
whole-process RSS or serialized-file-size promise. Charge only actual literal
response bytes, not the conservative maximum, to preserve metadata isolation.

Keep the runner's public result schema, one-use lifecycle, fixed48QA+24probes,
fatal/nonfatal policy, raw observation persistence, accounting and external
callbacks unchanged. Do not add an export/factory solely for tests. No unrelated
refactor or memory optimization. A genuine disk/process failure still cannot
promise a persisted report; existing durable per-event evidence remains, and no
resume/retry is introduced. This correction concerns accepted aggregate bodies.

## C2.2 — actual full and resource-stopped regressions

Retain the existing complete192-intent padded-response diagnostic as the exact
red/green control, with tiny valid model content and literal-body verification.
Add one bounded sibling variant: same fresh all24 setup and legal padded HTTP,
but BQ24 natural-probe ordinary select count returns input_tokens7025. Expected:
191 settled intents, no last select generation,120closed healthy owners, all48
actual first answers retained,24probe slots (last failed), status stopped with
context_budget_exceeded, all literal response bodies/report retained and no
pending attempts. This exceeds32MiB before the resource stop and therefore
proves the fix preserves reporting of a real resource failure too.

Run that new sibling once RED on unchanged d60855 runtime before patching it.
Keep the first full192 diagnostic log unchanged; do not rerun it merely to get
another red. Then implement C2.1 and run both actual regressions on22.16/24.15.
Assert persisted result equals returned report and each retained raw body equals
its actual dispatched fixture; preserve all72slot identities/first answers,
raw overflow cause, reservation and closed capability. Owned workspace removed
after each successful/failed test. No paid/cohort replay or operational ledger.

Add a short negative at the existing callback boundary proving a32MiB excess
observation still fails record_persistence_failed without calling the callback;
do not export a general copy helper. Keep the original required failure/timeout
controls unchanged. No source-index/gold/rubric-informed semantic answers.

## C2.3 — evidence, freeze and delivery

Append the exact root cause, the two-budget rationale and conservative bound,
red/green logs/actual exits/cleanup, changed entrypoints and limitations to the
existing plan and limitations. Original14669-byte contract and all prior records
remain byte-exact. This prospective correction2 contract is appended verbatim
to the plan before final author STOP; it clarifies local artifact retention,
not any paid-execution or semantic-quality gate.

Author: actual GPT-6.1 Sol/high, same bounded owner. Run targeted two regressions
on both Nodes, short controls and validate; independently derive exactly four
changed paths and preserve dependency hashes. STOP uncommitted/unstaged, report
actual exits and raw artifacts. Primary directly inspects all four changed files,
runs the required final11-command matrices on both runtimes (including complete
algorithm and unchanged budget/guard/LongMemEval/generic/demo/Claude gates), and
cross-checks tested snapshots and Git versus filesystem inventory before commit.
No tests or source mutation concurrently with a primary matrix.

Both nonauthor final full10-path review axes must pass on the same new fixed
candidate before push/dependent PR. Latest exact-head CI and mergeability before
delivery. Existing prospective offline-SC-during-CI scheduling amendment applies
only after those local gates, both reviews and exact push. No new user decision
is required for this bounded correction; no full SC or paid GO is given here.


## Correction2 implementation and diagnostic history

Author: actual GPT-6.1 Sol/high. Fixed correction base is
`d60855fc6fc8563d32441ae2d76504a672c8158d`; no inherited source, store,
transport, core, source/rubric, dependency, cap or schema changes are authorized.
The original diagnostic uses the genuine all24 preparation, real ordinary/QT
transports, a fresh owned synthetic schema2 ledger and deterministic fake HTTP.
Legal trailing JSON whitespace fills each count response to 65,536 physical
bytes and each generation/answer response to 262,144 bytes, without changing
model content, token counts, output ceilings or the fixed schedule.

The original 192-intent diagnostic actually exited 1 on Node22, 0/1, zero skips
or cancellations, about 54.3 seconds. Retained evidence is
`/tmp/cairn-br-correction2-author.GpNPzFdN/red-node22.log` (SHA-256
`371db801cd35fd654ee66d9cb059597e0767aa9d2e64b4bf341242285299f755`),
with its unchanged original diff and two-route inventory. All 192 responses
were literal in callback and durable post records; all 120 owners were closed
healthy, all 192 ledger attempts settled, 960,000 microUSD reserved, zero pending.
The raw bodies totaled 36,175,872 bytes. Final aggregate snapshot byte charging
threw `invalid_options` at runner line 506 before returning or writing
`result.json`; this was not a transport, node/depth or disk-writing failure.
The consumed capability rejected another invocation and finally cleanup removed
both the owned case workspace and the outer runner workspace.

Before any runtime edit, the distinct BQ24 natural-select overflow sibling
actually exited 1 on Node22, 0/1, zero skips/cancellations, about 58.0 seconds.
Its retained log is
`/tmp/cairn-br-correction2-fix.zZuYrdqa/red-stopped-node22.log` (SHA-256
`044f147445e91fd0b402ab50a0016dbb16c37460a30ecf6fce17a2ce47706e27`),
with exact tested input hashes. Its 191 responses totaled 35,913,728 bytes;
191 intents settled, 120 owners closed healthy, 955,000 microUSD reserved,
zero pending, and every callback/durable response remained literal. The same
aggregate byte charge lost the final report after that resource stop. Capability
reuse was rejected and owned cleanup passed. Neither red log is overwritten.

The only changed runtime call site is final report construction in
`runSourceBundleComparison`. Its private `copyFinalReport` grants only the
actual UTF-8 bytes of already retained `intent.final.responseBody` strings,
which occur once each in that report. It validates safe integer byte counts,
at most 192 intents and at most `262144 * 3` bytes per admitted decoded body,
then applies the same 500,000-node/depth28 checks with 32MiB plus those actual
body bytes. The total admitted string/key ceiling is at most 176MiB; remaining
metadata still gets only 32MiB. No caller-controlled budget, helper export,
network allowance or result-schema change is introduced. Ordinary `copy`,
inputs, callbacks and individual observations retain their original 32MiB cap.
The separate oversized callback negative must reject before calling its observer.

This addresses accepted aggregate retention, not whole-process RSS or file-size
measurement; JSON escaping, copies and runtime allocations are separate. Genuine
disk/process failures can still prevent a final report; durable per-event
evidence and no-resume/no-retry policy remain. Both corrected padded regressions,
short controls and validation will be retained below; primary owns complete
final eleven-command matrices and both new full ten-path review axes.

### Correction2 targeted red/green verification

Corrected runtime/test input hashes are retained in
`/tmp/cairn-br-correction2-fix.zZuYrdqa/green-input-hashes.txt`. Both heavy
invocations ran sequentially, with no source mutation while either was active.
The command on each pinned executable was
`node tools/testing/run.mjs --test-name-pattern='all 24 padded-valid responses retain' evaluation/algorithm-development/test/source-bundle-runner.test.mjs`,
under an explicit key-free environment and an owned `test-parent` directory.
`green-padded-node22.log` actually exited 0, 2/2, zero skips/cancellations,
about 119.4 seconds; `green-padded-node24.log` actually exited 0, 2/2, zero
skips/cancellations, about 125.3 seconds. All48 first literal plumbing answers
and all24 probe slots survive in both returned and persisted reports; every
intent's response body equals its actual dispatched padded fixture and durable
post record, and `result.json` equals the returned report.

The full variant is accounted with 192 intents, 960,000 microUSD reservation,
120 healthy closed owners, zero pending and 24 completed probes. The late BQ24
select-overflow variant remains honestly stopped with `context_budget_exceeded`,
191 intents, 955,000 microUSD reservation, 120 healthy closed owners, zero pending,
23 completed probes and the last probe failed. Its raw count remains 7,025,
`selectFailure` remains the exact fatal code, no last select generation occurs,
and its unknown outcome/null price conservatively retains the 5,000 microUSD
reservation. All72 canonical public slot identities remain present; the
natural probe is not an answer or semantic score. Each successful and red
fixture rejects another invocation with the consumed preparation and removes
its owned workspace in `finally`.

The selected eight short checks use
`--test-name-pattern='default callback snapshot|concrete guard|runtime observation|actual ordinary headroom|native loopback|actual ordinary transport consumes|preparation accepts|owned actual SQLite'`.
`short-node22.log` and `short-node24.log` each actually exited 0, 8/8, zero skips
or cancellations. The new negative sends an observation exceeding 32MiB through
the existing public callback boundary: it still throws
`record_persistence_failed` before invoking that callback. Existing HTTP/body,
native redirect, headroom, malformed-envelope and owned SQLite cleanup controls
are unchanged. No complete algorithm/generic matrix is claimed by these
selected author commands; primary owns the final full gates and reviews.

All logs and snapshots above are retained under
`/tmp/cairn-br-correction2-fix.zZuYrdqa`; the original full192 red directory
remains untouched. Final syntax/validation and independent four-path inventory
are the closing checks. The inventory compares Git's d60855 diff with a separate
recursive filesystem Git-blob/mode derivation, and checks append-only plan and
limitations, unchanged inherited dependencies/store, original14669-byte prefix,
the verbatim prospective correction2 contract and zero owned scratch residue.
No real key/provider, operational ledger, closed cohort, score, launch grant,
commit, push, merge or stopped SC source is changed.

Closing validation actually exited 0 on both pinned Nodes, retained in
`validate-first-node22.log` and `validate-first-node24.log`; `git diff --check`
also actually exited 0. The first independent inventory actually exited 0,
exactly four paths, zero staged paths and zero owned parent-directory residue,
with full append-only and contract/dependency checks. Final validation and
inventory are repeated after this closing evidence append to bind final bytes;
their logs and `inventory-final.json` retain the handoff evidence and hashes.
No owned test subprocess remains. The author stops uncommitted/unstaged for
primary inspection, final full matrices and both independent review axes.
