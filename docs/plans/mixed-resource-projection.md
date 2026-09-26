# Mixed comparison resource projection — R contract

Planning-only contract, before corpus/holdout preparation. This packet is a
pure arithmetic projection, not an operational grant, ledger reader, launcher,
source tokenizer, scorer or guarantee of completion. No paid calls are allowed.
It complements P's source rendering and Y's pinned native execution. DRI owns
the contract; one G6 Sol/high worker implements; independent Standards and Spec
review the final fixed diff and primary reruns both runtime gates.

## Scope and integration

Use a dedicated dependent worktree based on accepted X
`f85322724eb91e4900d49cf1a400e8ce2f98ea4a`, not another worker's dirty tree.
Allowed files: `evaluation/longmemeval/mixed-resource.mjs`, corresponding
`test/mixed-resource.test.mjs`, `docs/plans/mixed-resource-projection.md`, and
narrow additions to `docs/longmemeval-comparison.md` and `docs/limitations.md`.
Do not change core, adapters, ledger/guard, package dependencies, prices, old
scores or native execution. The caller supplies snapshots of existing
experimentPolicy(), benchmarkStagePolicy(), mem0WireProfile(); production
wiring is a later runner gate. Tests compare against those actual profiles.

## Observable acceptance

- R1 Export `projectMixedResources(options)` and a fixed-code error class.
  Exact options are `batchCounts`, `policy`, `stages`, `wireProfile`,
  `remainingMicroUsd`, `protectedMicroUsd`, `nativeProfile`.
  `nativeProfile` is exactly `mem0-2.2.0-infer-add-no-nlp-v1`.
  It labels a CONDITIONAL source-audited bound, not proof an artifact has that
  profile. Graph, reranking, vision, custom prompts and optional entity work
  must be absent in the later verified configuration for this bound to apply.
- R2 batchCounts is a dense own-data array of 1..250 nonnegative safe integers,
  each <=2500; zero represents no admitted source batches, not a dropped case.
  Reject holes, extra keys, getters without invocation, symbols, unsupported
  prototypes, cycles and negative zero. Profiles are bounded own-data snapshots
  (depth16, nodes10000, total UTF8 strings1MiB); check width before per-property
  descriptor traversal; no total-process-memory or adversarial Proxy guarantee.
  Both money inputs are nonnegative safe integer microUSD, protected<=remaining.
- R3 Validate supplied profiles against the existing accepted profile exports,
  by complete canonical equality. No duplicated mutable price table. Imports
  may load these modules but must not create a store, touch an operational
  ledger, fetch, read a key/environment, create a process or write a file.
  Unsupported or altered rates, models, caps and versions fail explicitly.
- R4 Calculate with checked BigInt intermediates; return JSON-safe safe integers
  only, explicit overflow refusal. Never use floating-point USD arithmetic.
  Let B=sum(batchCounts), N=batchCounts.length; no IDs or source texts needed.
  Cairn extraction/conditional qualification/conditional classification each
  have count+generation, hence ingestion ceiling 6B physical requests, comprising
  3B count and 3B generation. Recall contributes at most 3N count and 3N
  generation (two selection rounds plus ranking). This is a CONDITIONAL upper
  bound, not a minimum or promise those paths execute; early failure may cost0.
- R5 Native per-batch upper work: one add-query singleton embedding; one chat;
  ceil(maxFacts/maxItems) fact-batch embeddings, EACH conservatively priced at
  the accepted maximum total embedding tokens; plus maxFacts fresh singleton
  embeddings, including already successful batches when a later chunk fails.
  Search adds one singleton embedding per case. Singleton reservation is
  max(minimumReservedMicroUsd, ceil(maxItemInputTokens*inputPrice)).
  Batch reservation likewise uses maxInputTokens. No dedup discounts. Use W's
  pre-native maxFacts, NOT Y's returned-record bound. Native default retries
  are not added; actual Y clients have retries0. The native fallback is paid
  new physical work and is counted in full.
- R6 Both arms' answer and judge ceilings are 2N each at accepted per-request
  reservations. Return per-stage request/reservation ceilings, per-arm totals,
  generation/scoring totals and joint total, with sum consistency. Returned
  explanatory fields distinguish deterministic plannedCaseCount/batchCount
  from conditionalCeilings; actualMinimumMicroUsd=0; empiricalEstimate=null.
  Do not expose `willFinish`, accuracy, completion probability or launchReady.
- R7 Also return remaining/protected/availableForComparison microUSD,
  `upperBoundFits` (conditional total<=available), and headroom or shortfall
  as distinct nonnegative integers. An upper bound that does not fit is NOT
  proof the experiment cannot fit; one that fits only covers money under the
  named assumptions, not runtime, source limits or semantic success. Do not
  allocate grants, request caps or silently reduce N/batches.
- R8 Synthetic tests: N1 B0; N1 B1 known arithmetic from actual profiles;
  mixed counts including0; maximum250x2500; exact-fit/one-micro-short;
  separate protected funds; global sums; unsupported models/prices/profile;
  malformed/getter/extra/sparse/overflow inputs. No downloaded corpus or
  historical experiment helper/import/execution. No fresh empirical estimate
  inferred from prior incompatible pilot data.
- R9 Both Node22.16 and24: focused tests, test:longmemeval, all three LME demos,
  npm test, npm run validate, pinned strict plugin/marketplace validation.
  Coordinate heavy full matrices with primary. Freeze a scoped commit only
  after gates; no push until primary acceptance plus both independent reviews.

## Interpretation required in docs

This is resource planning for a controlled comparison, not a new quality score.
The last dated campaign audit is not read by this module. Earmarked funds and
phase caps do not prove feasibility. The full common protocol, actual artifact
and source-only checks remain necessary before touching the untouched roster.
The maximum conservative native reservation intentionally overcounts token
maxima that cannot all occur together; it is not an expected invoice.

## Implementation record (appended after the unchanged R contract)

Actual implementation dispatch: G6 Sol/high in the isolated
`feat/mixed-resource-projection` worktree, based on
`f85322724eb91e4900d49cf1a400e8ce2f98ea4a`. The original R1–R9 contract
above was copied verbatim before source changes. This branch is not a paid-run
authorization and is not a replacement for the separate P/Y integration gates.

### Entrypoints and source mapping

`projectMixedResources(options)` is the only new production entrypoint. Its
callers must supply dense batch counts and snapshots from `experimentPolicy()`
in `evaluation/live/session.mjs`, `benchmarkStagePolicy()` in
`evaluation/live/public-pilot.mjs`, and `mem0WireProfile()` in
`evaluation/experiment-budget/mem0-wire.mjs`. The module imports these three
exports for *complete canonical equality* and reads no operational state.
None of their live session, public pilot, wire-request inspector, guard,
ledger, transport or runner constructors is called. No entrypoint in those
modules or in core, adapters, package scripts or historical scoring is changed.
The only other changed consumers are the focused synthetic test and narrow
comparison/limitations documentation. The future mixed runner must verify the
real artifact and native configuration before using this projection; this
module has no production callsite yet.

Profile fields and physical work map as follows:

| Source field/path | Projection use | Conditional physical work |
| --- | --- | --- |
| `policy.cairnCount.reservedMicroUsd`, `policy.cairnGeneration.reservedMicroUsd` | Cairn reservation | Extraction, qualification and classification: one count plus one generation each per admitted batch; two selection rounds plus ranking: one count plus one generation each per case. |
| `stages.answer.reservedMicroUsd`, `stages.judge.reservedMicroUsd` | Both arms' answer/judge reservation | One answer and one judge for each arm and each fixed case. |
| `wireProfile.chat.reservedMicroUsd`, `chat.maxFacts` | Native add chat and fallback width | One add chat and up to 256 fresh fallback singleton embeddings per batch, including embeddings from previously successful fact chunks. |
| `wireProfile.embedding.maxItemInputTokens`, `maxInputTokens`, `maxItems`, `minimumReservedMicroUsd`, `inputPrice` | Integer-ceiling singleton and batch reservations | One add-query singleton, `ceil(maxFacts/maxItems)` max-token fact batches, and all fallback singletons per batch; one search singleton per case. |

The accepted profiles currently yield 5,000 µUSD for each Cairn count or
generation call, 50,820 for each answer, 10,400 for each judge, 16,308 for a
native chat, 164 for a maximum-item singleton embedding, and 6,000 for a
maximum-total-token batch embedding. These figures are *read from the supplied
profile only after full equality to the accepted exports*; there is no second
price table. The 256-fact limit is W's pre-native bound, not a later returned
record bound. This calculation assumes the named no-NLP, no-graph/reranking/
vision/custom-prompt/entity-work native configuration and default zero retries
verified later by the runner; the label does not prove it.

Output shape is `version`, `nativeProfile`, deterministic
`plannedCaseCount`/`plannedBatchCount`, `conditionalCeilings`,
`actualMinimumMicroUsd: 0`, `empiricalEstimate: null`, and `budget`.
`conditionalCeilings.arms.{cairn,mem0}.stages` contains named physical stages
as `{requests,reservedMicroUsd}`; each arm has a sum `total`. `generation`
sums every non-judge physical stage in both arms (including ingestion, recall,
native and answering); `scoring` sums both judges; `joint` sums the two arm
totals and equals generation plus scoring. `budget` preserves remaining and protected
money, shows available money, and reports `upperBoundFits` with separate
nonnegative headroom/shortfall. There is no completion or quality prediction.
The input snapshot rejects accessors before invocation; width is checked
before per-key descriptor traversal. `Reflect.ownKeys` and ordinary JS
allocation still occur, and hostile Proxy traps are outside the guarantee.

### Verification ledger

The focused Node 22.16 and 24.15 synthetic tests passed 10/10 each before
full matrix gates. An independent arithmetic check found that an earlier
`generation` subtotal included only answer calls, not ingestion/recall/native
work. A new N=1,B=1 test failed RED (actual 2 / 101,640 versus required
276 / 238,260), then passed after summing all non-judge physical stages.
The fact-batch count also uses integer-ceiling BigInt arithmetic.
Known arithmetic: N=1,B=0 gives 11 physical requests and 152,604 µUSD;
N=1,B=1 gives 278 physical requests and 259,060 µUSD (276 / 238,260
generation and 2 / 20,800 scoring). The latter includes
three 6,000-µUSD fact batches and 256 singleton fallback calls. Tests also
cover mixed zero/nonzero batches, maximum N/B, budget fit/shortfall/protected
money, complete profile mismatch, no-getter malformed input, snapshot depth/
UTF-8 byte bounds and width-before-descriptor rejection.

Final R9 matrix on the scoped tree, serial with the native worker's heavy
tests:

| Gate | Node 22.16 | Node 24.15 |
| --- | --- | --- |
| Focused mixed-resource tests | 10 pass, 0 fail | 10 pass, 0 fail |
| `npm run test:longmemeval` | 138 pass, 0 fail | 138 pass, 0 fail |
| Three synthetic LongMemEval demos | all pass | all pass |
| `npm test` | 112 pass, 0 fail | 112 pass, 0 fail |
| `npm run validate` | pass | pass |
| Pinned marketplace and strict plugin validation | pass after tooling reinstall | pass |

The first Node 22 plugin-validation attempt failed because isolated tooling
was installed with `--ignore-scripts`, leaving the pinned Claude native binary
uninstalled. Reinstalling that existing pinned tooling with its normal
postinstall fixed the environment; the unchanged marketplace and strict-plugin
command then passed. The failed attempt is retained in the private verification
archive alongside all passing gate logs. `scripts/README.md` is absent in this
tree; the inspected JSON validation entrypoint is `scripts/validate-json.mjs`.
The local candidate commit ID and private log directory are in the handoff;
no branch push or paid operation occurred here.
