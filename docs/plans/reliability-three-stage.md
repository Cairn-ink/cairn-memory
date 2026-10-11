# Reliability and answer quality development plan

Status: accepted development direction; first Stage 2 candidate completed and
rejected. The new requested-answer/source-diverse comparison has closed with
net +3 correct answers, but its safety-unknown gate blocks advancement;
remaining quality/installed-host gates are pending.
The next bounded candidate is the prospectively specified
[role-preserving source-diverse/linked comparison](evidence-bundle-qa24.md).
It has no new semantic result yet.
Owner: primary DRI. This is the single current plan for the three-stage sequence
agreed with the owner on 2026-10-09. Executed checkpoints link separate frozen
result reports; prospective steps do not establish a score or release.
Planning base: `d7f52b95ddc7f11a8982b4d85b1ca96aac1fb58c` (public main).

## Delivery acceptance fixed before implementation

- P1: Preserve the goal: lightweight, source-backed memory usable through Hermes
  and other harnesses, with one shared public engine. Completion, answer quality,
  semantic reliability and installed-host behavior remain distinct gates.
- P2: Record the audited historical thirty (Cairn 13/10/7; Mem0 21/8/1) and later
  six (Cairn 2/4/0; Mem0 4/2/0), in correct/incorrect/unresolved order. Link exact
  frozen reports; never pool cohorts, relabel completion as accuracy, change old
  results or present pending branches as released behavior.
- P3: Stage 1 traces all four later wrong answers and separately accounts for
  the seven earlier incomplete answers. Mark unavailable evidence unknown. Reuse
  existing diagnostics; obtain a runnable red-capable controlled reproduction
  before causal claims. Synthetic/oracle evidence does not establish a historical
  model-internal cause. Stop/re-scope a hypothesis after two unsuccessful rounds.
- P4: Stage 2 freezes 24 development questions, expected answers, source anchors,
  risks, models and resource settings before treatment results. Change one main
  factor per comparison; try at most two candidate interventions before review.
  Advance only with at least three net additional correct answers versus its
  paired baseline, an improved targeted-stage metric, no increased unsupported
  or stale-use errors, and no newly failing predefined severe-error case. These
  are development gates, not a statistical parity claim or a 100% QA target.
- P5: Preserve lightweight constraints: first candidates add no external database
  service; freeze/model account for calls, tokens, latency and storage growth.
  Canonical expiring staging is not a durable searchable archive; no silent
  retention expansion, namespace weakening, automatic capture or default change.
- P6: Stage 3 targets a newly frozen thirty-case paired comparison, subject to
  fresh-case availability and budget preflight. At least 29/30 Cairn completions
  and Cairn correct count no lower than the same-batch Mem0 are development gates,
  not population parity. Report joint completion and all fixed-denominator
  outcomes, paired uncertainty, missing types, runtime/model/resource differences
  and failures. Holdout data cannot tune Stage 2; do not replace failed cases.
- P7: Keep an independent reliability challenge suite and genuine installed
  Hermes new-session use separate from QA scores. Adapted HaluMem/STALE-inspired
  cases are not official benchmark scores. Scripted tool dispatch is not natural
  model tool-use evidence. No product acceptance while host/resource gates remain
  unverified.
- P8: The original cumulative US$400 ledger and US$30 protection remain intact.
  No resets, refunds, retry of closed runs or new accounting system. This packet
  is offline only. Later paid work requires frozen reviewed scope and conservative
  affordability; a thirty-case target is not a claim that funds suffice. Ask the
  owner only for material choices/authority outside the existing scope.
- P9: Keep "Factor DB" unidentified; neither a paper title nor vector/fact-store
  interpretation is established. Literature is design inspiration, not Cairn
  evidence. Reuse existing MOC/relationship capabilities before adding machinery.
- P10: Deliver in isolated worktrees with bounded actual GPT-6.1 Sol workers,
  primary verification and separate nonauthor Standards/Spec reviews. Record
  exact exits and two-route changed-file inventories. No merge, release, deploy,
  user-data mutation, historical cleanup or credential exposure in this packet.

## Execution record

The primary wrote P1-P10 before delegation. GPT-6.1 Sol/high authored this
plan; a separate GPT-6.1 Sol/high performed the read-only historical audit.
The four wrong-answer traces and seven refusal boundaries below were checked
against all three pinned reports. No old score was changed. Primary integration
adds observed verification and resolves scope/authority wording; no production
code, model calls or operational ledger changed. No quality stage is complete.

The first controlled probe below now runs. On one fixed cold two-memory store,
ordinary labels deliver one source; the existing full-label wrapper delivers
both with the same candidate IDs/order, selector, ranker and packing limits.
Labels expose 200 versus 433 UTF-8 bytes; each arm calls select/rank once, while
the wrapper adds eight local reads. This is a scripted exposure/selection
contrast, not a real-model score or proof of the later-six failure's cause.
It supports testing bounded exposure on the frozen development set, not
enabling full labels by default or replacing source-retention work.
DRI recommendation for the Stage 1 review: use this existing bounded wrapper
as the first Stage 2 comparison, because it changes one observable boundary
without waiting for new archive capabilities. This is a low-dependency test
choice, not a claim that labels caused the old failures. Keep source omission
and already-packed temporal interpretation as separate follow-up hypotheses;
do not add their changes to this arm to force a three-answer gain.

Primary rejected the first prototype's hardcoded cue vocabulary despite its
green result. The one correction derives cues from the received query
(`display: basis; reconfirm`); source fixtures and budgets stayed fixed.
Primary then temporarily disabled only the treatment wrapper: the scoped test
exited **1** with `ERR_ASSERTION` on Node 22.16.0 and 24.15.0. Restoring it
restored the worker's exact test SHA-256
`39e1e0c1c1575b3653ac662284eb3b000442f6e9fd4e3cc5f650f14c85a6bc87`.
The mutant was not committed. Worker full-file checks passed 13/13 on each
runtime; primary full-file/contributor checks and independent final review
remain pending until recorded in the PR.

Primary also ran the existing lineage tests (2/2) and long-history gate tests
(5/5) on both supported runtimes, all actual exit **0**. The Node 22 standalone
malformed-extraction fault CLI returned the expected **1**, not a false success.
These controls exercise real core boundaries with scripted models. The
worker's earlier long-history attempts failed **1** at missing `tiktoken`,
before assertions; the locked adapter install resolved that prerequisite.
The first primary generic supervisor cut off `npm test` at 240 seconds
(`ETIMEDOUT`/`SIGTERM`, no command exit code). Its later stdout summary is not
accepted as a pass; the final gate uses a 600-second supervisor and retains
the interrupted attempt. No product timeout or test assertion was weakened.

## Baseline and boundaries

The frozen [earlier thirty](https://github.com/Cairn-ink/cairn-memory/blob/8368c5f6b86bbb5ab73c551f2721a096104499ed/docs/plans/fresh-thirty-results.md)
reports Cairn 13 correct / 10 incorrect / 7 unresolved versus Mem0 21/8/1;
generation completion was 23/30 versus 29/30. The separately frozen
[later six](https://github.com/Cairn-ink/cairn-memory/blob/fc058643cc28bd26c41eaf025c1852e41497f919/docs/plans/fresh-six-timeout-results.md)
reports Cairn 2/4/0 versus Mem0 4/2/0, with 6/6 completion per arm. Different cases/settings prevent pooling
or attributing completion gains to the timeout setting. Neither is held-out acceptance or natural installed-host use.

The [source-competition study](https://github.com/Cairn-ink/cairn-memory/blob/1a7a4826ea310a07b281a7c2133cd51826db1dc9/docs/plans/source-competition-results.md)
improved agreement-based semantic anchor retention from 12/16 to 14/16 but
failed its citation/safety gate: do not promote. Its US$321.282281 reservation
is historical, not a live balance. Pending #373–377 work remains on separate branches,
outside this public-main baseline; no answer-score gain is established.
Stored MOC structure alone does not establish topic-guided recall: `core/contract.mjs` invokes
`queryCandidateRows` with query scoring and bounded labels before selection. Inspect actual model-visible
inputs; reuse existing MOC/relationship capabilities before proposing new machinery.
"Factor DB" remains unidentified; no vector/fact-store interpretation is adopted.
The [raw-layer contract (RL-0)](raw-layer-contract.md) is decided but not implemented.
Its implementation waits for G1 (production backups/staging restore) and G2 (H6 cutover);
raw search is outside that contract. Reuse its archive/lineage design instead of creating
a duplicate durable archive. This reliability plan neither implements RL-0 nor bypasses its gates.

## Stage 1: locate the loss before choosing a correction

Trace each of the four later wrong answers in this order: canonical source →
cold retained receipts → candidate passage/reference visibility → selection →
rank/final recall and packed context → answer. Record present, absent, unknown
or not-run at every boundary, and distinguish full passages from preview labels.
Preserve the frozen answer judgment; new diagnosis does not rescore old cases.

| Later-six ordinal | Established observation | Mechanism still to test |
| --- | --- | --- |
| 1 | Critical user window absent from receipts; related assistant evidence not shown to select. | Extraction/window omission and candidate routing are distinct hypotheses. |
| 2 | Necessary retained component shown but not selected; remaining context insufficient. | Selection policy versus multi-source interpretation. |
| 5 | Both needed dated receipts reached final recall and answer packing. | Answer use of dates/current applicability; evidence delivery did not ensure correctness. |
| 6 | Critical user window absent; another window of the same source retained. | Detail/window retention; dataset type does not identify speaker role. |

The frozen report's durable-state/code inference for 1/6 rules out its checked later suppression/receipt-loss
paths, not every information-loss path. Raw extraction replies were not retained. It does not establish
why a model omitted a window, exclude summary paraphrases or prove a model-internal cause.

Account separately for the earlier seven incomplete Cairn arms: ordinals
2/13 text-bound refusal, 3 duplicate-source validation, 4/7 extraction timeout,
6 invalid classification, 11 classification timeout. These are observed refusal
boundaries, not seven wrong answers or established provider causes. Admission
may precede classification failure: inspect cold receipts/unfiled cards without
recovery. Unavailable subreasons/timing stay unknown; do not retry closed runs.

Use [long-history stage observations](long-history-stage-gate.md),
[source-loop controls](../source-loop-controls.md), the existing
[MOC diagnostic](moc-retrieval-diagnostic.md) and bounded lineage/failure
diagnostics. Respect each helper's caps; over-cap controls are unavailable,
not truncated oracle successes. Avoid creating a replacement framework.
Minimize fresh synthetic reproductions at the implicated seams; freeze fixtures
and expected negative controls before execution. Demonstrate a runnable failing
control and the same-case intervention with unchanged unrelated factors. An
oracle supplied evaluator anchors measures an upper bound only; it never enters
ordinary retrieval or proves the historical cause. After two unsuccessful
controlled rounds on one hypothesis, stop, record evidence and re-scope with
primary. Do not keep tweaking prompts/caps until a favorable result appears.

Stage 1 exits with a source-free boundary matrix for all four wrong and seven incomplete arms,
a red-capable reproduction packet, unknowns and a bounded intervention recommendation.

### First new controlled probe (fixed before delegation)

- L1: Extend only `evaluation/architecture/test/full-label-model.test.mjs`.
  Reuse the evaluation-only full-label wrapper, actual public core, fresh
  synthetic SQLite, and normal source-only answer packing; no product change.
- L2: Use one fixed two-memory fixture and the identical visible-input-only
  selector/ranker/query in both arms. Only label expansion changes. No closure
  over target IDs, expected answers or evaluator anchors in model callbacks.
- L3: Establish actual core candidate visibility in both arms and a qualifier
  absent/present contrast in their labels. Assert the required component's
  selection, final recall and final packed source, not merely a valid response.
  If the baseline already exposes it, record that refutation; do not invent a
  clipping failure with manually substituted select inputs.
- L4: Show the diagnostic is red-capable with a retained evaluator-only
  negative control. Count callbacks and exposed label bytes; label the counter
  and decisions scripted, not real token costs or semantic accuracy. No new
  selector/model call budget or added candidate IDs to rescue the treatment.
- L5: Use the owned workspace helper, close before cleanup, and run on both
  supported Nodes. Keep existing tests unchanged; Node 20 lacks core SQLite
  and may skip only this integration as existing tests do.
- L6: This tests the exposure/selection failure class, not historical ordinal
  2's unknown precise reason. It cannot recover unadmitted source windows or
  explain ordinal 5's already-packed wrong answer. At most two failed probe
  rounds; record rejection/unknowns instead of manufacturing a winning case.

## Stage 2: fixed development selection, not a parity claim

### First comparison execution contract (2026-10-10)

The owner approved proceeding and made algorithm/answer quality the short-term
priority. The Stage 1 packet is reviewed in #378 (base for this dependent branch
`1139d453bb835c8479884fceac0d1b7bd4baad29`); it is not yet merged. First compare
ordinary selection labels with the existing bounded full-label wrapper, without
changing capture, model, prompts, ranking, candidate IDs, recall limits or defaults.
This is a synthetic development comparison, not a new official benchmark score.
The earlier P8/P10 offline-only wording describes the delivered Stage 1 packet;
this separately approved comparison permits bounded paid work only after B6/B7.

- A1–A7 corpus packet: exactly the 24 variants below, realistic fresh synthetic
  sessions; separate source-only inputs and evaluator-only gold/anchors; validated
  exact spans; no held-out data; freeze independently before model execution.
- B1: Capture each case once through the real core/adapter with indexed source
  evidence. Close and reopen the same immutable captured state for both arms.
  Use normal default-selection recall (no `selectionMode` override), the bounded
  keyset candidate policy, six-unit limit and existing source-only answer packer.
  Alternate baseline/treatment order by ordinal; one attempt per arm, no retries.
- B2: Full-label selection is the only intervention. Record the real model-visible
  candidate identities/order, label bytes and stage outputs. Distinguish identical
  first inputs from later divergent navigation; no oracle IDs enter model calls.
- B3: Retain capture, selection, recall and packed-source evidence and all failures
  over N=24. Capture failures make both downstream arms unresolved, not replaced.
  Two independent nonauthor blind judgments use the frozen rubric; unresolved
  disagreement receives no correct credit. Stage-specific anchor coverage and
  safety counts are scored separately from answer quality.
  This run uses agreement-only scoring with no adjudication: retain each judge's
  claim counts separately, and block advancement on unknown/disagreed question-
  level unsupported, stale or severe classifications. Missing judgments count
  unresolved. Blind labels conceal arm identity from both same-family reviewers;
  their agreement is not independent human ground truth. The targeted metric is
  exact required-source-anchor coverage in packed source text, normalized using
  the existing source normalizer, over every frozen positive anchor (not only
  completed cases). It must increase; literal presence is not semantic support.
- B4: Pin the existing `gpt-4.1-mini-2025-04-14` benchmark model to isolate the
  algorithm factor; GPT-6.1 Sol/high is the implementation/review agent, not a
  silently substituted evaluated model. No external database service.
- B5: Reuse the original existing-only bound ledger, exact adapter serialization
  and answer protocol. Maximum 40 core model calls plus two answers per case,
  1,968 HTTP requests total, US$10 conservative reservation; 6,000 local input
  tokens, 7,024 provider count ceiling, 1,024 core / 512 answer output tokens.
  Per physical request timeout 200 seconds, per case 20 minutes, run 8 hours.
  These are outer bounds: unchanged public-main core logical calls still have
  their 30-second default. The transport does not extend that core deadline.
  No retry; overflow/timeout retained, accounting/authentication anomalies stop.
  The US$400 cumulative ceiling and US$30 protection remain unchanged.
- B6: Before any key lookup/network, freeze reviewed corpus/rubric, runner,
  transport, runtime, order, resource caps and one-shot output marker; inspect
  live affordability. Do not reset/refund reservations or reopen old operations.
- B7: Offline tests exercise both real-core arms, cold-state identity, failures,
  no-gold boundary, request accounting and cleanup. Primary verifies on both
  supported Nodes and obtains independent Standards/Spec reviews before paid use.
  Promote only under the unchanged Stage 2 gain/safety/resource gates below.

Read-only budget check on 2026-10-10 found 55,389 reservations, US$321.282281
reserved, no pending attempts, open ledger. US$48.717719 is available outside the
protected US$30 at that checkpoint, not dispatch authority or an invoice.
Primary owns integration and execution; a bounded GPT-6.1 Sol/high worker owns
the corpus/rubric, and a separate bounded worker owns runner/transport code.
No historical cleanup, source-retention expansion, merge, release or deployment.

Pre-execution corrections: the first synthetic integration showed that
`bounded-source-scan` bypasses select on a complete small candidate map. Both
arms therefore use the core's ordinary default selector; otherwise this small
corpus would not exercise the proposed intervention. This is not a replay of
the historical mixed-benchmark profile. Independent rubric review also found
one question supplying its own cross-session key (D11), four over-demanding
answer requirements (D03/07/15/18), and incomplete required-anchor spans
(D09/12/19). Those are corrected before any model output; initial prospective
hashes are superseded rather than presented as an executed freeze. No paid call
or answer observation informed these corrections.

The corrected prospective corpus has 24 cases, 42 positive required anchors,
and canonical hashes: inputs `56f0db72471781497872cdf757c9f9db45772a334198e9e26ac1b4dd947215ac`,
rubric `c40952734852e01072185939c51f54efa8238d5fa1b44259bf3964b8088ce4f5`,
combined `926bc92a1628924167fe1c77d5de6eb8234a4f52dd3b215e88c535bea7d8a5df`.
The two bounded GPT-6.1 Sol/high workers delivered corpus/aggregation and
runner/transport respectively. Primary integrated the explicit one-shot launcher
and existing CI job, inspected the real diff, and reran the combined 28-test
offline suite on both Nodes (actual exit 0 each). The unchanged generic suite
passed 623/623 on both (actual exit 0 each). Final fixed-diff reviews and clean-
candidate launcher smoke precede any paid execution; no semantic result yet.

Independent review of `3dacb337` found one Spec gap (the executable anchor metric
was not yet integrated) and one Standards breach (a successful JSON `null`
response did not latch the required usage-anomaly stop). The first correction
round adds the origin-bound 42-anchor scorer with missing-stage accounting and
the parsed-root rejection tests; it does not alter the corpus, models or prompts.
The primary's `judging.mjs` integration creates shuffled opaque labels for both
nonauthor reviewers and keeps the mapping private. Correctness uses full source
truth and the rubric; unsupported-claim counts require actual packed-source
support, while stale-use checks also consult the full chronology. No adjudication.
Each judge's original file, disagreements and claim totals remain separate.
Primary will combine agreement-based net gain ≥3, packed-anchor gain >0, all
safety gates and the declared resource bounds into an explicit advance/reject
decision; a passed gate does not itself enable a product default.
Clean-candidate one-shot launcher smoke on both Nodes passed with actual exit 0:
24 cases/48 arms with fake HTTP only, 220 synthetic requests, retained settlement,
rejection of reused successful/failed output directories, and no owned test
residue. The revised final candidate is subject to affected checks and both
review axes again before the first paid call.

First-comparison result checkpoint: the finalized
[24-case report](algorithm-dev24-results.md) records 24/24 completions per arm
at runtime `2ca81e5a8ca686760f94c27c3d24367fdab6ae51`. Agreement on the full
frozen development rubric was ordinary 10 correct / 14 incorrect / 0 unresolved
and full labels 9/14/1. The original gate rejected this candidate: net correct
gain −1 did not meet ≥3, despite packed-anchor presence rising from 32/42 to
34/42, unchanged question-level harm counts and passing resource caps. Two
independent nonauthor blind judges retained one disagreement without
adjudication. An independent Spec audit found required propositions mixing
sufficient answers with unasked explanatory/background detail; these counts
are not ordinary or general answer-accuracy estimates. Original results,
version-1 questions/sources, rejection and P4's gate math remain frozen.

The accepted next direction separates requested-answer correctness from context
completeness prospectively, with concise-versus-explained invariance controls
and necessary scope/time/uncertainty qualifications. Packed-support, stale-use
and severe-error checks remain separate. It targets bounded multi-card
evidence-chain preservation/assembly, motivated by D11's mural → order →
billing-recipient dependency, rather than extra answer verbosity. A source-bound
recorded-response replay exactly reproduced D11's selection/ranking/recall and
packing: two selected/fetched cards became one ranked/packed card (1/2 anchors).
The existing small-candidate-retention control retained both (2/2 anchors),
with answer-input tokens increasing from 188 to 248 and no delegated rank/model/
provider call. The primary verified intended red-control exit 1 and paired exit
0 on both supported Nodes, unchanged store/sidecars and owned cleanup. This
localizes that recorded source loss to rank output, not packing; it establishes
a mechanical opportunity, not fresh semantic gain or candidate promotion.
The next comparison requires a newly frozen
paired baseline and reviewed scope; it cannot compare a new metric with the
original 10/9 counts or retrospectively rescore this run. Any future corpus
version must be explicit and labeled previously seen development, not fresh
or held-out. No new protocol, paid comparison or product default is enabled.
Historical cohorts are unchanged.

Source-diverse requested-answer checkpoint: the separately frozen
[new paired development report](source-diverse-qa24-results.md) completed all
24 captures and 48 answers at reviewed runtime #383. Effective selection carried
42/42 anchors versus ordinary 31/42; final packed presence was 37/42 versus 30/42.
All source anchors were retained and candidate-reachable in both arms; five
treatment anchors still disappeared at final recall. Resource ceilings passed
with 392 HTTP attempts and US$1.96 conservative reservation delta, not an invoice.
Two independent blind judges agree on all 48 correctness verdicts: ordinary
20/4/0 versus source-diverse 23/1/0 (correct/incorrect/unresolved), with three
wins, zero losses, 20 both correct and one neither correct. The unchanged ≥3
net-correct gate passes, but `advances: false`: D04 treatment has an unresolved
unsupported-claim disagreement. Known unsupported question counts are two each,
stale/severe counts zero; conservative safety flags remain unproven rather than
indicating an observed stale increase. No adjudication or gate change is made.
This is previously seen development data under a new rubric and new baseline,
not a comparison with the old 10/9 scores or a default promotion. Stage 3 remains
blocked. Primary's offline deterministic replay of the existing source-linked
rank compiler restores D10/D12 bridges: ordinary packed presence stays 30/42,
source-diverse changes 37→39/42 without new answers or scoring. D10/D12 lose
selected bridges at ranking; D04 retains roles through rank
receipts but projects text-only answer evidence and misattributes the adviser.
The separate source-role red/control probe confirms that role flips survive
core receipts but leave packed requests identical. This is not causal proof of
an answer improvement or resolution of D04's unsupported-claim unknown. The
next implementation candidate is a small opt-in, versioned evidence-rendering
fix; existing rank assembly remains a separate future comparison candidate and
old profiles stay frozen. This report
authorizes no new live trial or profile promotion; the next experiment needs a
prospective scoped freeze, independent review and current shared-ledger preflight.

Post-two-candidate review decision: retain both closed results and their
rejections, rather than extend either operation. The primary reviewed the
observed loss boundaries and both supported-runtime red-capable controls.
Selection diversity addresses a different boundary from ranking's loss of an
already selected bridge; preserving recorded roles addresses a representation
loss common to both arms. The next contract therefore explicitly tests one
combined source-diverse/linked retrieval candidate against ordinary retrieval,
with the same role-aware representation on both sides. It cannot isolate the
ranking-only effect or use the earlier 20/23 counts as its comparator. A fresh
paired baseline, unchanged requested-answer rubric and unchanged advancement
thresholds are required. This is a recorded revise decision after the first
two candidates, not an unbounded sweep or a relaxation of their failed gates.
Previously seen development data and further selection bias remain limitations;
passing this checkpoint still requires a separately frozen broader comparison.

Freeze 24 questions, four in each family, before treatment observations. Each
listed variant contributes one question; publish every slot and family count.

| Family / local development slots | Four frozen variants |
| --- | --- |
| Detail retention / D01–D04 | Nonopening number; middle condition; tail exception; attributed assistant instruction. |
| Lexical/paraphrase/CJK / D05–D08 | Exact lexical; paraphrase without shared keyword; Chinese query; mixed-language alias. |
| Multi-session links / D09–D12 | Two-session dependency; three-session chain; distractor link; missing-link abstention. |
| Event-time/late import / D13–D16 | Event versus ingestion time; late old import; relative date; overlapping scopes. |
| Proposal/adoption/premise update / D17–D20 | Unadopted proposal; explicit adoption; premise changed/reconfirm; reaffirmation without replacement. |
| Unknown/conflicting evidence / D21–D24 | Absent source; unresolved conflict; partial support; quoted third-party claim. |

The evaluator-only freeze includes corpus/version/hash, roster, expected answers
(including qualified/abstaining answers), exact supporting anchors, required
multi-source sets, unsupported/stale-use definitions and predefined severe-error
cases. Freeze prompts, runtime/artifact, model versions, judgment protocol,
token/call/time caps, candidate/recall limits, source policies and resource profile.
Freeze independently reviewed rubric before any baseline/treatment results;
question wording cannot be chosen after seeing retrieval. Expected answers and
anchor identities remain outside capture/production retrieval/model inputs.
Reserve Stage 3 sources/questions/gold separately; do not inspect or tune on them.

Compare a same-roster paired baseline with one main factor changed at a time.
Choose at most two candidate interventions from Stage 1, then make a recorded
advance/revise/stop decision. Examples are bounded detail retention, candidate
reachability or dated-evidence answer use; these are alternatives, not a bundled
architecture promise. Explicitly label source-only versus qualified profiles;
changing both invalidates a single-factor explanation. Freeze arm order and
any repetitions in advance, preserve failures, and never replace expensive,
incomplete or difficult questions. If baseline/resource settings change, a new
paired baseline is required; do not select a favorable historical comparator.

Report each arm's correct/incorrect/unresolved over fixed N=24, completion/24,
family counts/4 and the 24 paired outcomes. Incomplete or unknown judgments earn
no correct credit. Two independent nonauthor judgments retain disagreements;
adjudicate under the frozen rule, otherwise unresolved, never favorable picking.
Report pre-adjudication disagreement/unknown counts as well as final outcomes.
Anchor retention/visibility/selection/context coverage use separately frozen
required-anchor denominators; presence is not semantic support. Unsupported and
stale-use counts are question-level counts/24 (overlap allowed); additionally
report affected claims/all reviewed claims so increased output cannot hide harm.
Upstream not-run opportunities remain in the fixed stage denominator, with
unknown/not-run counts visible. No cherry-picked common-success denominator.

Advance only if candidate correct minus its paired baseline correct is ≥3/24,
the predeclared targeted-stage metric improves, unsupported and stale-use
question counts do not increase, and no predefined severe-error case newly
fails. Severe cases cover unsupported adoption/current-state assertions,
namespace leakage and forgotten/expired evidence resurrection. Unresolved
safety judgments block advancement pending adjudication; uncertainty cannot
silently count as no harm. Report all candidate results, including rejected ones.
These are development selection thresholds, not significance, generalization, population parity
or a 100% quality target; repeated tuning consumes this set.

First candidates add no external database service. Measure calls, input/output
tokens, conservative/known cost, cold/incremental capture and recall latency,
store growth and expiry effects with explicit workload/profile denominators.
Freeze affordable resource ceilings before treatment; improved QA beyond those
ceilings does not pass the lightweight gate. Increased batches/context are a
resource difference, not equal-budget superiority. Expiring canonical staging
cannot silently become a durable automatically searched transcript archive:
retention duration, consent, quotas, namespace/deletion fences and exposure policy
need explicit review before any expansion. Keep defaults and capture scope bounded.

## Stage 3: fresh paired pilot plus independent product gates

Begin only after Stage 1/2 acceptance, reviewed final artifact/installed-host
prerequisites, semantic scorer checks, fresh-case audit and conservative budget
preflight. Target 30 new cases paired with pinned native Mem0; preserve source
input, answer/judge protocols and prospectively frozen arm order. Check the
exclusion inventory without opening held-out gold. Historical preference cases
are exhausted: presently available coverage is five types, targeting six each.
Disclose zero preference cases; do not claim all-six-type or full-benchmark
coverage. If fresh availability is insufficient, stop and review scope before
dispatch rather than recycle or substitute cases.

Freeze one primary comparison profile: native (each engine's pinned normal
limits/model and embedding choices) or matched-resource (declared equal ceilings
and settings). Report both arms' configurations and resource gaps. A second
profile is optional and requires separate prospective scope and affordability;
it is not a mandatory second thirty. Identical source input alone does not make
resources equal. Do not relabel a native arm a matched control or force new
native restrictions after results.

Pilot advancement requires Cairn completion ≥29/30 and Cairn correct count no
lower than Mem0 on the same fixed thirty. Report correct/incorrect/unresolved
and completion per arm/30, joint completion/30, common-resolved N, type counts,
all ordinal paired outcomes and severe/safety failures. Conditional accuracy
is secondary with its denominator shown. Mandatory paired uncertainty includes
the discordant-pair table, a predeclared paired-difference interval/method and
best/worst unresolved bounds over all 30; do not substitute independent-arm
intervals or omit failures. Review uncertainty even if the count gate passes:
this pilot cannot establish population parity or product acceptance.

An independent reliability challenge suite separately exercises detail loss,
late-import/event-time confusion, proposal/adoption, changed premises, conflict,
abstention, namespace separation, forgetting and expiry on fresh synthetic cases.
Freeze its rubric/severe cases before execution; it cannot tune on pilot holdout.
Literature-inspired cases are adapted diagnostics, not official benchmark scores.
Natural installed Hermes use requires an inspected artifact, synthetic profile,
actual model-driven capture/recall across genuinely new sessions, independent
source-support judgment and host/resource observations. Scripted AIAgent/tool
dispatch establishes plumbing only. These gates remain distinct from pilot QA;
product acceptance waits for reliability, natural host and resource evidence.

## First packet, ownership and stop conditions

The first executable packet is offline Stage 1 only: the four-row boundary trace,
separate seven-failure accounting, and ≤4 minimized synthetic probes reusing the
existing controls. Deliver source-free observations, exact commands/exits,
fixture/expectation identity, failed controls, unknowns and one recommendation.
Do not build Stage 2 corpus or implement a new treatment before that review.
The L1–L6 probe reuses an existing evaluation-only wrapper; it ships no runtime
behavior. Next review should choose bounded selection exposure versus separate
source retention/reachability work, with a dated-reader comparison still needed
for the already-packed wrong answer. Do not bundle all three into one claim.

Primary owns scope, mechanism selection, integration, direct verification, budget/freshness and acceptance.
One bounded actual GPT-6.1 Sol/high worker owns each assigned docs/probe packet in the isolated worktree;
the docs worker changes only this plan, ROADMAP pointer and limitations checkpoint; the subsequent
probe worker changes only the existing full-label test under L1–L6. Writes are serialized. Separate nonauthor Standards
and Spec reviewers inspect the same frozen final diff; primary reruns key checks and owns commit/PR/CI.
Record actual model, base/candidate, correction rounds and evidence here or in the PR; worker labels
are not provider spend measurements. Reviewers cannot launch runs.

Stop on scope/privacy violation, unexplained severe failure, unavailable required
evidence or inability to reproduce the claimed mechanism. Two failed controlled
rounds trigger hypothesis/ownership re-scope; at most two Stage 2 candidates
trigger decision, not an unlimited third trial. The primary re-scopes architecture
within the existing grant; ask the owner only for material retention/privacy or
permission changes outside the agreed contracts, or an increased spending cap.
Insufficient affordable scope requires a smaller prospectively reviewed design,
not silently dropping cases from an already frozen run.
Retain every failed observation; an unexplained green rerun does not erase it.

Keep the original cumulative US$400 ledger with US$30 protected; no reset, refund, new accounting
system or retry of closed runs. Later paid work needs a reviewed frozen scope/manifest and current
conservative affordability, including all possible calls/fallbacks and unknown reservations.
Historical balance is not dispatch authority; a thirty-case target does not establish sufficient funds.
This packet runs only offline diagnostics and grants no merge, release,
deployment, production/profile mutation or provider access. Historical semantic
causes, new controlled intervention selection, Stage 2–3 execution, final review
and delivery remain pending until separately recorded.
