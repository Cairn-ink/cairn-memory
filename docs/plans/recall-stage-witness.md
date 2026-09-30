# M1g offline recall stage witness

Status: final offline gates passed; ready for primary freeze and independent
fixed-head review. Evaluation-only,
unwired to paid generation; no core/adapter/prompt/scorer or product API change.
Worktree `recall-stage-witness`, branch `test/recall-stage-witness`, fixed base
`f623bcb3381d3712822bf92e729df626b244f6a9` (PR #303).
Primary owns architecture, acceptance and delivery. Implementation is assigned
to GPT-6.1 Sol/high by primary runtime dispatch; no independent model attestation,
elapsed cost measurement, commit or push is supplied by this worker.

## Contract frozen before code

- W01: a frozen trusted-model facade observes only select/rank. It forwards the
  original request, output, signal, thrown/rejected error and method receiver,
  preserves native Promise identity where possible, and adds no tokenizer,
  provider call, awaited observer work or external observer callback. Other
  functions delegate to the original receiver; context and metadata retain
  their original values. Model-object identity necessarily changes. Actual
  frozen OpenAI adapter compatibility is tested, not universal transparency for
  hostile thenables, accessors, proxies or timing-sensitive arbitrary models.
- W02: emitted private witnesses contain only opaque per-recall ref/receipt
  tokens, finite stage/status fields, bounded counts and packed flags. Raw IDs
  may exist only in a bounded ephemeral lookup table, available for joins after
  collection closes and cleared by disposal. No query, source, label, namespace
  text, raw request/output/error, evaluator field or durable log is retained.
  Public summaries contain aggregates, never opaque tokens or raw IDs.
  Projection/overflow makes observation partial/unknown, never evidence absent.
- W03: adapter-returned refs are never called core-accepted. A supplied successful
  whole-core result marks only chain completion; failed recall leaves reference
  acceptance unknown. Rank requests demonstrate flow progressed, not a new
  validator. Complete-map bypass and skipped packed pages remain unobservable.
  Rank-input absence cannot independently distinguish fetch from packing loss.
- W04: new public-core/fake-HTTP paired tests use identical source/protocol with
  fresh owned stores. Compare requests, model/count/provider calls, original
  receiver/request/output/signal/error identities and final evidence. Normalize
  generated IDs/times only at test comparison boundaries. Negative controls:
  dropped visibility, empty select, rank packing omission, empty rank, invalid
  refs, rank-time correction, projection failure, overflow, late completion and
  complete-map bypass. No reused paid stories, semantic or historical-cause claim.
- W05: createTestWorkspace owns all test scratch and registers teardown
  immediately; run every test via tools/testing/run.mjs. No operational ledgers,
  credentials, old artifacts, official corpus or historical scratch cleanup.
- W06: new test lives at evaluation/longmemeval/test/recall-witness.test.mjs and
  is discovered by the existing test:longmemeval CI glob, with no package/CI edit.
  Verify focused, generic, existing LongMemEval, JSON, relevant small core/adapter
  fake routes and pinned Claude 2.1.260 on Node 22.16.0 and 24.15.0. Full OpenAI,
  native and paid gates are not required by this evaluation-only scope; unrun
  checks are explicitly unrun.
- W07: document mechanical boundaries, absence of paid wiring and unresolved
  historical cause, with actual failures and correction rounds preserved.

## Interface and concrete bounds

New module: evaluation/long-history/recall-witness.mjs.
createRecallWitness(model, limits) returns a frozen handle with model (facade),
finish(actualCoreRecallResult), close(), snapshot(), summary(),
lookupRefAfterClose(ref), lookupReceiptAfterClose(receiptId, ref), and dispose().
Snapshot is private opaque evaluation data; summary is the source-free aggregate.
Finish reads only bounded reference/receipt metadata and finite outcome/strategy
flags, closes observation, and does not authenticate a caller-supplied result.
Joins happen after generation using existing trusted verification results; lookup
is not storage/provenance authority. No observer result enters a model request.

Default caps: 4 retained invocations, 128 ref slots per invocation, 256 receipt
slots per invocation, 1024 combined raw-ID lookup entries; at most 8 packed page
flags and 36 rank candidates per invocation. Configurable caps may only decrease
these maxima and must be positive safe integers. Raw IDs are at most 200 UTF-16
units, matching public identifiers. Finish inspects at most 12 final memories,
matching the public core recall limit. Duplicate slots still consume witness slots.
Counts are bounded by the input protocol and recorded capacities; saturation or
over-cap shapes mark partial/unknown. A closed collector ignores late completion.
Dispose releases private mappings/witnesses and leaves only bounded aggregates,
including the pre-disposal observation enum so clearing events cannot promote
partial/unknown observation to complete.

## Existing seams and entrypoint trace

Reuse evaluation/long-history/gate.mjs's private select/rank frame comparison
pattern, not its full 1025-memory runner or historical fixture data. The new
module projects metadata instead of retaining raw frames. No exports from core.
Actual public capture -> indexed-evidence admission -> real adapter classify ->
core.recall -> packed select input -> adapter-normalized refs -> core output/
freshness/selection checks -> fetch -> packed rank input -> adapter refs -> core
validation -> final authoritative read -> trusted runner finish. Existing
packMixedAnswer can supply final packing comparison in the tests without an
answer provider call. mixed-generation remains unchanged and unwired.

Existing model observers emit source-free failure/timing enums, not success ref
membership; the facade does not extend those schemas. A facade cannot see internal
pages skipped without select, complete-map automatic selection, or directly
observe validation of each returned ref. The tested claim is boundary observation,
never universal full-stage coverage or a new reference authority. Reference
visibility does not prove the relevant source passage was present in a preview.
A rank receipt token proves membership, not a full excerpt or semantic
completeness. Source-mode navigation uses queryCandidateRows/scored snapshots,
not a substitute generic mapRows read. Receipt tokens include their full private
reference association; namespace/revision differences cannot merge witnesses.

## Verification record

Focused fixtures have eight top-level tests, covering successful parity and
foreign-scope isolation, eligible same-namespace packing visibility, empty select,
rank packing omission, empty rank, duplicate refs, rank-time correction,
projection failure, overflow, bypass, late completion, namespace/revision and
receipt association, exact cap, ambiguous final join and errors. Same-namespace
visibility uses a clearly labeled scripted counter override, with the real
adapter and core packSelect path; it is not tokenizer-realism evidence. Rank
packing uses the real tokenizer and four independently fetchable source sets.
Paired connections share a fresh owned store per pair, except correction pairs
which use independently owned stores. Both connections defer cleanup to the
store's workspace; normalized original HTTP body strings (not reparsed JSON)
are compared in order.

Primary draft acceptance corrections (before execution): array length's
non-enumerable descriptor, fixed output-loop take, ambiguous final namespace
join, plain-close completion, detached onDiagnostic identity, same-namespace
visibility, original HTTP bytes and resource-owner teardown. These are not
reported as test failures.

Actual execution/rework record (owned runner, Node 22.16.0):

- Initial focused run: 7/8, 3862.853539 ms. Rank omission assertion red because
  three submitted 650-character repeated-source cards did not exceed budget.
- First size-only correction (1100 characters): still 7/8, 4273.533646 ms.
  Focused measurement remained red (1 failed, 1516.368946 ms): retained windows
  are 800 units, independent exhausted fetches count 1707–1710 tokens each,
  combined rank envelope 5478 (<6000). Submission length is not retained size.
- Measured four-candidate correction: 8/8, 3395.793844 ms. Each retained source
  window is 800 units, independent exhausted fetches 1702–1706 tokens, combined
  rank envelope 7133, packed envelope 5462. Four candidates are now frozen;
  assertions require >6000 combined input, individually <=4000 fetches, fewer
  rank refs and no shortening. No witness runtime change was needed.
- A diagnostic command incorrectly supplied the Node ELF binary as the owned
  runner's JavaScript --script target; it exited 1 with SyntaxError before
  executing code. Measurements were then made inside the existing test fixture.
- Final primary edge inspection requested failed finish with a pending native
  Promise. Added a controlled timeout-shaped caller failure (not an actual paid
  timeout), asserting failed outcome, partial observation, null returned count
  and ignored late completion. The first summary predicate ordering made the
  existing plain-close check red: 7/8, 3800.624071 ms, partial rather than unknown.
  Corrected ordering preserves unknown plain close while failed pending calls
  remain partial. Those focused reruns passed both Nodes; no extra top-level
  test or change to model/error behavior.
- Final disposal inspection found clearing pending events promoted a failed
  pending call from partial to complete. The controlled pre-fix assertion was
  red: 1 failed, 204.889912 ms. The runtime correction retains only the bounded
  pre-disposal observation enum; existing tests now require partial, unknown
  and complete observations to survive disposal. The prior worker's focused
  final-code reruns passed 8/8 (22: 3829.610500 ms; 24: 3889.771989 ms).
  Its subsequent LongMemEval verification was interrupted by daemon restart;
  completion and duration are unknown. The resumed worker changed docs only
  and reran every W06 gate below on the same final module/test hashes.

Required local gates
use exact Node paths /home/chichieh/.nvm/versions/node/v22.16.0/bin and
/home/chichieh/.nvm/versions/node/v24.15.0/bin. Only the worktree's locked OpenAI
dependencies may be installed. The existing pinned maintainer CLI is reused
read-only from installed-classification-followup. No commit/push by worker.

Historical worker offline gates before the disposal correction (all exit 0;
superseded for the final code by the reruns below):

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| New focused witness, final pending-failure control | 8/8, 3696.889411 ms | 8/8, 3741.893084 ms |
| Generic npm test | 131/131, 4629.592916 ms | 131/131, 4856.621558 ms |
| LongMemEval glob | 207/207, 11647.260298 ms | 207/207, 10282.157450 ms |
| Small existing core guards/diagnostics | 4/4, 1247.774615 ms | 4/4, 997.985335 ms |
| Existing adapter fake-HTTP lifecycle | 3/3, 879.632793 ms | 3/3, 785.264745 ms |
| JSON validate / synthetic ingestion demo | exit 0 / exit 0 | exit 0 / exit 0 |
| Claude 2.1.260 marketplace / strict plugin | exit 0 / exit 0 | exit 0 / exit 0 |

Final resumed-worker offline gates on the disposal-corrected code (all exit 0;
durations are concurrent test-run totals, not performance/resource claims).
Both binary versions were checked directly. Exact tested SHA256:
module `10e5b88d34f7ae6e56ad7d2db26512eb150f04735597d51986640e034d527a3a`;
test `e8f4ba087cea4014046eae9713b13a1b5ea1ba76092d4abbed8089393fa44889`.
The resumed bounded assignment was GPT-6.1 Sol/high by primary runtime dispatch;
no token/cost measurement or independent model attestation is supplied.

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| New focused witness, including disposal controls | 8/8, 5824.272457 ms | 8/8, 5720.451712 ms |
| Generic npm test | 131/131, 4731.580258 ms | 131/131, 4759.701390 ms |
| LongMemEval glob | 207/207, 12055.347596 ms | 207/207, 11757.558685 ms |
| Small existing core guards/diagnostics | 4/4, 2703.310871 ms | 4/4, 2842.532460 ms |
| Existing adapter fake-HTTP lifecycle | 3/3, 2606.299454 ms | 3/3, 2752.201177 ms |
| JSON validate / synthetic ingestion demo | exit 0 / exit 0 | exit 0 / exit 0 |
| Claude 2.1.260 version / marketplace / strict plugin | exit 0 / exit 0 / exit 0 | exit 0 / exit 0 / exit 0 |

Exact commands below run from this worktree, each prefixed by
`PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:$PATH` or the corresponding
`v24.15.0/bin` path. Locked dependency setup used Node 22 and
`npm ci --prefix adapters/openai --ignore-scripts --no-audit --no-fund` (one
locked package, exit 0). No credentials or paid transport were used.

```sh
node tools/testing/run.mjs evaluation/longmemeval/test/recall-witness.test.mjs
npm test
npm run test:longmemeval
node tools/testing/run.mjs --script scripts/validate-json.mjs
node tools/testing/run.mjs --script evaluation/longmemeval/demo.mjs
node tools/testing/run.mjs --test-name-pattern='selector and ranker cannot invent|final authoritative read catches|throwing and rejecting observers preserve|successful capture and recall emit' core/test/recall.test.mjs core/test/model-diagnostics.test.mjs
node tools/testing/run.mjs adapters/openai/test/lifecycle.test.mjs
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs --version
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs plugin validate .
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs plugin validate plugins/cairn-memory --strict
```

The synthetic demo prints a temporary retained-store path; the enclosing owned
runner removes its fresh invocation workspace after the child exits. Existing
tests use only newly created synthetic stores; no historical scratch cleanup.
The LM count is 199 existing plus eight new witness tests, discovered without
package or CI edits. Full OpenAI/native/paid, historical replay/rescoring and
the large legacy long-history harness are unrun, not passed. Paid wiring,
parser/scorer contracts and evaluator-blind generation remain unchanged.

Historical primary acceptance checkpoint before the disposal correction:
personally reran focused suite on both exact
Nodes, 8/8 each (22: 5608.481037 ms; 24: 4801.350178 ms, concurrent verification,
not performance evidence). Primary verified original HTTP-byte comparison,
shared-owner teardown, independently fetchable candidates <=1711 tokens,
combined rank 7138 versus packed 5465/5468. Primary acceptance is scoped
mechanical evidence, not an independent semantic-quality or paid-cause review.

Superseding primary final-code checkpoint after restart, on the same hashes:
Node 22.16.0 LongMemEval 207/207, 9842.702124 ms; generic 131/131,
3891.316913 ms; JSON validate exit 0. Node 24.15.0 LongMemEval 207/207,
9448.919353 ms; generic 131/131, 3447.352966 ms; JSON validate exit 0.
All eight witness tests were included in each LongMemEval run. These are direct
primary reruns. At this authoring checkpoint, fixed-head independent
Standards/Spec review and CI were pending until primary freeze and delivery;
final review and CI delivery status is recorded on the PR. The branch
intentionally stacks on PR #303's fixed base; no worker commit/push/merge.
