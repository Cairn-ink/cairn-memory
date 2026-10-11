# Source-bundle planner transport — prospective offline contract

Primary decision, 2026-10-11. This is the next bounded implementation packet
after the query-local bundle prototype's fixed-diff primary acceptance and
independent reviews pass. Its exact base SHA will be recorded in dispatch.
Dependent worktree/PR is allowed; no main edits, merge, release, deployment,
historical cleanup, credential discovery or live call is included here.

The goal is to test whether query-local evidence sets improve supported first
answers within a lightweight memory layer. This packet only makes the existing
injected planner eligible for separately reviewed model experiments; fake HTTP
and a ledger are not semantic evidence. All closed cohorts/results/first judges
remain closed and unchanged. D12 and original Stage 2/3 gates remain uncleared.

## Scope

Exactly six allowed paths:

- evaluation/architecture/source-bundle-plan-rank-transport.mjs (new)
- evaluation/architecture/test/source-bundle-plan-rank-transport.test.mjs (new)
- docs/plans/source-bundle-plan-rank-transport.md (new; preserve this contract)
- docs/limitations.md (append only)
- ROADMAP.md (small checkpoint)
- .github/workflows/ci.yml (one required offline bundle-test step in the existing core matrix)

No dependency, package script, public adapter/core/default, old transport/guard,
ledger schema, closed profile, scorer, source fixture or old result changes.
The original paid transport and guard prompt/schema allowlists are not widened.
If another path is needed, stop for primary scope review before editing it.

## QT1–QT8 acceptance

QT1 — Expose a separately named, single-use `source-bundle-plan-rank-v1`
transport with explicit constructor dependencies: configuration, checkpoint,
historySha256, manifest, apiKey, fetchImpl, onRecord. No environment lookup,
default key/network, arbitrary URL/model/prompt/schema option, retry/fallback,
runner or new evaluator. Return planRank, immutable records, health/state and
close interfaces only. A failed first invocation consumes its slot too; reject
concurrent/reentrant/repeated use. Descriptor-safe detached configuration and
manifest, typed closed-vocabulary errors, no raw provider text in error codes.

Primary API clarification before implementation: an async factory may dynamically
import ledger/tokenizer only during construction so generic Node20 discovery is
dependency-free. There is no runtime fallback. Its exported capabilities are
planRank, getRecords, getState, health and close. health returns an immutable
state (ready/active/consumed/closed) plus a nullable closed-vocabulary fatal code;
consumed ordinary failure is not confused with a whole-run safety anomaly.
Closing while active rejects without abandoning settlement of the active call.

Manifest has exactly version, slotId, preparedRequestSha256, runDeadline and
caseDeadline. Version is fixed above; slotId is a bounded nonempty safe identifier;
hash is lowercase SHA256 of the exact prepared representation without signal.
Deadlines are finite positive process-local monotonic timestamps, not restartable
wall-clock authority. Request has exactly system/input/outputSchema/
maxOutputTokens/signal and comes from the frozen bundle wrapper. Validate the
fixed instruction, exact catalog/query/limits and independently reconstructed
closed schema via the existing preparation/compiler behavior. Do not merely
trust caller-supplied schema or a matching self-reported hash. Reject mutation,
accessors, inherited/sparse/invalid data and credential echo before dispatch.

QT2 — Pin evaluated model gpt-4.1-mini-2025-04-14, not the worker's GPT-6.1 Sol.
Only two POST endpoints are permitted: https://api.openai.com/v1/responses/input_tokens
then https://api.openai.com/v1/responses, redirect:error. Count body is exactly:
model, instructions=fixed bundle instruction, input=[{role:'user',content:[
{type:'input_text',text:JSON.stringify(prepared.input)}]}], text={format:{
type:'json_schema',name:'cairn_source_bundle_plan_rank_v1',strict:true,
schema:the validated dynamic bundle schema}}, truncation:'disabled'. Generation
adds only max_output_tokens:1024, store:false, stream:false. One count and at
most one generation, never automatic retry. Exact byte and hash assertions use
independently constructed expected bodies, not the implementation's serializer.

The complete prepared representation AND each actual serialized provider body
must fit 6,000 local tokens before reserving any call. Provider count must fit
7,024; no truncation or source shortening. Reject request overflow without HTTP.
Local tokenization must use the existing real tokenizer; no runtime estimate.

QT3 — One logical deadline covers count, generation and reading response bodies:
minimum of 30 seconds, manifest case remainder and run remainder, preserving
the wrapper/core abort signal. The inherited physical 200-second ceiling does
not extend logical time. Cancellation/timeout before dispatch reserves nothing;
an already dispatched call retains its reservation and outcome/known usage.
Here pre-dispatch cancellation means cancellation already observable at the last
pre-reservation check: it creates no attempt. Once a durable reservation exists,
retain it even if the synchronous observation callback cancels or fails before
fetch is invoked; this is a recorded unsent attempt, not a refund or a successful
physical request. Records must distinguish `dispatched:false` from actual HTTP.
This clarification preserves the existing conservative ledger intent boundary.
Abort-race handling must bound never-resolving fetch and stream reads without
leaking a late response body. No timeout renewal between count and generation.
Closing while active must reject or safely cancel/settle; no lost pending row.

QT4 — Existing schema-2 cumulative ledger ONLY through a single bound handle.
Require exact configuration/checkpoint/history witness, open state, no pending
attempt, cumulative ceiling <=US$400, protected US$30 and room for both 5,000-
microUSD physical reservations plus two request slots. Inspect again before
each dispatch; do not reset/refund/replace the ledger or relax foreign-append
detection. Reserve 5,000 microUSD before count and before generation, channel
cairn-count/cairn-generation. Retain unknown reservations. Validate and price
reported generation usage, including failed HTTP or usage-overrun responses,
using the unchanged pinned profile; actual price is not an invoice. Usage/model,
auth/redirect, credential, record-persistence or accounting anomalies make this
transport unhealthy and must be exposed as whole-run stops to a future runner.
Ordinary settled provider/timeout failure is still a consumed first slot.

QT5 — Persist immutable pre/post observations synchronously around each physical
request, including exact redacted wire bodies, endpoint, attempt identity,
slot/request identity, input/output usage, reservation/known-price/outcome,
monotonic latency and bounded failure code. Raw response bounds are 65,536 bytes
for count and 262,144 for generation. Detect direct and JSON-escaped credential
echo before exposing bodies; no Authorization header or secret in records/errors.
Callback failure is fatal; the ledger still records the dispatched outcome in
finally. onRecord must return undefined synchronously. Unknown usage remains
unknown, not zero, and malformed/overrun usage cannot be hidden by parse failure.

QT6 — Parse only a completed pinned-model Responses message with one assistant
output_text result, no refusal/incomplete/tool output or ambiguous extra text.
Before parsing the generated JSON, bound RAW text to <=40,000 chars and <=1,024
local tokens (including whitespace); do not measure only compacted parsed data.
Validate complete usage and the existing bundle compiler's relational limits,
and preserve the proposal without inventing/repairing indices or prerequisites.
The unchanged wrapper and evidence assembler remain responsible for sidecar,
core freshness, whole-card provenance, overlap/partial packing and answer cap.
No generated relation is treated as identity/truth/adoption/authority proof.

QT7 — Offline tests use fresh owned synthetic schema-2 ledgers, fake HTTP and
synthetic keys, never the operational ledger/configuration/corpus. Actual pinned
tokenizer is mandatory in a separately identified required path; dependency-free
generic CI must remain runnable without installing the optional adapter. Required
acceptance must fail missing prerequisites, not silently skip/fallback. Cover
exact wire/count-generation sequence, complete-envelope token overflow, valid
and empty proposals, malformed schema/indices, raw whitespace size, poison
descriptors/mutation, refusal/incomplete/model/usage anomalies, known failed-call
usage and overrun, never-resolving/late fetch/stream, deadline/abort between calls,
credential echo, persistence failure, cancellation in the pre-observation hook
(retained unsent reservation, no HTTP), exact reservations/outcomes, consumed-slot
reuse/concurrency, foreign append and insufficient protected balance/headroom.
Assert original ledger history prefix unchanged and all owned fixtures removed
on success/assertion/setup failures. Retain actual failed test logs and diagnosis.

Preimplementation fixture layout: no static SQLite/adapter imports; one pure
prerequisite-selection control and one async integration parent named with
`actual local tokenizer`. Only unsupported SQLite or specifically missing optional
tiktoken may skip that parent once in generic mode; unrelated import failures
must propagate. `CAIRN_BUNDLE_TRANSPORT_REQUIRED=1` makes missing prerequisites
fail, never skip or substitute a counter. Required primary gates also retain
inherited `CAIRN_BUNDLE_TOKENIZER_REQUIRED=1`. On dependency-free Node22/24
archives the new suite contributes exactly one skip, plus inherited QB's one
optional-tokenizer skip in combined generic tests; required-missing denial has
actual exit 1 and no skipped tests. All child behavior tests use the real tokenizer.

Primary CI decision before implementation: generic CI intentionally has no optional
adapter installation, so its one skipped integration parent cannot be the sole
remote check. In the existing Node22.16/24 core matrix, immediately after the
already-present locked OpenAI dependency installation, add exactly one owned-runner
step executing the two inherited QB files and the new QT file with both required
flags set to 1. No new job, dependency, permission, secret or paid command. Thus
remote CI runs these actual-tokenizer controls, while generic discovery remains
dependency-free. Do not claim the optional generic skip validates transport behavior.

QT8 — Primary directly inspects all six paths and independently re-derives the
inventory; personally runs focused required-tokenizer tests, generic tests,
budget/guard regressions, validation and both Claude validators on Node22.16/
24.15 with actual exit/raw logs/owned cleanup. A fresh dependency-free committed
archive must demonstrate generic compatibility and required-prerequisite denial.
Freeze exact local commit after gates; separate nonauthor Standards and Spec
review that fixed full diff. No push before both pass. Latest remote head CI and
mergeability required; no merge/release/deploy. Passing tests gives no live grant.

## Subsequent experimental plan, not this packet's authority

First freeze new authored source-only cases and support rubric. Compare ordinary
rank versus source bundles using identical captured stores and query-independent
shared scripted upstream selection; verify the actual rank input contains the
needed bridges. This is an explicit rank-visible diagnostic, not natural end-to-
end, official LongMemEval, Mem0 parity or installed-Hermes readiness. Score first
answers and packed-source support independently; preserve unknowns/disagreements.
Separately control natural selection versus query-local upstream recovery so an
upstream omission is not mislabeled a ranking failure. Track source availability,
rank visibility, selected receipts, packed prerequisites, supported answers and
latency/token/resource changes. Reject new severe/increased unsupported or stale
harm, resource overrun or lack of useful supported-answer benefit.

Do not interleave independently bound ordinary/planner ledger handles: the bound
witness intentionally rejects foreign appends. A later coordinating runner must
have one owner at a time, explicitly close/rebind at witnessed phase boundaries,
and independently test that lifecycle. No relaxation of that check is authorized.
Any future paid cohort needs its own frozen manifest/rubric, reviews, affordability
and one first execution; original cumulative US$400/protected US$30 unchanged.

## Sources informing the wire, not efficacy

Official OpenAI Structured Outputs documentation:
https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
and input-token endpoint reference:
https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count
were searched/opened by primary on 2026-10-11. Strict structure does not establish
semantic correctness. Local adapter/transport/profile behavior remains the
frozen compatibility reference; no model migration or competitive score claim.

## Implementation and author evidence

Implementation base: `be7ab7ac4afca9007461bbf64ca1596a7ce10aca`, isolated
`experiment/source-bundle-transport`. The entire prospective contract above is
preserved verbatim. Actual author: GPT-6.1 Sol/high. Primary owns integration,
direct diff inspection, independent inventory/gates and subsequent nonauthor
Standards/Spec reviews; none is claimed complete by this author evidence.

The new async `createSourceBundlePlanRankTransport` takes exactly
`configuration, checkpoint, historySha256, manifest, apiKey, fetchImpl, onRecord`.
It returns only `planRank/getRecords/getState/health/close`. Importing the module
does not load SQLite or tiktoken; constructing it requires both, with no fallback.
There is no environment/key/network default. The one invocation transitions
ready → active → consumed even on failure; closing while active rejects.
Immutable health distinguishes consumed ordinary failure from a fatal safety or
accounting code. No runner is supplied or authorized by this packet.

Changed entrypoints/callers and verification owners:

- New transport: one bound schema-2 ledger owner, catalog rehydration through
  unchanged `prepareBundleRankRequest`, independently reconstructed fixed schema,
  immutable pre/post records and unchanged `compileBundlePlan`. The only current
  caller is its offline test suite. A later caller must explicitly inject
  `transport.planRank` into the unchanged `createBundleRankModel` wrapper and
  propagate fatal health as a whole-run stop; this does not widen old guards.
- New single-file suite: owned synthetic ledgers, synthetic keys and fake HTTP;
  one pure prerequisite test and one optional integration parent, with every
  behavior child using the real tokenizer. Required flags forbid prerequisite
  skips; generic absence skips the integration parent exactly once.
- CI: one required offline step after the existing locked OpenAI installation in
  the existing core matrix runs both inherited bundle files and the new suite.
  No package, job, permission, dependency or secret was added. Primary independently
  verifies the dependency-free archive and required-missing denial later.

All three local serialized envelopes are independently limited to 6,000 tokens
before reservation. Generation is exactly the count payload plus output/store/
stream fields; actual wire strings and hashes have an independent test oracle.
One absolute monotonic deadline covers both calls and body reads. A cancellation
already observable before reservation creates no attempt; after reservation a
pre-observation cancellation/failure settles an unsent `dispatched:false` intent
without refund. Actual dispatch then timeout retains an unknown reservation.
Late fetch bodies and immediate-abort reads are canceled without timer renewal.

Valid reported usage is retained and priced before HTTP/auth/redirect/model/
output rejection, including safely parsed credential-echo envelopes whose bodies
and response identifiers are never exposed. Pricing uses the unchanged combined
integer ceiling (one input plus one output token costs two microUSD), not separate
per-component rounding. Failed HTTP with absent usage remains unknown and ordinary;
supplied malformed usage or successful missing usage is fatal. Unparseable,
oversized or invalid-usage bodies cannot establish a known price. Estimates are
not invoices. Record callback failures remain fatal even after ledger settlement;
actual settlement-write failure leaves the retained pending intent and fatal health.

Worker raw evidence: `/tmp/cairn-source-bundle-transport-worker.EVbMrgC1`.
The first standalone required focused run on each pinned Node exited **1**:
`focused-first-node22.log` and `focused-first-node24.log`. Two pressure-fixture
assumptions failed: twelve cards did not reach complete-envelope overflow, and
2,000 repeated space/newline pairs encoded to only 1,000 tokens. One bounded
test-only correction used eighteen cards and 2,200 pairs, with actual token-bound
assertions. No limit, source or compiler behavior changed. The combined inherited
QB/new-QT correction run `focused-correction1-node22.log` exited **0**, 41/41,
zero skips. Subsequent NBSP JSON-grammar and synchronous-fetch/reader-abort
controls passed both Nodes in `focused-final-node22.log` and
`focused-final-node24.log`, actual **0**, 43/43, zero skips.

Final handoff focused commands use both required flags and
`node tools/testing/run.mjs` with the inherited rank/integration files and the
new transport suite. `focused-handoff-node22.log` and
`focused-handoff-node24.log` retain actual outputs/statuses. Added final controls
bind credential-echo response-ID redaction, generation post-observer failure,
generation unsent cancellation and the generation raw-byte bound. Both final
handoff focused commands exited **0**, 43/43, zero skips. `npm run validate`
on pinned Node22.16/24.15 exited **0** (`validate-node22.log`,
`validate-node24.log`). Owned fixture teardown covers actual success, assertion
failure and setup failure paths; original ledger rows are independently inspected
and unchanged. No operational script was run (`scripts/README.md` is absent),
no provider call/key/operational ledger was used and no closed cohort was opened.

This is accounting/wire/fidelity evidence only, not supported-answer improvement,
D12 repair, model authority, installed-host readiness or lightweight performance.
Primary full gates, archive proof, exact scoped commit, fixed-diff independent
reviews and remote CI remain separate delivery gates. Any subsequent new-source
experiment needs its own frozen protocol, independent judgments and explicit grant.

Final author closure additionally checks direct/Unicode-escaped credential IDs
with safe known usage and typed rejection of throwing descriptor traps. Frozen
focused logs are `focused-freeze-final-node22.log` and
`focused-freeze-final-node24.log`; validation closure logs are
`validate-freeze-node22.log` and `validate-freeze-node24.log`. The first inventory
probe exited 1 because its harness mistakenly treated no-index diff's normal
exit 1 with empty diagnostics as whitespace failure (`inventory-first-probe.log`).
The corrected probe distinguishes that status from whitespace diagnostics and
cross-checks diff-plus-untracked against porcelain inventory; no source edit was
needed for that harness correction. Primary repeats inventory independently.
