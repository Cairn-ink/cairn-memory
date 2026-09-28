# Fresh source localization: N3 preparation

Status: offline implementation locally verified; independent review and remote
delivery remain pending at this checkpoint. Fixed base
`1bba188db06c747a7a6f73345ce09c24e87b2b7f` (N2, PR #283).
Branch/worktree: `test/fresh-source-localization` / `fresh-source-localization`.
The authorized dependent-branch workflow leaves the parent and main untouched.

## Goal and decision

Deliver a lightweight, source-backed memory layer for MCP, Hermes and other
harnesses. Completion, source retention, retrieval and answer quality are
separate acceptance gates; neither synthetic passes nor stars establish trust.

N1 measures bounded source-window retention. N2 repairs false attribution of
complete-map delivery and unvalidated model proposals. Its fifth-receipt
negative control proves one preview limitation, not the cause of consumed paid
cases with at most four receipts per card. The primary therefore declines to
expand receipt limits or add an index/vector engine without relevant evidence.
A read-only feasibility audit found that query-filtering an unindexed excerpt
could scan unbounded receipts even with a small SQL return limit; a larger
finite window would increase local work and move, not eliminate, the boundary.

Next order:

1. This offline packet makes the accepted one-source trace usable in the actual
   mixed evaluation runner, with an explicit, prospectively bound probe and
   unchanged model requests. It is observation, not a product correction.
2. Freeze a NEW small authored real-model packet and its source-only operator,
   references, runtime, limits and ledger checkpoint. Reuse existing guards;
   audit affordability within cumulative US$200 before dispatch. Preserve every
   outcome; never rerun or rescore consumed official cases. This packet itself
   authorizes no paid launch or access to credentials/operational artifacts.
3. From observed failures choose one bounded product intervention; prove its
   effect offline, then evaluate on separately frozen fresh cases. Return to
   official matched scoring only after mechanical completion is demonstrated.
4. Installed MCP/Hermes cold sessions, growth, correction/forgetting and
   cold-context onboarding remain independent product gates, not inferred
   from this evaluation route.

## Observable acceptance

- **P1 — One explicit source-only probe.** Add an optional immutable preparation
  input for indexed-evidence comparisons only: one null or one bounded
  `{batchIndex, windowIndex, routingCue}` probe per case, at most 30 cases.
  Resolve it against the actual prepared canonical source window; require the
  cue to occur in that window. No evaluator, expected answer or semantic label
  enters preparation/generation. Bind the enabled observation policy into the
  context digest and each probe into its case protocol digest before guard
  construction. Absent input preserves the prior preparation/protocol/output.
- **P2 — Finite source lookup.** Inspect only the designated fresh capture
  outcome's at most five admitted memory IDs through public `get`, at most
  100 receipts per ID and no pagination. Join the exact original client,
  session, event, role and canonical excerpt. Require exactly one matching
  current memory/receipt; duplicates across memories, incomplete reads,
  mutation, failures and unsupported shapes remain unavailable, never a
  fabricated zero or semantic loss. Reuse its valid before-read for the N2
  trace, with at most one further after-read: at most six added public reads
  per case. Do not scan namespaces or inspect old stores.
- **P3 — Actual runner integration.** Use N2's existing trace at the real
  Cairn select/rank, final recall and `packMixedAnswer` boundaries in
  `runMixedGeneration`. Add only a source-free optional diagnostic; keep
  aggregate/scorer eligibility and official result meanings unchanged. Close
  the trace on every success/failure path and preserve its unavailable state.
  No standalone unused observer, retrospective reconstruction or helper that
  passes by replacing the real core/adapter/packer.
- **P4 — Transparent model forwarding.** Forward original receiver, arguments,
  results/errors and cancellation exactly; preserve the underlying method
  call counts/order and serialized provider payloads. Observation cannot
  alter prompt, limits, timeout, retry, qualification, source policy, storage,
  native arm or scorer. Capture the trace at call entry so a late response
  cannot attach to another recall; no global current-case state. Existing
  complete-map bypass remains valid. Bounded getter/proxy/late/overflow
  observations fail unavailable without running extra user traps or changing
  the operation. No source text, IDs, queries, paths, hashes or raw errors in
  the trace report; flattened text cannot prove source identity.
- **P5 — Differential and failure tests.** Through real public core plus the
  existing guarded fake-HTTP path, compare observation disabled/enabled for
  the same fresh synthetic history. Prove unchanged model requests/results,
  recall and packing, answer/scoring eligibility and accounting. Cover retained
  source delivered, visible-but-unselected, fetched-but-unranked, unretained,
  ambiguous/incomplete/foreign/stale binding, model errors, late responses,
  all observation bounds, and source/evaluator separation. Test invalid probe
  and changed probe protocol before dispatch, including unavailable failed
  capture. Preserve the N2 fifth-receipt negative; do not call it repaired.
- **P6 — Verification and delivery.** Owned scratch/runner, no historical
  cleanup. Both Node 22.16/24.15: focused checks, long-history and LongMemEval,
  ingestion/comparison/public demos, generic/JSON, workspace lifecycle and strict
  plugin checks;
  real-core/native fake-HTTP gate for the changed mixed runner. Primary inspects
  actual final diff and reruns critical paths; separate non-author Standards
  and Spec reviews of the same committed diff, then latest-head CI and
  mergeability. No merge, release, deployment or API call in this packet.

## Delegation and checkpoints

One bounded GPT-6 Sol/high worker owns implementation. Primary owns architecture,
shared-document integration, acceptance and delivery. Before editing runtime
or changing existing evaluation behavior, worker returns the exact API/fields,
caller trace, hash-binding and forwarding design for approval. Initial scope is
this plan and focused offline tests; the approved implementation scope will be
`evaluation/longmemeval/mixed-generation.mjs`, one small neighboring integration
helper and focused tests, reusing N2 without copying its state machine. Package,
CI, core, adapter, guard, model profiles and persistent schema are excluded.
Avoid a new general callback/plugin API. Missing native test prerequisites are
a gate to resolve, not an automatic skipped pass.

N2 source code at the fixed base passed both independent reviews; latest-head
CI remains in progress at this contract checkpoint. Implementation may begin
only after the primary confirms that delivery gate. Fresh fixtures/operator
and paid preflight are subsequent bounded packets, not silently included here.

## Approved implementation checkpoint

The primary verified N2 PR #283 at the fixed base: both independent axes PASS,
all 17 reported dependent-base CI checks SUCCESS (run `36480850549`), ready and
mergeable. No CodeQL check was reported for that dependent head; no CodeQL pass
or 21-check result is inferred. Retargeting requires a fresh check audit.
The primary also ran the unchanged native fake-HTTP mixed gate in this new
worktree: Node 24.15, 26/26 without skips, 89,662.124 ms. This is baseline
prerequisite evidence, not acceptance of the following changes.

Approved optional input name: `sourceProbes`. Absent and a correctly sized
null-only array both disable observation and preserve previous output/protocol
shapes; a null option is invalid. Enabled probes enter only their case protocol
binding plus the observation-version context binding; no raw cue/probe appears
in the public preparation projection or source-free trace. Current public reads,
not old admission revisions, establish the before state after later capture or
filing. Zero matches means not observed in that batch's inspected members, not
proof of global absence. Every inspected member must pass identity/completeness
validation, even when it is not the matching member.

The worker may make a small compatible split-stage extension in
`evaluation/long-history/recall-observation.mjs` and its focused tests:
`beginSelect(request)` / `beginRank(request)` return one-use output sinks.
They project bounded request metadata at method entry and output at settlement,
retain no complete frame and share the existing state machine and caps.
Existing `recordSelect` / `recordRank` behavior and the N2 gate stay compatible.
Closed, failed, incomplete or duplicate settlements cannot establish acceptance.
This avoids a second state machine or retaining mutable raw request frames.
The model forwarding wrapper captures the per-call trace at entry, never looks
up a later trace, and does not observe source text through arbitrary callbacks.
Use only a narrow trusted-adapter integration, not a general plugin API.

P5 byte parity applies to identical real-core requests through the actual
guarded adapter, including method/path/body bytes. Full mixed-run enabled/
disabled tests additionally prove call order, accounting and result/scorer
eligibility, but independently generated memory IDs legitimately differ; do
not normalize those differences away and claim byte identity. The existing
synthetic mixed-fixture helper may forward the optional input, and the explicit
native test may add focused cases. No generic test-discovery or CI change.

Implementation GO is bounded by these choices. Worker records changed callers,
tests, actual results and limitations before candidate freeze. Primary owns
shared protocol/limitations/roadmap integration and final acceptance. No fresh
real-model cases have been run and no benchmark score has changed.

## Worker implementation checkpoint (pre-freeze)

The worker added the optional privately frozen `sourceProbes` preparation input,
versioned context/case digest binding, one designated-batch public lookup, and
source-free N2 tracing around the existing Cairn recall and answer pack. The
runner's Cairn adapter facade forwards the original receiver, arguments,
promise/result/error and signal; it captures the per-call trace at entry and
does not change the native arm, scorer, model request or default preparation.
The N2 observer gained compatible one-use split-stage sinks, retaining the old
gate methods. No core, adapter, guard, schema, package or CI file changed.

The first timing test was RED on the existing `recordSelect` seam: Node 22.16,
one test failed in 1,987.101 ms because a request label mutated after method
entry was reported as `routingTextVisible=no` rather than its entry value `yes`.
It was an observation-timing failure, not a product retrieval miss or an
absent-helper-only test. With the split-stage sink the same test passed; the
rank-entry mutation, pending/duplicate settlement and closed-late controls also
pass. The inherited fifth-receipt loss remains a negative control.

Focused tests on Node 22.16/24.15: N2 retained-trace suite 14/14 each
(24,540.359/24,474.885 ms); N3 preparation/protocol test 1/1 each; N3
public-capture/current-core recall/answer-pack and active guarded-adapter
identical-request byte-parity tests 2/2 each. The latter compares literal
method/path/body bytes and accounting for one actual core rank request through
the same adapter with and without observation. The full native fake-HTTP runner
targeted positive differential passed 1/1 on each Node
(15,622.906/15,487.696 ms), covering call order, accounting, scorer
eligibility, source delivery, completed zero-memory capture and failed capture.
The targeted visible-unselected, fetched-but-unranked and invalid-model-output
runner controls passed 1/1 on each Node (13,525.994/13,517.443 ms). These
are synthetic offline controls, not real-model quality or historical-case
results. Independent full gates, primary reruns, review and CI remain pending.

The lookup validates every designated batch member but cannot certify that an
uninspected store or another namespace lacks the source. A complete zero-match
batch is reported `not_observed_in_batch`/unavailable, not global absence.
Current public `get` establishes revision after capture; one after-read fences
the matching source. Independent captures have random memory IDs, so full-run
provider payloads are not claimed byte-identical. No paid request or old
official case was run.

## Primary acceptance checkpoint

The primary inspected the actual runtime, caller and test diff. Corrections
before acceptance made the byte-parity test activate the trace (rather than
merely construct its facade), checked scalar probe fields before generic JSON
copying, and exercised the new lookup's five-member/100-receipt bounds. Exactly
five complete members use five reads; six members use none. Incomplete pages,
101 receipts and duplicate receipt IDs remain unavailable without pagination.
These cloned-read boundary controls do not establish product retention quality.

Primary-owned full gates, Node 22.16.0 / 24.15.0 respectively, all exit 0:

| Command | Result | TAP duration (ms) |
| --- | --- | --- |
| `npm run test:long-history` | 19/19 each, no skips | 39,597.880 / 38,456.934 |
| `npm run test:longmemeval` after the final test-only correction | 196/196 each, no skips | 9,862.114 / 8,949.940 |
| `npm run test:mixed-native-local` | 28/28 each, no skips | 144,326.264 / 143,510.603 |
| `npm test` | 143/143 each, no skips | 4,534.081 / 4,092.509 |
| `npm run test:workspace-lifecycle` | 25/25 each, no skips | 15,893.930 / 16,140.144 |
| `npm run validate` | valid JSON; consistent 0.1.1 | n/a |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin pass | n/a |

The primary also ran `npm run demo:longmemeval-ingestion`,
`npm run demo:longmemeval-comparison`, `npm run demo:longmemeval-public` and
`npm run demo:longmemeval-mixed` on both runtimes. All passed with scripted
models. Demos keep their documented retained-artifact behavior; ordinary
tests use owned invocation scratch. `NODE_DISABLE_COMPILE_CACHE=1` was set,
with each runtime's directory first in `PATH`. The native gate used the
existing pinned local interpreter/venv through the documented environment
variables, fake HTTP and synthetic ledgers, without operational credentials.
Strict plugin validation reused the identical locked 2.1.260 maintainer tool
from the parent worktree through `PATH`; no package/lock file changed.

The final correction touched only the locator test. The primary reran the full
LongMemEval suite afterward and checked implementation/test blob identity at
candidate freeze. Generic, lifecycle, demos and native execution dependencies
are unchanged by that correction. There is no TypeScript/typecheck gate in
this JavaScript repository. Separate non-author Standards/Spec review and
latest-head CI/mergeability are still required before delivery; their exact
candidate and results belong in the PR record.

| Responsibility | Actual assignment | Evidence and intervention |
| --- | --- | --- |
| Bounded implementation | GPT-6 Sol, high | P1–P5 focused dual-runtime tests above; request-timing RED then GREEN; no escalation to a larger model |
| Planning, shared documents, acceptance | Primary agent | Inspected complete diff, tightened non-vacuous test preconditions and finite lookup controls, personally ran full dual-runtime gates |
| Independent review | Separate non-author agents, pending | Same fixed base and final committed candidate required |

Agent token/spend telemetry is unavailable. No paid model request was made in
this packet; old scores and failures remain unchanged. The next packet is
fresh authored fixtures plus operator/preflight, not a retry of consumed cases.
