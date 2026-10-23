# HR-2: budgeted assembly, offline protocol (v0.2, pre-audit)

Status: **v0.2, not yet frozen.** v0.1 was written 2026-10-23 by the U5b
coordinator after two mechanical findings on the frozen HR-1 fixture (§1). The
primary (charter owner) approved the six deviations in §2 on 2026-10-23 with
three conditions, now folded in: the external-validity statement (§3, §10),
"initial default" wording (§4), and an optional exploratory length-stress arm
(§6.1). Next: a non-author audit, then a freeze commit (v1) before any
test-split run.

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

   At 1,500 / 2,000 / 4,000 tokens every arm would emit the same context, so
   the experiment would be saturated and uninformative.
2. **Prefix and window arms are degenerate here.** Memory bodies are 20 UTF-16
   units at the median and 82 at most. `packRank`'s floor is 120 code points
   (`core/model-packing.mjs:7`), so P-prefix equals P-top, and a query-term
   window inside an 82-unit body is the body.
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
   never beat P-top. Keeping only the first span per item gave at most +1.8
   points at small budgets.

## 2. Deviations from the charter §6 plan (approved by the primary, 2026-10-23)

| ID | Charter §6 | Proposed | Reason |
| --- | --- | --- | --- |
| D1 | Budgets 1,500 / 2,000 / 4,000 | Confirmatory **256 / 512 / 768**; exploratory sweep 128–1,536 | §1.1: the approved budgets never bind on this fixture. 256 / 512 / 768 are about 25% / 50% / 75% of the full candidate volume. Product defaults (1,500 session context, 4,000 draft) stay as token numbers; HR-2 informs the **strategy**, not the number |
| D2 | Top 30 candidates | Each ranking's full frozen list (≤ 24) | HR-1 arms are capped at 24 (protocol §5.1); fused A3 returns 14–24 |
| D3 | Codex annotates character spans, another checks, mechanical substring check | Dropped; required region = whole body or whole named span | §1.3, verified 1,100 / 1,100 |
| D4 | P-prefix (120-unit prefix then widen) | Dropped, recorded as degenerate | §1.2 |
| D5 | P-window | Dropped, recorded as degenerate | §1.2 |
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

No model, no API, no money. Short representations are deterministic cuts of
stored text, so the coverage-first result is a lower bound for layered
representations that use generated summaries; that bound is what U5b can ship
without a model.

**External validity, stated before the run.** This fixture is a short-item
world: bodies of at most 82 units, exactly one fact per memory, and 40% of
required groups answerable only from a span. The answer therefore holds for
short, single-fact items whose evidence often sits in spans. It is not evidence
about long memories or long receipts, and the results document must not
generalize to them.

## 4. Decision rule (dev-free; everything below is preregistered)

- **Primary comparison**: P-cover versus P-top on the local nominated ranking
  (bge-m3 + A3), budget 512, test split, S1000, macro group coverage over
  C1–C7, family cluster bootstrap 95% CI (one preregistered comparison).

| Outcome | Condition |
| --- | --- |
| Coverage-first worth continuing | Δmacro(P-cover − P-top) ≥ +5 points and CI lower bound > 0 |
| Rank-first whole items become U5b's **initial** default, to be revisited once a long-item fixture exists | Δmacro ≤ 0 and CI upper bound < +5 |
| Inconclusive | Otherwise |

- **Secondary, exploratory (95% CIs, labelled)**: the same contrast on A1 and
  on openai-3-small + F-RRF10; budgets 256 and 768; P-top-s1 vs P-top;
  P-top+tail vs P-top; the full sweep.
- The probe in §1.4 is a dev-split design probe. It chose budgets and arms; it
  is not evidence for the rule above. No test-split file is read before the
  freeze commit.

## 5. Fixed inputs

- Fixture `hr1-fixture-v2`, hashes in
  `evaluation/retrieval-research/fixtures/FROZEN.md`. Nothing is changed.
- Rankings: the `with-foreign` test-final files for `A1`, `A3--bge-m3` and
  `F-RRF10--openai-3-small` at S1000 (HR-1 verified with/without-foreign
  rankings identical). The harness verifies their `fixtureHashes` field against
  FROZEN.md and refuses mismatches.
- Scored queries: test split, C1–C7 (94 queries, 29 families). C8 and FOREIGN
  are excluded; dev is never scored by the confirmatory report.
- Token counter: `countOpenAITokens` (`o200k_base`), the same counter the MCP
  host uses. `tiktoken@1.0.22` is added to
  `evaluation/retrieval-research/package.json` at the exact version used by
  `adapters/openai`.
- Runtime: Node 22.16.0, tests also on 24.15.0. Record CPU, RAM and OS.

## 6. Items, units and representations

- A candidate **item** is one memory of the ranking. It has one **body unit**
  (the memory content) and one **span unit per span**, in fixture order. In
  product terms the body is the Memory content and spans are its receipts
  (`fetchCandidateEvidence` returns content plus receipt refs; receipt text is
  read separately, so spans are the natural "deepen" layer).
- Unit cost is the counter's token count of the unit text plus a fixed
  **per-unit overhead** `O`. Confirmatory `O = 0`; sensitivity `O = 8`
  (identity, kind and time line). Both are reported.
- A unit is either wholly in the context or absent. No partial units.
- Arms (all deterministic, all consume the ranking in order, all skip a unit
  that does not fit and continue; the context is the set of admitted units):

| Arm | Pass 1 | Pass 2 |
| --- | --- | --- |
| P-top | body + all spans of item 1, then item 2, … | — |
| P-top-s1 | body + first span of each item in order | — |
| P-cover | body of every item in order | all spans, item order then span order |
| P-cover-s1 | body of every item in order | first span of each item in order |
| P-top+tail | whole items in order until the first item that does not fit wholly | bodies of the remaining items in order |

- A budget run admits units until the budget is exhausted; `used ≤ budget`
  always holds. Report used tokens per query.
- Not run, recorded as degenerate: **P-prefix** (a 120-unit prefix then
  widening equals P-top because no body exceeds 82 units) and **P-window** (a
  query-term window inside an 82-unit body is the body).

### 6.1 Optional exploratory arm: length stress (non-blocking)

Approved by the primary as optional. It is skipped, and recorded as skipped,
if it would delay the confirmatory run.

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
  Macro over C1–C7 equally, as HR-1.
- **All-required@B**: whether every required group is covered.
- **Assembly loss**: ceiling − coverage, where the ceiling is coverage with an
  unlimited budget (equal to the ranking's group recall over its list). This
  separates ranking misses from packing misses.
- **Token use**: used / budget, p50 and p95 per arm and budget.
- Strata: fidelity (body-covered vs span-only groups), language, category.

## 8. Statistics

Reuse `evaluation/retrieval-research/lib/stats.mjs`: cluster bootstrap over
test families, 10,000 resamples, fixed seed `hr2-bootstrap-v1`, whole-family
resampling with empty-category redraw; 95% equal-tailed percentile CI for the
primary (one comparison) and exploratory 95% CIs labelled as such. Exact
McNemar on all-required@B with one query per family, reported as underpowered.

## 9. Harness and procedure

1. Audit of this draft by a non-author Codex (read-only). The user's decision
   on §2 is recorded before the audit.
2. Freeze: v1 committed on `experiment/hr2-assembly` before any test run.
3. One Codex worker builds `evaluation/retrieval-research/assembly/` (run,
   score, report; tests against a toy fixture under the owned runner
   `node tools/testing/run.mjs`), on Node 22.16 and 24.15. It reads only
   `fixtures/`, `results/test-final/rankings.tar.xz` and `lib/`. It never
   edits fixtures, HR-1 code or results.
4. Two non-author reviews (Spec, Standards) on a clean detached worktree of the
   exact commit; then the coordinator's acceptance outside the sandbox on both
   Node versions, with actual exit codes.
5. One confirmatory run on the test split; results committed under
   `evaluation/retrieval-research/results/hr2-final/` with a results document
   `docs/plans/budgeted-assembly-hr2-results.md` and an entry in
   `docs/limitations.md` on this branch. After the test run nothing in §§4–7
   changes; a defect produces a new protocol version reported alongside.
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
