# Source-diverse selection: bounded algorithm revision

Status: offline implementation contract fixed before delegation. Primary DRI
owns acceptance. Isolated branch `feat/source-diverse-selection`, fixed base
`b56429ca48f928690d8922c18ea01cbb10ba4cc0` (#381); fetched public main remains
`253f5ddb10f6fa8e9b182521313077e42946d5e9`. No merge, release or deployment.

## Why this revision

The short-term goal is improved requested-answer correctness, not additional
protection-only work. The first full-label comparison failed its original gate;
the second rank-only exact-code assembler changed only two of 48 recorded arm
slots and recovered a missing anchor in only one. Neither establishes a QA gain.
See [the unchanged first result](algorithm-dev24-results.md) and
[the second candidate](bounded-evidence-sets.md).

Ordinary D11 exposes six cards to selection, but all three selected cards repeat
the same billing-source excerpt. A complementary bridge is visible yet does not
reach ranking. Adding a post-rank link cannot recover a source absent there.
This packet therefore changes candidate selection, not ranking or answering.

Ranked, falsifiable hypotheses: (1) repeated source evidence occupies selection
capacity; exact source-set deduplication and bounded novelty expansion will expose
the omitted bridge; (2) original label wording is the dominant issue, in which case
unchanged original select inputs plus source diversity will not repair downstream
source coverage; (3) downstream ranking discards a newly exposed bridge, in which
case selection coverage improves without packed coverage; (4) already packed
evidence is misinterpreted, in which case better source coverage still produces
no QA gain. Each boundary must be reported separately. Controlled scripted
tests can establish (1)'s mechanism, not a historical model-internal cause.

A separate observed D04 representation defect is retained for follow-up:
`verifiedEvidence` validates a receipt's speaker role but emits text-only units,
so answer packing loses the explicit role. The older source-role ablation was
extraction-only and did not fix this seam. Do not silently bundle a speaker-role
projection change into this selection experiment or rescore previous answers.

## Acceptance fixed before work (S1–S10)

- S1: Add an evaluation-only source-diverse selection wrapper and focused tests
  under `evaluation/architecture/`. Intended caller is source-evidence recall.
  Preserve core/schema/prompts/adapters/ranking/defaults and all other model
  ports. Delegate the original selector exactly once with the detached immutable
  original request, same signal and existing 6,000 input / 1,024 output ceilings.
  Validate raw refs before any source lookup; invalid output is never repaired.
- S2: Inspect only memory refs actually visible in that request. Use the supplied
  public `getMemory` with copied bound namespaces, no direct SQL, all-store scan,
  hidden IDs, evaluator anchors or identifier-specific vocabulary. Inspect at
  most 24 distinct cards: original selected refs first, then visible map order.
  Each read requests at most eight receipts, no pagination. At most one final
  reread per inspected card: 48 public reads per select invocation, 96 across
  the existing two-round recall. No extra provider call.
- S3: Source identity is exact namespace plus receipt `client`, `sessionId`,
  `eventId`, `role`, and `excerpt`. It is not receipt UUID, memory ID, equal text
  alone, shared codes, or semantic equivalence. Different source coordinates,
  roles or excerpts remain distinct. No normalization or summary-based identity.
  Retain exact memory/revision/receipt provenance in diagnostics.
- S4: Only complete, nonempty receipt sets of active, non-awaiting memories at
  the requested namespace/revision are eligible for source-set reasoning.
  Partial/over-cap receipt sets are explicitly unassessed: keep any such original
  seed unchanged, do not deduplicate it or expand from it. No partial-set claim.
  Reject failed/malformed/foreign/stale/non-current reads instead of returning
  fabricated or historical evidence. Bound accepted source material to 64 KiB
  UTF-8 over the first pass, with individual response snapshots bounded as well.
  On source-material capacity exhaustion retain remaining original seeds, do not
  inspect beyond the fixed card cap or silently raise it, and report the limit.
- S5: Process original selected refs in order. Remove an eligible seed only
  when all its exact source identities are already represented by earlier kept
  eligible seeds; record each removal. Preserve unassessed originals. Then add
  up to four inspected visible candidates greedily by the count of uncovered
  source identities, breaking ties by original map order, updating coverage after
  each addition. Never add a zero-novelty candidate. Keep original `maxRefs` and
  twelve refs per namespace; empty original selection stays empty with no reads.
  Source diversity is a navigation heuristic, not relevance, truth or completeness.
- S6: Detached snapshots prevent caller mutation. Cancellation/provider errors
  stay errors with no retries. After the compiled-output counter, reread each
  inspected card once and reject changed source identity, state or revision;
  do not treat separate public reads as one atomic snapshot. Core allowed-ref
  validation and authoritative final freshness remain in force. The output is
  immutable and counted within the unchanged output ceiling.
- S7: Real-core controlled integration uses a cold synthetic SQLite snapshot,
  source-only verification/packing and more than six visible cards: repeated
  billing-source seeds, an omitted complementary source, and distractors. Both
  arms get identical original selection input/output and the identical ranker.
  Show actual selected source diversity and whether the complementary source
  reaches final packed evidence. A baseline-only switch must fail the same
  restoration assertion. Ranker logic must use only its received input, never
  fixture IDs/gold closures. Record calls, reads, bytes and final candidate count.
- S8: Cover same-text/different-origin and same-origin/different-excerpt cases,
  namespace/role distinctions, unrelated or contradictory same-code sources,
  exact duplicates with different receipt UUIDs, capacity/tie/order behavior,
  partial receipts, stale/corrected/forgotten/awaiting sources and unseen bridges.
  Include a downstream-rank-loss control: better selection is not automatically
  better packing. Do not add the #381 rank wrapper to make this control pass.
- S9: Owned scratch closes and cleans on success and expected assertion failure.
  Dependency-free generic CI must run all supported integration tests; use a
  labeled deterministic mechanical counter, not a hidden tokenizer dependency.
  Primary runs focused and architecture suites, generic tests, validation and
  maintainer validation on Node 22.16.0 / 24.15.0, records actual exits, cross-checks
  changed-file inventories by two routes, and obtains independent nonauthor
  Standards and Spec reviews of one final committed diff before PR/CI delivery.
- S10: No paid call, old report/DB mutation, retrospective scoring, operational
  ledger change, source retention expansion or product promotion in this packet.
  Keep the unchanged US$400 cumulative / US$30 protected budget. Before a future
  paid comparison, freeze a prospective requested-answer versus background-context
  rubric and new paired baseline; reused cases are seen development, not holdout.
  At most two failed correction rounds on the same hypothesis before re-scoping.

## Ownership and next quality gate

One actual GPT-6.1 Sol/high worker owns the new module, its tests, the technical
implementation record below and a concise limitations entry. Primary owns
integration, observed verification and candidate selection. Two separate
nonauthor reviewers inspect Standards and Spec. No worker commit/push or paid run.

This is the recorded re-scope after the first two candidate mechanisms, not a
reset of the old experiment. A source-diversity gain alone does not satisfy the
Stage 2 gate of at least three net additional correct answers, improved targeted
coverage and no added unsupported/stale/severe errors. If source coverage remains
weak, report the actual limiting boundary before another paid trial.

## Implementation and observed evidence

Original S1–S10 above remain fixed. Final independent review and latest-head CI
are recorded in the PR, not inferred from the local results below.

### Worker implementation

`createSourceDiverseSelectionModel(model, { readSet, getMemory })` captures the
original selector and its bound token counter. Its only changed port is `select`:
one unchanged original model call, followed by public source reads and deterministic
assembly. The pure `assembleSourceDiverseSelection(input, originalOutput,
{ readSet, inspections })` returns immutable `{ output: { refs }, diagnostics }`;
inspections are actual `{ ref, response }` public-get observations in selected-first
visible order. It reuses the existing safe JSON snapshot, visible-reference compiler,
token-budget helper and typed core errors, not a new retrieval framework. Neither
API imports a corpus, evaluator, adapter, gold anchors or source-linked rank wrapper.

Eligible complete sets use exact JSON-encoded namespace/client/session/event/role/
excerpt identities. Receipt UUIDs remain source provenance, not equality keys.
Partial sets retain seeds but cannot justify removal or expansion. The original
`maxRefs`, twelve-per-namespace cap and four-addition limit remain fixed. Repeated
identities count repeatedly toward the accepted 64 KiB first-pass material bound.
The crossing read counts as inspected but contributes no eligible reasoning; no
later first-pass read occurs. All inspected cards, including the crossing card,
are reread once after output counting. Each individual detached response is bounded
to 64 KiB; this accepted-material bound is not a claim about total allocated process
memory. Separate reads are not atomic. Source identity/state/revision changes reject
the result, and core final freshness remains authoritative.

This adds at most 48 public reads per selection (96 over two recall rounds), no
provider call. Selection can expose up to four additional cards and therefore
increase downstream rank-input and answer-context cost; it can also remove exact
duplicate seeds. It does not promise relevance, truth, complete coverage or a QA
gain. Unrelated/contradictory sources remain distinct, and unseen cards are never
read, even when the supplied storage port contains them. Diagnostics contain exact
source excerpts and coordinates and require the same source-data privacy treatment
as the input; they are not an unrestricted logging recommendation.

### Worker observed checks

The first focused Node 24 run exited 1 (11/15 passed) due to four test-fixture
mistakes: empty-seed observations incorrectly included reads; mock namespaces
shared mutable objects; packed provenance was incorrectly indexed per memory
rather than per receipt; and a mutation-test counter rejected legitimate non-JSON
core count inputs. Those fixtures were corrected without policy relaxation. The
inspection accessor/custom-prototype boundary already passed with zero hooks run.

The controlled cold-core case has eleven visible cards and identical original
selector input/output in both arms. Original selection has three refs carrying
one exact source; treatment has five refs carrying six exact sources, with two
duplicate seeds removed and four novelty additions. The unchanged input-only
ranker receives three versus five candidates. Actual verified packed evidence
restores required source coordinates from 1/2 to 2/2, one versus two packed units;
both arms make one select and one rank call. The treatment performs 22 bounded
public reads and accepts 5,168 source-material bytes. A labeled deterministic
mechanical counter reports 144 versus 198 answer-input tokens, not provider-token
or paid-cost measurements. The separate rank-loss control remains 1/2 packed in
both arms despite the same selection-diversity improvement. Four real correction/
forget controls invalidate seeded or added evidence before ranking. The baseline-
only switch fails the identical final restoration assertion (`1 !== 2`) and owned
scratch is closed and removed on success and expected failure.

No old result is rescored and no paid trial or default promotion is enabled.
Primary's recorded-selection replay is a separate source-access diagnostic, not
fresh ranking, an answer or a QA score. Prospective requested-answer/context
separation and a newly frozen paired baseline remain prerequisites. The independent
speaker-role projection defect is not bundled here. Final supported-Node/archive
exits and primary acceptance evidence are appended separately after freeze.

Final worker source-only proof archived fixed HEAD into one fresh owned workspace,
overlaid exactly the four packet files and verified both root and OpenAI-adapter
`node_modules` were absent. The final 16-test suite passed 16/16, skipped zero,
actual exit 0 on Node 22.16.0 and 24.15.0. The baseline-only suite exited 1 on both
with exactly one intended failed assertion, packed source count `1 !== 2`; all
other controls passed. The proof driver exited 0 after asserting those child exits
and verifying owned scratch removal. `git diff --check` also exited 0. No adapter
install or provider-token/model/answer call was used. Generic Node 20 pure tests
retain the existing supported-SQLite guard; no local Node 20 binary was available,
so this worker does not claim an observed Node 20 execution.

### Primary acceptance and next decision

Primary personally inspected the complete module/test and ran the final worker
handoff on Node 22.16.0 and 24.15.0 in keyless environments. On both runtimes,
each command returned actual exit **0**, with no signal or supervisor error:

- Focused source-diverse suite: 16 passed, zero skipped.
- Complete architecture suite: 114 passed, zero skipped.
- `npm test`: 653 passed, zero skipped.
- `npm run demo:recall`, `npm run validate`, and isolated plugin validation.
- The separately retained recorded-input selection replay, using the actual
  pinned local tokenizer and 24 closed-database copies, covering all 48 original
  arm slots. No fresh rank, answer, provider call or operational ledger write.

Primary also ran the exact S7 test with
`CAIRN_SOURCE_DIVERSE_BASELINE_ONLY=1`: actual exit **1** on both runtimes, at
the intended actual-packed-source assertion `1 !== 2`. A separate recorded D11
baseline-only check also exited **1** on both: three selected cards contain only
one distinct source and one of two required anchors. Both negative controls
remove owned scratch after the expected failure. Positive tests do not replace
these observed failing controls.

Recorded-input selection diagnostics (not answer scores): ordinary selection's
required anchors increase from 35/42 to 42/42; the old full-label arm's increase
from 36/42 to 42/42. Across all 48 slots, selected refs increase 106 to 143 and
distinct source appearances 105 to 161. Eleven slots gain at least one selected
anchor. There are 378 added local public reads in total, no extra model calls.
These are small previously seen development stores, with at most six visible
cards in each original selection input; they do not establish long-store fit.
The separate eleven-visible-card controlled integration above checks competition
but is scripted, not a semantic score. The policy is round-local: it does not
deduplicate source identities across successive selection pages.

All 24 original closed DB hashes and the original report hash remained unchanged;
their original paths gained no SQLite sidecars. Replay scratch was removed. The
primary retained helper SHA-256 is
`872ef1c53d184d53e6ed0d2ba900a10b13142709abb0c0731af277827f32ce9e`.
Final module/test SHA-256 values are respectively
`36c678cee22fc7f03da71b739d9e4499fe48d276732076e8834f72cee560dedb` and
`91ce52423c356e00d4d6e6f6ae42c1fc057c71d73ff402723b66fd1cce368326`.
All four worker handoff files stayed byte-identical through both primary gate
runs; this section is the primary's subsequent evidence-only integration edit.
Diff-plus-untracked and porcelain-status inventories independently matched four
scoped files; `git diff --check` returned 0.

Primary independently reproduced the role-projection defect without an LLM:
two cold synthetic stores differ only in a receipt's submitted user/assistant
role. Public core reads preserve that difference; normal provenance verification
and answer packing produce identical answer requests. The role-preservation
assertion exited **1** on both runtimes, with owned cleanup verified. This locates
an answer-adapter representation loss, not a claim that core erased the role or
that all attribution failures share this cause. No role fix is bundled here.

Decision: this source-diversity candidate has enough selection-stage effect to
justify preparing a paired answer-quality experiment after final review, unlike
the narrowly useful rank-only identifier policy. It is not promoted yet. Freeze
the prospective rubric before new model output: require what the question asks,
retain necessary conditions/uncertainty, score optional background separately,
and require the same QA verdict for concise versus equally correct explained
answers. Keep the ordinary answer instruction and both arms' resources equal;
use a new paired baseline, not the old full-context rubric score. Report selected,
packed and answer outcomes separately, including any added context cost and all
failures. Previously seen cases remain development data. The original Stage 2
gain/safety gate and eventual separate Mem0 comparison remain unmet.
