# Seed-gated small source-set preservation: offline candidate contract

Fixed base: `37d5ada2d3e7b8305c3452d39392846d7d1bf050`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/seed-gated-source-sets`.
Branch: `feat/seed-gated-source-sets`.
The previous 24-case experiment remains closed. This packet authorizes no paid
operation, new score, default promotion, merge, release or deployment.

## Decision and boundaries

The primary selects one small offline algorithm candidate after read-only
comparison of seed-gated preservation, lexical bundles and semantic plans.
Existing rank instructions already request complementary coverage. The existing
unconditional small-candidate wrapper bypasses rank and exposes irrelevant
no-answer evidence; it is not the selected policy. Preserve its behavior.
This proposal retains rank-visible prerequisites without asserting any semantic
link. It deliberately risks extra irrelevant/old evidence. It is not a solution
for pools above six, a fresh score, a graph architecture or a D19 generation fix.

- S1: Add separately named pure compiler `assembleSeedGatedSourceSet` and model
  wrapper `createSeedGatedSourceSetModel`. Reuse the existing source-linked
  module's checked input/output/request seam with the smallest private shared
  factory necessary. Existing exports/default behavior and caller wire bytes
  remain unchanged. No copy of the whole validator, provider/transport/core
  changes or new service/schema/configuration.
- S2: Delegate the original immutable rank request exactly once, unchanged.
  Validate original rank output before intervention. Empty refs stay empty.
  If the COMPLETE supplied rank-visible candidate pool occupies one namespace and has at most
  `min(limit, 6)` cards, emit exact raw seeds in original order, then omitted
  candidates in original input order. No seed displacement or invented IDs.
  For larger or mixed-namespace pools, use the existing bounded source-linked
  result unchanged. Never truncate to make a larger pool eligible. Upstream
  rank-input packing may already have omitted selected sources; this policy
  cannot see or recover them and makes no completeness claim about that stage.
- S3: Pure diagnostics identify strategy, applied/fallback reason, added refs
  and linked fallback evidence when applicable. Semantics/relevance remain
  unassessed; no certainty, same-entity or dependency claims. Pure compile is
  deterministic, frozen and does not mutate caller input/output.
- S4: Preserve original allowed-reference/revision, descriptor-safe JSON,
  bounded input, output, cancellation and counted-snapshot boundaries. Keep
  max36 candidates, limit<=12, hard preservation cap6, local6000 input tokens,
  output1024 tokens/40000 chars, maxOutputTokens1024 and contextWindow>=8192.
  Malformed model output remains an error, not a reason to fill the pool.
  No extra provider calls, wrapper public reads or credentials.
- S5: Write red-capable tests BEFORE implementation. Generic repeated-code
  three-card and natural-language default two-card fixtures omit a necessary
  target under the old linked policy but preserve it under the new policy
  without adding synthetic linking codes. Test exact order, roles/excerpts,
  origins and full ordinary core -> authoritative role evidence -> actual
  unchanged answer-packer path on a fresh cold synthetic store. Candidate
  selection depends only on model-visible input, never evaluator anchor IDs.
- S6: Negative controls: empty raw output, a nonempty false-positive seed,
  unrelated siblings, repeated-code collisions, scope conflicts, embedded
  instructions and dated-but-active older evidence. The candidate knowingly
  exposes siblings: tests must record exposure rather than label it relevance,
  temporal validity or semantic safety. All-source preservation is not an
  oracle result or claim that more context always helps.
- S7: Boundary controls: zero/one/exact6/seven candidates, limit below pool,
  mixed namespaces, malformed/duplicate/foreign/stale-revision raw refs,
  oversize receipts/input/output, accessor/mutation/cancellation, and whole-unit
  answer-packer overflow. Correct/forget an ADDED sibling during delegated
  rank and prove actual core freshness rejects. No skip-as-pass.
- S8: Run final focused legacy+new source-link tests and all generic contributor
  gates on Node22.16 and24.15, plus test:longmemeval/ingestion/comparison/public
  demos because the new integration tests depend on authoritative role packing.
  Use existing owned-workspace runner and immediate cleanup; no historical
  /tmp sweeps or operational ledgers. The primary also replays the sealed D10/
  D16 traces only through the pure compiler; old report bytes/judgments never
  change, and no replay earns new QA credit.
- S9: Allowed files only: `evaluation/architecture/source-linked-evidence-model.mjs`,
  NEW `evaluation/architecture/test/seed-gated-source-set.test.mjs`, NEW
  `docs/plans/seed-gated-source-preservation.md`, and narrow prospective pointers
  in `docs/plans/reliability-three-stage.md` / `docs/limitations.md`.
  If the exact seam cannot fit this scope, report before extending. No existing
  tests/rubrics/cases/judges/closed reports, README marketing, runner/scorer,
  launch/transport, production core/adapter, CI or dependency edits.
- S10: One bounded actual GPT-6.1 Sol/high worker implements; primary owns
  integration, actual diff inspection, independent acceptance, commit, two
  nonauthor fixed-SHA reviews, PR and current-head CI/mergeability. Worker
  records first red exits and final commands, independent file inventories,
  no invented timing/cost. No worker commit/push/paid operations.
- S11: Keep development QA/reliability gates unchanged and failed history intact.
  After offline acceptance, a separately reviewed prospective paired experiment
  is needed before claims or paid calls. Reject this direction if restoration
  needs larger packing limits, unrelated evidence increases unsupported/stale/
  severe answers, or preserved prerequisites do not improve QA. There is no
  deterministic irrelevant-sibling exclusion guarantee. Do not retune the
  six-card boundary or reuse held-out answers to make this candidate pass.

## Implementation and offline evidence

The two explicit exports live in the existing source-linked module. A private
factory shares its unchanged descriptor-safe request, reference/revision,
snapshot, token-count and cancellation validation. The old compiler is unchanged;
the old wrapper uses that compiler through the factory. Neither new entrypoint
is wired into a runner, launcher or public default. The wrapper delegates one
unchanged rank request and performs no public reads or additional provider call.

`seed-gated-small-source-set-v1` diagnostics report `applied`, `reason`,
`addedRefs`, `semanticCoverage: unassessed`, `relevance: unassessed` and
`linkedFallback`. Reason precedence is empty rank, mixed namespaces, pool above
six, pool above requested limit, then eligible small pool. Ineligible nonempty
pools return the existing linked output and its diagnostic evidence exactly;
empty seeds produce empty refs. Eligible seeds retain their raw order, followed
by omitted candidates in supplied order. Eligibility considers the COMPLETE
supplied rank-visible pool, not every selected/stored source: upstream packing
can already have omitted cards, and this policy cannot restore unseen sources.

### Red controls and focused acceptance

Before implementation, the new S5 tests ran the existing linked wrapper using
`CAIRN_SEED_GATED_LEGACY_ONLY=1`. On both Node 22.16.0 and 24.15.0 the owned
runner exited **1**, with two actual packed-target assertion failures: the
repeated-code fixture packed only 1/3 source cards and the natural-default
fixture only 1/2. Both closed their SQLite cores and removed owned scratch.
Initial harness setup errors (canonical IDs/namespace, distinct admission
content, rendered excerpts and counter probes) were corrected before these
target-omission controls; they are not counted as evidence of the policy defect.
The retained legacy-only mode remains red after implementation on both runtimes.

Final worker focused command on each supported runtime, under a sanitized
environment with no provider credentials:

```sh
node tools/testing/run.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs
```

Both actual exits were **0**, 30/30 tests (16 new, 14 unchanged legacy), with
zero skipped/cancelled tests. Both `npm run validate` invocations also exited
**0**. An intermediate new fallback test exited **1** because its test-case
array was constructed incorrectly; correcting that array preceded the final
30/30 runs and did not change implementation behavior.

The cold-store integration directly admits rendered synthetic source receipts;
it does not test model extraction or full capture. It exercises ordinary public
core selection/rank/recall, actual `core.get` provenance authority,
`verifiedRoleEvidence`, and the unchanged answer packer. Both policies delegate
byte-identical rank inputs. The new policy restores exact source roles/excerpts
and original coordinates without synthetic linking codes; receipt roles remain
untrusted JSON quoted in a user evidence message, never authenticated assistant
messages. Correcting or forgetting an added sibling during delegated rank is
rejected by actual core freshness checks in both policies.

Other controls cover exact seed/input order, freezing/nonmutation, zero/one/six/
seven/36-card pools, limit and namespace fallback, empty seeds, malformed/foreign/
duplicate/stale refs, oversized input/receipts/output, accessors, counter ceilings,
provider errors, delayed mutations and cancellation. The false-positive seed
deliberately exposes unrelated, scope-conflicting, instruction-bearing and dated
active siblings through actual role packing: exposure is not relevance or safety.
The whole-unit overflow control uses a labeled synthetic counter to force the
existing answer-packer ceiling; full metadata/excerpts are measured before a
whole added unit is omitted. Mechanical test counters are not provider token or
cost measurements, and no larger packing limit is used to make restoration pass.
Specifically, the generic packer permits input plus its 512-token output reserve
up to 123000 tokens. The paid algorithm-development transport separately rejects
`packed.inputTokens > 6000` before sending an answer, with a distinct 7024-token
provider-observed input ceiling. This overflow control tests the generic
whole-unit ceiling, not that transport's stricter 6000-token preflight guard.

### Primary counterfactual trace replay (not new QA)

Primary independently replayed all 24 sealed treatment rank inputs/raw outputs
through the pure compiler on both Nodes, at module SHA-256
`6a437457fb77905bd3a1b200c1b851043bf0d75e14bbcb941e494d17d550d98b`.
Existing linked outputs/diagnostics matched all recorded traces. Fresh copied
cold stores, authoritative role evidence and the real `countOpenAITokens` port
with unchanged packing restored D10/D16's visible missing bridges, with zero
packing omissions. Counterfactual pooled units rose 39→68 and answer-input
tokens 8006→10931; the largest per-case packed input was 681 tokens, below the
paid transport's 6000-token local limit on both runtimes. Using the original
normalization and origin-bound metric,
frozen diagnostic source-anchor presence rose 37→42/42. Some diagnostic anchors
are optional for requested-answer correctness; this is not a new answer score.
No new answers/network calls, source mutations, report changes or QA credit
occurred; owned replay scratch was removed. Both actual replay exits were **0**.
All 24 consumed replay cases had at most six rank-visible cards. This is a
favorable small-pool setting: restoration here cannot establish larger-pool or
long-history improvement, and the new policy adds no preservation beyond its
existing linked fallback for pools above six.

Replay JSON SHA-256 identities: Node22
`5bd93a032e5d36489e6259ded430fc3e329b48fa815afae019bdb080b88054b2`;
Node24 `49f08d3016cce94a4c93aaa2ab8c6ea41daa632e5e215c9ab21975b4ae719a65`.
The earlier helper's unnormalized substring count (40/42) is not comparable to
the original coverage metric. The first normalized helper exited **1** because
an `Array.filter` callback forwarded its index as an optional origins argument;
the corrected callback reruns exited **0**, not a hidden product failure.

Primary's deterministic property-probe records for the same module hash each
cover 2000 cases on Node22/24: 147 eligible, 290 empty and 1563 fallback. They
check exact ordering, bounded identities, empty abstention, linked fallback
equality and input immutability with zero network calls; semantic quality remains
unassessed. These are additional mechanical checks, not QA measurements.

### Prospective comparison suggestion, not execution or authorization

For primary review only, a three-arm design could compare ordinary retrieval A,
source-diverse plus linked ranking B, and source-diverse plus seed-gated ranking C
on the same captured states, model and rubric, with common recorded-role evidence
and unchanged limits. C–A would use the unchanged primary advancement gate;
C–B would report incremental ablation evidence, not substitute for that gate or
compare against historical 18/22 scores. This is not an accepted future protocol:
it needs a separately reviewed fresh freeze, larger-pool negative controls and
budget preflight before any dispatch. Primary owns the design decision; neither
this suggestion nor offline preservation grants paid authority or establishes
long-history/parity acceptance.

Final contributor/integration gates, independent same-SHA reviews and current-
head CI/mergeability are recorded separately in the delivery PR. Primary owns
the full generic/longmemeval suites, demos and plugin validations on both Nodes;
this division avoids duplicate expensive runs and does not waive S8. Offline
preservation is not semantic acceptance or paid-run authority. Any paired QA
experiment requires a separate reviewed freeze and unchanged gain/safety/resource
gates; D19's same-input generation omission is outside this intervention.
