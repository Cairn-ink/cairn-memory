# HR-2: budgeted assembly, offline protocol (v1.2.1: v1.1 frozen + §11 exploratory extension)

Status: **v1, frozen before any HR-2 test-coverage run.** v0.1 was written
2026-10-23 by the U5b coordinator after two mechanical findings on the frozen
HR-1 fixture (§1). The primary (charter owner) approved the six deviations in
§2 on 2026-10-23 with three conditions, folded into v0.2: the
external-validity statement (§3, §10), "initial default" wording (§4), and an
optional length-stress arm (§6.1). v0.2 was audited by an independent,
non-author, read-only Codex (`hr2_protocol_audit`, gpt-6.1-sol/xhigh), which
found three P0, seven P1 and one P2; v1 applies all of them. The auditor
reproduced every mechanical claim in §1 and the dev probe output exactly, and
confirmed v1 (`2d7b7fe6`); v1.1 applies its four remaining editorial and
factual corrections without changing any rule.
v1.2 (2026-10-24, after the test run and after U5b-2 packet A shipped) adds **§11 only**: an
exploratory extension that re-runs the §6 grid under the measured host representation
overhead. Nothing in §§1–10 changes; the §4 confirmatory decision is not re-opened. The
§11 draft (`2f69c7a5`) was audited by an independent, non-author, read-only Codex
(`hr2_ext_audit`, gpt-6.1-sol/xhigh): no P0, four P1, two P2; v1.2.1 applies all six.

**Pre-freeze inspection declaration.** This protocol is dev-informed and
preregistered before any HR-2 test-coverage scoring. Pre-freeze inspection
included the published HR-1 results, test candidate token volumes (§1.1) and
test-label structural and fidelity counts (§1.3, §1.4). Assembly coverage was
probed only on dev rankings. No HR-2 test coverage was computed.

Branch `experiment/hr2-assembly`, cut from `experiment/hybrid-retrieval-hr1` at
`43a8347`. No public core API, schema, default, adapter or installed artifact
changes. The goals and boundaries are in the
[research charter](memory-next-stage-charter.md); the engineering consumer is
U5b (contract §15, to be written from this evidence).

## 1. Findings that re-scope the plan

Measured on 2026-10-23 with the product token counter (`tiktoken`
`o200k_base`, `adapters/openai/index.mjs:13`) over the frozen fixture
`hr1-fixture-v2` and the frozen test rankings in
`evaluation/retrieval-research/results/test-final/rankings.tar.xz`. Scripts and
raw output: `evaluation/retrieval-research/results/hr2-design-probe/`.

1. **The approved budgets do not bind.** The whole candidate list (at most 24
   items; HR-1 arms never return 30) with body and every span fits in at most
   1,128 tokens on every test query, under every ranking considered:

   | Ranking (test, S1000, C1–C7, n = 94) | top-24 body only p50 / max | top-24 body + spans p50 / max |
   | --- | ---: | ---: |
   | A1 (BM25-T1) | 391 / 451 | 993 / 1,128 |
   | bge-m3 + A3 (local nominated; depth 12 fusion returns 14–24 items) | 309 / 412 | 789 / 1,020 |
   | openai-3-small + F-RRF10 (hosted nominated) | 394 / 451 | 997 / 1,112 |

   At 1,500 / 2,000 / 4,000 tokens every full-unit arm saturates (the s1
   variants still omit later spans even at unlimited budget), so the
   experiment would be uninformative.
2. **Prefix and window arms are inert here.** Memory bodies are 20 UTF-16
   units at the median and 82 at most. `packRank`'s body floor is 120 code
   points (`core/model-packing.mjs:7`), so P-prefix's body-shortening stage
   changes nothing; the current `packRank` as a whole (it also caps receipt
   lists and measures complete requests, `core/model-packing.mjs:114`) is
   **not** benchmarked. P-window is omitted because a short-body fixture does
   not meaningfully test the intended window treatment.
3. **No character-span annotation is needed.** Each of the 1,100 memories
   expresses exactly one fact (`expresses.length === 1` for 1,100 / 1,100), and
   every span-only fact sits in the memory's first span (112 / 112). The
   fixture README states the convention: a body marked `S` omits the
   answer-bearing detail, and the complete fact exists only in its first span.
   So the required region is the **whole body** (`where: body`) or the **whole
   named span** (`where: span`), derivable mechanically from `hr1-labels.json`.
4. **Dev-split design probe (not a result).** At budgets that do bind,
   coverage-first (all bodies, then spans) is below rank-first whole items on
   all three rankings and at every budget, and converges only once the budget
   holds everything. Macro group coverage, dev split, n = 46:

   | Budget | A1: P-top / P-cover | bge-m3+A3: P-top / P-cover | 3-small+F-RRF10: P-top / P-cover |
   | ---: | --- | --- | --- |
   | 256 | 0.718 / 0.523 | 0.936 / 0.677 | 0.938 / 0.598 |
   | 512 | 0.845 / 0.754 | 0.954 / 0.945 | 0.973 / 0.955 |
   | 768 | 0.898 / 0.871 | 0.954 / 0.954 | 1.000 / 0.973 |
   | ceiling (all candidates) | 0.898 | 0.954 | 1.000 |

   Mechanism: 54 of the 134 required test groups (40%) are span-only by
   fixture design, and the body of a span-only memory is a pointer without the
   answer. Bodies-first therefore spends budget on text that cannot satisfy
   those groups, while the rankers already put the evidence near the top.
   "Depth then breadth" (whole items in rank order, then bodies of the rest)
   occasionally improved dev coverage (A1 at 256: 0.736 vs 0.718).
   First-span-only rank-first improved by at most 1.8 points; first-span-only
   body-first improved body-first by 5.3 points on A1 at 512. The probe was
   re-run after the audit with the §6 rule that a span is scheduled only after
   its body was admitted; reported coverage values were unchanged, while 15
   token-use medians changed. The table above shows the re-run.

## 2. Deviations from the charter §6 plan (approved by the primary, 2026-10-23)

| ID | Charter §6 | Proposed | Reason |
| --- | --- | --- | --- |
| D1 | Budgets 1,500 / 2,000 / 4,000 | Confirmatory **256 / 512 / 768**; exploratory sweep 128–1,536 | §1.1: the approved budgets never bind on this fixture. 256 / 512 / 768 are about 25% / 50% / 75% of the full candidate volume. Product defaults (1,500 session context, 4,000 draft) stay as token numbers; HR-2 informs the **strategy**, not the number |
| D2 | Top 30 candidates | Each ranking's full frozen list (≤ 24) | HR-1 arms are capped at 24 (protocol §5.1); fused A3 returns 14–24 |
| D3 | Codex annotates character spans, another checks, mechanical substring check | Dropped; required region = whole body or whole named span | §1.3, verified 1,100 / 1,100 |
| D4 | P-prefix (120-unit prefix then widen) | Dropped, recorded as inert on this fixture | §1.2 |
| D5 | P-window | Dropped, recorded as untestable on this fixture | §1.2 |
| D6 | (none) | Add P-top-s1 and P-cover-s1 (deepen with the earliest span only) and P-top+tail (depth then breadth) | Product-relevant variants that the probe can distinguish; cheap |

The alternative, a new fixture with realistic memory and receipt lengths, was
declined for the first answer: it abandons the frozen HR-1 rankings (lexical
reruns are free; bge-m3 needs 2.2 GB RSS; hosted costs money) and is a larger
packet. It stays the follow-up that §10 asks for.

## 3. Question

> On the frozen HR-1 fixture, with a frozen candidate ranking and a fixed token
> budget that holds only part of the candidates, which deterministic assembly
> places the most required evidence wholly in the context: rank-first whole
> items, coverage-first (every body, then spans), or depth-then-breadth? Does
> deepening with the earliest span only help?

No model, no API, no money. This tests bodies-first receipt deepening with
deterministic whole units on this fixture; it provides **no** performance bound
for generated summaries. The deterministic policy is what U5b can ship without
a model.

**External validity, stated before the run.** This fixture is a short-item
world: bodies of at most 82 units, exactly one fact per memory, and 40% of
required groups answerable only from a span. The answer therefore holds for
short, single-fact items whose evidence often sits in spans. It is not evidence
about long memories or long receipts, and the results document must not
generalize to them.

## 4. Decision rule (dev-informed; preregistered before test coverage)

- **Primary comparison**: P-cover versus P-top on the local nominated ranking
  (bge-m3 + A3), budget 512, overhead `O = 0`, test split, S1000, macro group
  coverage over C1–C7, family cluster bootstrap 95% CI (one preregistered
  comparison). The local ranking is the primary because it is the stronger
  frozen ranking; the hosted product default is an exploratory replicate (§4
  secondary). 512 is the preregistered intermediate budget, where dev P-top
  already reached its ranking ceiling (the dev gap there is about 0.9 points,
  against about 31 points at 128), so the test can only show whether
  coverage-first loses, ties or gains at a budget where the top of the ranking
  already fits.

| Outcome | Condition |
| --- | --- |
| Coverage-first worth continuing | Δmacro(P-cover − P-top) ≥ +5 points and CI lower bound > 0 |
| Rank-first whole units stay U5b's **initial** default, to be revisited once a long-item fixture exists | Δmacro ≤ 0 and CI upper bound < +5 |
| Inconclusive | Otherwise, and whenever the bootstrap reports too few families or invalid inputs |

The +5-point threshold is a practical criterion without a claimed power
guarantee; 29 families establish neither adequate power nor equivalence. The
initial-policy outcome means only that no material coverage-first gain was
established for this ranking and evidence shape. Hosted applicability,
realistic lengths and production reliability need separate evidence.

- **Secondary, exploratory (95% CIs, labelled)**: the same contrast on A1 and
  on openai-3-small + F-RRF10; budgets 256 and 768; P-top-s1 vs P-top;
  P-top+tail vs P-top; the full sweep.
- The probe in §1.4 is a dev-split design probe. It chose budgets and arms; it
  is not evidence for the rule above. See the pre-freeze inspection declaration
  at the top: test rankings were read for token volume and test labels for
  structural counts, never for coverage.

## 5. Fixed inputs

- Fixture `hr1-fixture-v2`, hashes in
  `evaluation/retrieval-research/fixtures/FROZEN.md`. Nothing is changed.
- Rankings: the `with-foreign` test-final files for `A1`, `A3--bge-m3` and
  `F-RRF10--openai-3-small` at S1000 (the auditor independently verified that
  all three with/without-foreign pairs have identical ranked lists).
- **Input authentication.** Before scoring, the harness recomputes all seven
  fixture hashes against FROZEN.md and requires equality with each ranking's
  `run.fixtureHashes`. A frozen HR-2 input manifest
  (`evaluation/retrieval-research/assembly/INPUTS.md`, written by the worker
  and checked by review) records the SHA-256 of `rankings.tar.xz`, the three
  exact member paths and their member hashes. The harness validates
  `run.split === 'test'`, scale S1000, arm/model/configuration, complete status,
  the expected scored query set, unique candidate IDs, target namespace,
  eligibility under the query's intent and horizon ≤ 24. Any mismatch exits
  nonzero.
- Scored queries: test split, C1–C7 (94 queries, 29 families). C8 and FOREIGN
  are excluded; dev is never scored by the confirmatory report.
- Token counter: a research-local counter reproducing
  `get_encoding('o200k_base').encode(text, [], []).length`, the same encoding
  the MCP host uses (`adapters/openai/index.mjs:13`). `tiktoken: "1.0.22"` is
  pinned in both `evaluation/retrieval-research/package.json` and its lockfile;
  the harness never imports from `adapters/`.
- Runtime: Node 22.16.0, tests also on 24.15.0. Record CPU, RAM and OS.

## 6. Items, units and representations

- A candidate **item** is one memory of the ranking. It has one **body unit**
  (the memory content) and one **span unit per span**, in fixture order. In
  product terms the body is the Memory content and spans are its receipts
  (`fetchCandidateEvidence` returns content plus receipt refs; receipt text is
  read separately, so spans are the natural "deepen" layer).
- Unit cost is `tokens(unit text) + O`, charged once per admitted unit, where
  `O` is an abstract per-unit surcharge, not measured metadata serialization.
  Primary `O = 0` only; `O = 8` is a sensitivity run.
- A unit is either wholly in the context or absent. No partial units. Admit
  exact fits and continue through all scheduled units; never re-sort the
  frozen ranking.
- **Admission rule (whole-unit).** An arm visits units in its schedule and
  admits each unit independently when its cost fits the remaining budget;
  otherwise it skips that unit and continues. A span unit is scheduled only if
  its item's body unit was admitted (sources never appear detached from their
  memory; this is also contract §15's invariant). "First span" means
  `spans[0]`; a zero-span item contributes only a body. Only P-top+tail tests
  whole-item bundles atomically.
- Arms (all deterministic, all consume the ranking in order; the context is the
  set of admitted units):

| Arm | Pass 1 | Pass 2 |
| --- | --- | --- |
| P-top | for each item in rank order: its body, then its spans in order (rank-first whole-unit) | — |
| P-top-s1 | the same with only `spans[0]` | — |
| P-cover | body of every item in order | all spans, item order then span order |
| P-cover-s1 | body of every item in order | `spans[0]` of each item in order |
| P-top+tail | whole-item bundles (body + all spans, atomically) in order until the first bundle that does not fit | body-only tail starting with that failed item, continuing in order |

- A budget run admits units until the schedule is exhausted; `used ≤ budget`
  always holds. Report per query the admitted unit IDs, their costs and the
  total.
- **Grid.** Five arms × three rankings × `O ∈ {0, 8}` × budgets
  `{128, 192, 256, 384, 512, 768, 1024, 1536}`, test split, S1000. Only the §4
  primary cell is confirmatory; every other contrast, including P-cover-s1, is
  exploratory.
- Not run: **P-prefix** (its body-shortening stage is inert because no body
  exceeds 82 units; the current `packRank` as a whole is not benchmarked) and
  **P-window** (a short-body fixture does not meaningfully test the intended
  window treatment). See §1.2.

### 6.1 Optional exploratory arm: length stress (skipped in v1)

Approved by the primary as optional and non-blocking. **It is skipped in v1**
because its recipe is not yet deterministic: seed, donor ordering, sentence
splitting, separators, the "about four times" target and donor exclusions are
undefined, and the foreign namespace contains near-duplicate facts, so the
padding's irrelevance is unverified. If it is run later, a separately frozen
exploratory recipe must specify those choices, create only derived HR-2
artifacts, preserve original prefixes and labels, and report its changed
retrieval ceilings. The sketch below is kept for that recipe and is not part
of the v1 run.

- **Padding.** Every body and span unit of the target namespace is extended by
  appending foreign-namespace text: sentences drawn from foreign memory bodies
  and spans by a seeded deterministic choice keyed on the unit id, until the
  unit reaches about four times its original token count. The original text
  stays intact as the unit's prefix. Required regions are unchanged in meaning,
  but a unit is still admitted whole, so required units become about four times
  as expensive.
- **Re-ranking.** Lexical only: BM25-T1 (`lib/bm25.mjs`, `lib/tokenize.mjs`)
  over the padded target corpus at S1000, same eligibility and intent rules as
  HR-1 A1, horizon 24. No model.
- **Budgets.** The product numbers 1,500 / 2,000 / 4,000 and the sweep.
- **Reporting.** Exploratory only, 95% CIs labelled; it never feeds the §4
  rule. It shows whether the §4 direction survives when items are long, with
  the caveat that the padding is irrelevant text, which flatters rank-first.

## 7. Metrics

- **Group coverage@B**: per query, the fraction of required groups with at
  least one member whose required region (§1.3) is wholly in the context.
  Macro over C1–C7 equally, as HR-1. Coverage is evidence-region admission;
  HR-1's recall is memory-ID reachability. The two names stay distinct.
- **All-required@B**: whether every required group is covered.
- **Assembly loss**: ceiling − coverage, where the ceiling is coverage with an
  unlimited budget (equal to the ranking's group recall over its list). This
  separates ranking misses from packing misses.
- **Token use**: used / budget, p50 and p95 per arm and budget.
- **Report** per arm, ranking, `O` and budget: per-query admitted unit IDs,
  costs, coverage, all-required, the common full-ranking ceiling and assembly
  loss; category means and deltas; token-use p50/p95.
- Strata: fidelity (body-covered vs span-only groups: divide by the stratum's
  groups and omit queries without that stratum, reporting represented
  categories and query/group counts), query language, category.

## 8. Statistics

Reuse `evaluation/retrieval-research/lib/stats.mjs` through an assembly-local
adapter: it maps coverage@B to the `recall12` field and all-required@B to
`allRequired12`, and supplies `id`, `family` and `category`
(`lib/stats.mjs:12`). Call `clusterBootstrap` with P-top as baseline, P-cover
as candidate, seed `hr2-bootstrap-v1`, 10,000 resamples, categories C1–C7,
`exploratory: true` and `minimumFamilies: 10`. The existing `exploratory` flag
selects the 95% endpoints (0.025 / 0.975, interpolated percentiles,
`lib/stats.mjs:26`); the HR-2 report separately labels the §4 contrast as the
confirmatory one. Report family counts, accepted and rejected resamples and
status; invalid or incomplete inputs make the decision inconclusive. Exact
McNemar on all-required@B selects the smallest scored test-query ID per family
and reports discordant counts; it is underpowered by design. §8 is frozen with
§§4–7.

## 9. Harness and procedure

1. Audit of this draft by a non-author Codex (read-only). The user's decision
   on §2 is recorded before the audit.
2. Freeze: v1 committed on `experiment/hr2-assembly` before any test run.
3. One Codex worker builds `evaluation/retrieval-research/assembly/` (run,
   score, report, `INPUTS.md`; tests against a toy fixture under the owned
   runner `node tools/testing/run.mjs`, run as explicit touched test files on
   Node 22.16.0 and 24.15.0 with `createTestWorkspace` for scratch). It may
   change `assembly/**`, the research package manifest and lockfile, and the
   designated HR-2 results and docs. It may read existing library modules and
   their transitive sources (including `tools/split.mjs`). HR-1 source,
   fixtures, rankings, tokenizer and selection stay unchanged. Assembly
   functions receive text, IDs, costs, the ranking, `B` and `O`; labels remain
   scorer-only.
4. Two non-author reviews (Spec, Standards) on a clean detached worktree of the
   exact commit; then the coordinator queues the CI-equivalent acceptance
   matrix through `cairn-heavy` on both Node versions, records actual exit
   codes, reports sandbox-only failures separately and retains failures.
5. One run of the §6 grid on the test split; results committed under
   `evaluation/retrieval-research/results/hr2-final/` with a results document
   `docs/plans/budgeted-assembly-hr2-results.md` and an entry in
   `docs/limitations.md` on this branch, whatever the outcome. After the test
   run nothing in §§4–8 changes; a defect produces a new protocol version
   reported alongside. Research artifacts are not shipped; any later shipped
   document follows the packaging manifest rule.
6. Heavy runs (the owned-runner suite on both Node versions, any measurement)
   go through the machine-wide queue `~/.local/bin/cairn-heavy`. The worker
   and reviewers run only the test files they touch, never broad suites, and
   receive the 11-item traps list with their prompt.

## 10. Limits and out of scope

- One synthetic fixture whose bodies are short and whose span-only share (40%)
  is a design choice. It is biased **against** body-first strategies, so a
  "coverage-first not supported" result means "not on evidence of this shape",
  and a follow-up with realistic memory and receipt lengths is needed before
  claiming it in general.
- Generated L0 summaries, role profiles, relations, MOC, reranking and answer
  correctness are out of scope.
- Direction only; no product reliability claim.

## 11. Exploratory extension (v1.2): the `host-v2` overhead model

Status: **v1.2.1, frozen.** Audited by `hr2_ext_audit` (no P0; four P1 and two P2
applied in `598d6c53`); the re-check confirmed it with no blocking items. The commit
that carries this status line is the §11 freeze commit (`run.extensionCommit`); no
host-v2 cell was constructed before it. Motivation: contract §15.8.1 measured that the shipped v1
representation cost about 250 tokens per item on top of a 15-token body, so
the `O = 0` curves of the results document do not describe the host. U5b-2
packet A (`representation-v2`, integration `b18dabe0`, `v1-preview.3`)
published its measured constants (contract §15.8.7 A13) in
`evaluation/retrieval-research/assembly/overhead-host-v2.json`; this section
replays the §6 grid under those constants. It is **exploratory only**: no
decision rule, no power claim, no change to §4, §7 or §8.

### 11.1 Inputs (fixed)

- Everything in §5, unchanged: fixture `hr1-fixture-v2`, the three frozen
  HR-1 test-final rankings, the `o200k_base` counter `tiktoken@1.0.22`, the
  frozen protocol commit for the §6 rules.
- The constants file `assembly/overhead-host-v2.json`, copied byte for byte
  from `b18dabe0` (sha256
  `5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b`), whose
  `implementationCommit` is `42627f60`. Fields used: `E = constants.envelope`
  (43), `h1 = constants.h1` (58), `hN = constants.hN` (57),
  `C = constants.concreteSource` (22), `A = constants.aliasSource` (10),
  `bodyTokens` (15, the probe body length that `C` was measured against). The
  file is authenticated by hash before every stage, like the rankings.

### 11.2 Cost model

A **cost model** replaces the scalar `O` of §6 for these cells. The admitted
set is still built by the §6 arms with whole-unit skip-and-continue over the
same schedules; only the cost of a unit changes, and it is defined so that
admission stays greedy and deterministic:

- `cost(empty context) = E`. A budget `B < E` is rejected with
  `context_item_too_large` before any cell is constructed (the product's
  empty-fit refusal); the §11.3 grid never reaches that case. Otherwise every
  query's assembly starts with `used = E`.
- A **body unit** costs `tokens(body) + h1` when no body has been admitted
  yet in this query's assembly, across all passes of the arm, otherwise
  `tokens(body) + hN`. "Admitted" means committed: a rejected trial changes
  no state, so the next body trial is still "first". P-top+tail evaluates each
  bundle tentatively under these rules and commits it atomically; its first
  bundle that does not fit starts the body-only tail at that item, and bundle
  admission never resumes.
- A **span unit** costs `(C − bodyTokens) + tokens(span)` when its text
  differs from its item's body (a concrete receipt), and `A` when its text
  equals its item's body byte for byte (a `sameAsBody` alias; the text is not
  charged twice). The fixture is expected to contain no body-equal spans; the
  scorer counts them and the results report the count.
- `used = E + Σ admitted unit costs ≤ B` always holds; P-top+tail's bundle
  cost is the sum of its units' costs under the same rules.

This fixed additive approximation follows contract §15.8.8. Its calibration
is the default-Memory probe of A13, whose body-only strings already contain
`rank` and `sourcesComplete:false`: do not charge those again. `C` and `A`
include the first-receipt completeness transition (the probe's single
receipt removes `sourcesComplete:false`); repeating that net delta for every
later receipt is approximate (the auditor measured a two-concrete-receipt
item at 164 tokens against the model's 160). Later completeness transitions,
backward `sameAs` deduplication across items, non-default metadata or
`sourceAccess`, Card items, and UUID/text tokenization variation are **not**
modelled faithfully. Every artifact labels these limitations.

### 11.3 Cells, identity and exclusion

- Grid: the five §6 arms × the three rankings × budgets
  `{128, 192, 256, 384, 512, 768, 1024, 1536}` × the single cost model
  `host-v2`; test split, S1000: **120 cells**.
- A host-v2 cell carries `run.overhead = 'host-v2'` (a string, never a
  number) and `run.overheadModel = {id:'host-v2', implementationCommit:
  '42627f60', sha256, constants, bodyTokens}`; file names contain
  `--Ohost-v2@42627f60--`. The cell also records the §11 freeze commit
  (`run.extensionCommit`) separately from the frozen base protocol commit
  (`run.protocolCommit`, unchanged).
- **Two validation branches, both strict.** The numeric `O ∈ {0, 8}` branch
  of `score.mjs` and `provenance.mjs` (frozen protocol identity, scalar cost
  check `cost = tokens + O`, replay) stays **unchanged**. A separate
  exact-string `host-v2` branch authenticates `overheadModel` against the
  pinned constants file (implementation commit, sha256, every constant and
  `bodyTokens`), rejects unknown model ids and inconsistent payloads, and
  replays each query's admissions, costs and total from the constants,
  refusing any difference. The report's comparison identity includes the
  authenticated model digest, so a host-v2 cell can be compared only with a
  host-v2 cell of the same digest; the confirmatory selector keeps its
  **numeric** `overhead === 0` and a mixed-model pair refuses
  `invalid_comparison_cells`. Tests cover malformed model identities, altered
  constants, scalar cost tampering in the legacy branch, and confirmatory
  exclusion.
- The §7 metrics and the §8 statistics apply unchanged within the host-v2
  model, all labelled exploratory.

### 11.4 Outputs

- Results document v1.1 (`docs/plans/budgeted-assembly-hr2-results.md`): a new
  section "host-v2 overhead" with the §2-style macro coverage table for the
  120 cells beside the `O = 0` rows; the **48 paired contrasts** P-cover −
  P-top and P-top-s1 − P-top for each ranking × budget, with §8's unchanged
  bootstrap settings, reported as pointwise, unadjusted, exploratory 95% CIs;
  the body-equal span count; **budget saturation** per ranking, defined as the
  smallest tested budget at which every query in every arm has zero assembly
  loss at that budget and at every larger tested budget, otherwise "not
  reached through 1,536"; and, separately, the count of queries with at least
  one budget-rejected scheduled unit per cell. Whole-unit skip-and-continue
  need not give monotone coverage, and reaching the evidence ceiling does not
  mean every candidate unit fits; the document says both. The §1 confirmatory
  outcome is restated unchanged; no host-v2 result changes the frozen
  decision.
- Artifacts under `evaluation/retrieval-research/results/hr2-host-v2/` with
  the same provenance discipline as `hr2-final/` (compressed cells, scores,
  report, `SHA256SUMS.uncompressed`, stage logs).
- `docs/limitations.md` HR-2 entry gains one sentence: "The host-v2 curves
  replay a fixed additive default-Memory calibration; they do not measure
  shipped-host token counts or establish behaviour for non-default metadata,
  Cards or general receipt serialization."

### 11.5 Procedure

Same as §9: non-author audit of this section → freeze (commit on
`experiment/hr2-assembly`) → one Codex worker adds `--overhead-model host-v2`
to `run.mjs`, the cost model to `arms.mjs`, the strict `host-v2` branch to
`score.mjs` and `provenance.mjs`, and the exclusion plus exploratory tables to
`report.mjs`, with tests on the toy fixture; the worker may change the owned
`assembly/**` helpers, provenance validation and `test/assembly-*.test.mjs`,
nothing else → two non-author reviews (Spec, Standards) on a clean detached
worktree of the exact commit, then the owned-runner acceptance on both Node
versions through `cairn-heavy` → the coordinator runs the 120 cells, scoring
and report through `cairn-heavy` from a clean checkout, then writes results
v1.1. **Legacy regression, asserted before the run:** every committed
`hr2-final/` artifact stays byte-identical (never overwritten); all 240
archived cells are re-scored with the new harness into a scratch directory,
and after removing only each scored cell's `run.implementation.scorer` the
scored JSON must be byte-identical to the archived scores (admissions, costs,
totals, metrics, summaries, strata); the regenerated legacy report's
statistics and confirmatory outcome must equal the archived report exactly,
while the current stage identities are recorded separately and never copied
from old outputs. **Provenance for `results/hr2-host-v2/`:** stage commands,
exit codes, retained failures, the authenticated model digest, uncompressed
hashes, and checkout cleanliness recorded before any output exists.
Non-claims as in §10, plus: the host-v2 numbers are not the shipped host's
token counts.
