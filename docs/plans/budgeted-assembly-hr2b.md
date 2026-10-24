# HR-2b: long-item budgeted assembly, offline protocol (v1.1 draft, amending frozen v1)

Status: **v1.1 draft, 2026-10-24: a pre-outcome amendment of frozen v1
(`c546bfc1`), pending its non-author audit; the v1.1 freeze commit will replace
this line.** v1.1 changes four things and nothing else: the receipt-count
distribution of §3.1 (1–4 receipts, because core `admit` accepts at most four
receipts per call and the fixture is seeded by one admission per memory), the
guard statistic of §4/§7 (pooled over the
`later-receipt` stratum instead of macro over categories), the §3.2
guard-stratum quotas (the per-category ≥10 test families clause is dropped,
dev keeps a family minimum only), and the §8/§9/§10 text these imply. The
thresholds (+3 / −5), the zero-ceiling gate, the Adopt / Keep / Inconclusive
semantics and the primary C1–C7 macro contrast are unchanged. The amendment's
provenance, including every number seen before it was written, is declared
below. The primary approved the amendment (pooled guard and the ≤4 cap; the
alternatives were not taken) before this draft was written. v1 was frozen
2026-10-24 before any fixture tool, fixture, ranking or cell existed. v0.3
(`58425923`) was confirmed by the auditor's second re-check ("can be frozen:
yes, no blocking items"); v1 changes only this status line. Written by the
U5b coordinator at the primary's request (charter
§6 "next step: a long-item fixture"). v0.1 (`9b3095cb`) was audited by an
independent, non-author, read-only Codex (`hr2b_protocol_audit`,
gpt-6.1-sol/xhigh): four P0, six P1, one P2; v0.2 (`b4c31dd3`) applied all
eleven; the re-check found three residual P1 (placement wording in §7,
two-stage generator acceptance, dev-check ordering in §9) and an arithmetic
P2, applied in v0.3. Branch
`experiment/hr2-assembly` (it holds the HR-1 ranking harness, the HR-2 assembly
harness and the host-v2 model). No public core API, schema, default, adapter or
installed artifact changes; the engineering consumer is a possible contract §15
default change, which this protocol does not make.

**Pre-freeze inspection declaration (v1, historical).** This protocol is written after HR-2
v1.1 and before any HR-2b fixture exists. No HR-2b query, label, ranking or
assembly result was inspected; the only inputs are the frozen HR-2 results, the
HR-1 fixture generator and schema, and the shipped `representation-v2`
constants. Dev-split inspection, if any, is recorded in §9 before the test run.

**v1.1 amendment provenance (2026-10-24).** The amendment was written **after**
the W1 world, the W2 queries, the W3 audit and the validator output of the
first candidate fixture (seed `1924440465`, candidate 0) had been seen, and
**before** any ranking, host-v2 calibration or assembly of any HR-2b split: no
HR-2b ranking file, calibration file, dev or test cell exists at this commit.
Exactly these numbers were seen. W1: 90 families (40 target / 40 distractor /
10 foreign), 1,020 facts, 540 memories; target receipt-count histogram
32/40/40/24/16/8 for 1–6 receipts; distinct-fact placement 126/70/84
(45/25/30); 0 forbidden-lexicon hits over 18,297 scanned terms. W2: 160 queries
(140 scored, 10 C8, 10 foreign controls); seeded split `hr2b-split-v1` with 46
dev / 94 test scored queries; 123 of 140 scored queries need a span-only fact.
Pre-audit validator (`hr2b-validate1`): 35 errors, of which 1 `audit:overrides`
(no audit file yet), 18 mechanical category-check failures (C1×6, C2×1, C3×7,
C5×4) and 16 placement-quota failures; the stratum counts were dev
first-receipt 23 groups / 10 families, dev later-receipt 21 groups / 8
families, test first-receipt 43 groups / 23 families, test later-receipt 57
groups / 20 families, and the **pre-audit** later-receipt test families per
category C1–C7 were 6/7/11/8/7/8/3 (dev: 3/1/2/3/2/5/2). W3: 19 overrides
(18 recategorize, 1 add-member), 0 semantic leaks over 1,049 non-supporting
units and 7,113 terms, 78 later-receipt groups confirmed free of body or
first-receipt support; W3's census after overrides: 190 scored groups, 265
member rows, scored-group placement 46 body / 66 first-receipt / 78
later-receipt, and the **post-audit** later-receipt strata: test 57 groups /
20 families with families per category C1–C7 **4/7/8/10/6/8/6** and groups
per category **4/7/9/10/8/13/6**; dev 21 groups / 8 families with families
2/1/0/4/2/5/4 and groups 2/1/0/4/3/7/4 (recomputed by the coordinator from
the labels and the audit file). Post-audit validator (`hr2b-validate2`): 81
memories with 5–6 receipts (24 target, 48 distractor, 9 foreign) rejected by
the public-admission preflight with `invalid_input` (reproduced in isolation:
the same memory is admitted with 1–4 receipts and refused with 5). The full
inspected reports are committed: `fixtures-hr2b/W1-REPORT.md` (`e3fd8dba`,
including the length means, about 217 body and 93 receipt tokens for targets),
`fixtures-hr2b/label-audit-report.md` and `hr1-label-audit.json`
(`c73e2e56`), and both validator outputs under
`fixtures-hr2b/build/candidate0-v1-validation/`. The two defects are
pre-outcome and fixture-informed: the first candidate failed the v1
per-category guard quota (meeting it would have needed about 70
category-family incidences in the later-receipt test stratum, where the
candidate had 50 pre-audit and 49 post-audit; families may recur across
categories, so this is not 70 independent families, but it is far above what
the 45/25/30 design produces with 20 queries per category), and the receipt
cap is a seeding limit of the validator's single-admission procedure against
core `admit`, not a property of this world. No coverage, Δ, ranking or ceiling
of any arm was computed or seen. The rebuilt fixture keeps the same families, facts
and placement allocation (W2's queries stay valid) and changes only the receipt
counts under the cap: the frozen candidate sequence restarts at candidate 0
under the amended rule (§9), and its validator output is recorded in §9.

## 1. Question and what HR-2 could not answer

HR-2 (protocol v1.1 + §11) established, on short single-fact items with 1–3
receipts, that rank-first whole units beat coverage-first, and that
**first-receipt-only deepening** (`rank-first-first-source-v1`, HR-2 arm
P-top-s1) was never worse than whole-unit deepening and gained 0.3–4 points at
tight budgets. That evidence is biased **for** P-top-s1: with at most three
short receipts the second and third receipt rarely carry evidence the first
does not, so skipping them costs nothing. Results §4 and §7.4 therefore left
the default question open:

> On items of realistic length, where a Memory has a multi-sentence body and
> several receipts of chat length, and where required evidence sometimes sits
> only in a later receipt, does `rank-first-first-source-v1` deliver more
> required evidence than `rank-first-whole-v1` within product budgets under
> the shipped `host-v2` representation overhead, and does it lose on the
> queries whose evidence is in a later receipt?

The answer decides, as preregistered in §4, whether the primary may make
`rank-first-first-source-v1` the default of contract §15 (a contract revision
with its own audit; this protocol only produces the evidence).

## 2. Boundaries

- Offline and synthetic only (charter §3): no real user data, no paid API, no
  key. Rankings come from the two **free** HR-1 arms: A1 (BM25, no model) and
  bge-m3 + A3 (the local `Xenova/bge-m3` weights already cached under
  `~/.cache/cairn-hr1-models`; `lib/embed-local.mjs`). The hosted
  openai-3-small arm is **not run** (paid).
- Research branch only. Research artifacts are not shipped.
- The HR-1 fixture, rankings, results and the HR-2 results stay frozen and
  byte-identical; HR-2b adds a new fixture directory and new result
  directories.
- Deterministic whole-unit representations only (contract §15.3): no
  summaries, prefixes or windows; a unit is admitted whole or not at all.
- Direction only; small samples; failures retained; no product reliability
  claim.

## 3. Fixture `hr2b-fixture-v1` (`evaluation/retrieval-research/fixtures-hr2b/`)

The fixture reuses the HR-1 **field schema**
(`hybrid-retrieval-hr1-fixture-schema.md`): memories' `spans` are the receipts;
`expresses[].where ∈ {body, span}` with `span` naming the receipt, and
`span: null` allowed for a body-only expression. It differs from
`hr1-fixture-v2` in **shape** and therefore needs an explicit **HR-2b
validation profile** in the HR-1 tools (§8): the HR-1 validator hard-codes the
300/700/100 counts, 1–3 spans per memory and the 35–45% span-only share, and
the fixture version is a single constant propagated into the facts view,
labels and audit. The profile (version `hr2b-fixture-v1`, directory
`fixtures-hr2b/`) carries the counts, receipt range and placement bands below;
HR-1 behaviour is preserved for `hr1-fixture-v2`.

### 3.1 World

- **Setting and families.** A new synthetic world in the same invented
  Taiwan-based founder setting, same six domains and language mix (about 55%
  zh-TW, 30% en, 15% mixed). **At least 40 target families**, each a thread of
  **seven rendered canonical facts plus one absent fact**, with the HR-1
  lifecycle (a changed decision with its reason, a bounded amount, two
  assignments with a near-miss attribute, a rejected or proposed option, the
  absent fact for C8). Lifecycle eligibility, the C5/C6 separation and the
  decision/reason separation follow HR-1 §4.2–4.3. Facts and families are new
  text, not copies of HR-1's, so that neither world leaks into the other.
- **Long items.** A target **memory** is an assistant-style extracted note of
  **2–4 facts of its family** whose body length is drawn from a frozen
  distribution over `o200k` tokens (target mean about 220, bands 120–180:
  30%, 180–260: 40%, 260–400: 30%), 3–8 whole sentences in one or two
  paragraphs, with **1–4 receipts** whose lengths are drawn from a frozen
  distribution (mean about 90 tokens, bands 40–70: 35%, 70–130: 40%, 130–200:
  25%), each a chat turn with the natural wording a person types. Receipt
  counts are drawn from the frozen distribution `{1: 20%, 2: 25%, 3: 25%,
  4: 30%}` per target memory (**v1.1**; v1 had `{1: 20%, 2: 25%, 3: 25%,
  4: 15%, 5: 10%, 6: 5%}`). **The cap of four comes from the product's
  admission call**: core `admit` accepts at most four receipts per call, and
  the validator seeds each fixture memory with exactly one admission, so a
  memory with five or six receipts cannot be seeded by this procedure and
  fails the public-admission preflight. The product can accumulate more than
  four receipts on one memory over repeated admissions (the runtime attaches
  new receipts to the existing memory); such accumulated memories are outside
  this fixture's scope, and the long-item claim of this protocol is limited to
  memories with **at most four receipts** (§10).
- **Deterministic generation, frozen before rendering.** The builder is a
  seeded program (`fixtures-hr2b/build/`, one named PRNG, one seed constant,
  ordered sentence banks, length-target distributions, the joint
  receipt-count/placement allocation, whole-sentence assembly). Receipts are
  ordered by `eventTime` then id before ordinal ids `#s1…#s4` are assigned, and
  the validator checks array order. Acceptance has **two stages over a frozen
  candidate-seed sequence** (written into the builder before generation): W1's
  `check-world.mjs` reads facts and corpus only and applies the §3.1
  structural checks (counts, lengths, receipt counts, fact-level placement
  shares, lexicon scan); the coordinator's quota validator reads the queries
  and the post-W3 labels and applies the §3.2 group and category quotas. The
  first candidate seed that passes **both** stages is used; the diagnostics of
  every rejected candidate are retained in the build record. Neither stage
  reads rankings or assembly output.
- **Evidence placement** is the designed variable. It is defined over
  **distinct rendered target facts**: each such fact is assigned one placement
  by the seeded allocation with frozen shares **body 45%**, **first receipt
  only 25%**, **later receipt only (receipt 2–4) 30%**, and every target memory
  that expresses the fact renders it consistently with that placement (a
  "later" fact is rendered only in memories with at least two receipts).
  "Only" means the body and the other receipts of that memory refer to the
  topic without stating the fact (the HR-1 `S` row discipline, extended to
  receipts). The builder's allocation is a **generation aid**; the stratum that
  the statistics use is derived from the audited labels (§3.2), and the two are
  reported side by side. The validator reports the realized fact-level shares;
  a deviation above 5 points from any share is a build defect.
- **Filler is authored, fact-free and in-domain.** Long bodies and receipts are
  composed from authored sentence banks per domain and per role (assistant
  note sentences; user chat sentences), disclosed as filler in the build
  sources with their sentence ids and the ranges they occupy in each unit.
  Fact-freeness is established in two layers: (1) **mechanically**, against a
  frozen per-fact forbidden lexicon (normalized entities, their aliases and
  translations, numeric and date forms, distinctive terms) that W1 writes with
  the facts and the validator scans every filler sentence against; (2)
  **semantically**, by W3, who audits filler and every non-supporting unit for
  unannotated entailment of any fact, including proposed and rejected claims,
  and records overrides. The two layers are reported separately. This
  replaces the rejected §6.1 foreign-text padding of HR-2, whose irrelevance
  was unverified.
- **Distractors and scale.** About **160 target memories** (40 families × 4
  episodes) + about **320 distractor memories** rendered from 40 distractor
  families with the **same** length, receipt-count and placement
  distributions (validator: means within 15%, receipt-count histogram within 5
  points per bin) + about **60 foreign** memories including near-duplicates of
  target facts. In the schema's `scale` field, target memories are `S300`,
  distractors `S1000-extra` (both namespace `target`) and foreign memories
  `foreign`, so that the HR-1 harness's `S1000` scale selects targets plus
  distractors; **"S-long" is only this document's name for that S1000 run**.
  Template rendering is allowed for at most half of the distractors and must
  be disclosed, as in HR-1.
- **Required regions.** Every `expresses` entry names the exact unit (body or
  receipt id) that states the fact; the unit text is the required region
  (whole-unit admission, as HR-2 §6). No character offsets are needed because
  units are admitted whole.

### 3.2 Queries and labels

- 20 scored queries per category C1–C7 (140) plus 10 C8 and about 10 foreign
  controls, authored by **W2** from the text-free facts view, with the HR-1
  category checks, split quotas (about 6 dev / 14 test per category, dev
  30% ± 3%, ≥10 test families per category) and seeded family split.
- The join tool derives evidence groups per query with `where: body|span` and
  the receipt id, as HR-1 (a body expression with `span: null` contributes
  body support only; HR-1's `makeMember` behaviour of counting a body
  expression's named span as span support is not used for HR-2b). The
  **placement stratum** of a group is classified **after W3's overrides, from
  the audited eligible members only**: `body` if any eligible member supports
  the fact in its body; otherwise `first-receipt` if any eligible member
  supports it in its first receipt; otherwise `later-receipt` (no body or
  first-receipt support anywhere among eligible members). Placement records
  and receipt positions are evaluator-only: W2 never sees them or any rendered
  text.
- **Guard-stratum quotas (structural, checked before the fixture is
  accepted; v1.1).** In the **test** split, the `later-receipt` and
  `first-receipt` strata each have **at least 30 required groups and 12
  families**; in the **dev** split each has **at least 4 families** and no
  group minimum. The guard bootstrap of §4 is pooled over the whole
  `later-receipt` stratum, so its `minimumFamilies: 10` applies to the
  stratum's family count, not per category; v1's clause requiring ≥10 test
  families in every represented category is dropped (the first candidate
  failed it, and meeting it would need about 70 category-family incidences in
  the later-receipt test stratum against the 50 a 45/25/30 world with 20
  queries per category produced; see the provenance declaration). The set of categories represented in the guard
  stratum is still frozen with the labels, is never trimmed afterwards, and is
  used only for the descriptive per-category report of §4. A fixture that
  cannot meet these quotas is rebuilt with another seed (or more authored
  families) before freeze; W1 is told the quotas up front.
- **W3** audits labels as HR-1 §4.1 step 5 and the semantic filler audit of
  §3.1; overrides are applied before the freeze.

### 3.3 Author independence and freeze

W1 (world + builder + filler banks + `check-world`), W2 (queries from the facts
view only), W3 (label audit) are three different Codex workers, none of whom
sees retrieval or assembly code or output. The coordinator runs the tools,
commits, and freezes the fixture by SHA-256 in `fixtures-hr2b/FROZEN.md`
before any ranking is computed. After the freeze nothing in the fixture
changes; a defect creates `hr2b-fixture-v2`, reported alongside.

## 4. Decision rule (preregistered; frozen before any test-split cell)

- **Primary comparison**: `P-top-s1` (= `rank-first-first-source-v1`) versus
  `P-top` (= `rank-first-whole-v1`), ranking **bge-m3 + A3** (local, the
  stronger free ranking), **budget 1,500** (the product default
  `defaultMaxTokens`), cost model **`host-v2`** (protocol HR-2 §11.2, the
  pinned constants), test split, `S-long` with the foreign namespace present,
  macro group coverage over C1–C7, family cluster bootstrap 95% CI (10,000
  resamples, seed `hr2b-bootstrap-v1`, `minimumFamilies: 10`). One
  preregistered comparison.
- **Guard stratum (v1.1: pooled)**: the same contrast restricted to the
  `later-receipt` stratum (§3.2 classification: groups with no body or
  first-receipt support among eligible members), computed as **one pooled
  (micro) statistic**: the stratum's Δ is the number of covered later-receipt
  groups of P-top-s1 minus that of P-top, divided by the number of
  later-receipt groups in the split, in percentage points. **Bootstrap
  mechanics:** let the N families be those contributing at least one scored
  later-receipt group in the split; each draw samples N families uniformly
  with replacement from them and keeps every selected family's paired
  query rows (baseline and candidate, later-receipt groups only) with
  multiplicity; the numerator `Σ coveredGroups(candidate) − Σ
  coveredGroups(baseline)` and the denominator `Σ groupCount` are recomputed
  per draw; no category redraw or category weighting applies; 10,000 draws,
  seed `hr2b-bootstrap-v1`, the inherited interpolated 2.5 / 97.5
  percentiles; `ok` requires finite paired counts for every row, N ≥ 10
  (`minimumFamilies: 10` on the stratum's families) and 10,000 valid draws (a
  draw with a zero denominator is invalid; any invalid draw makes the
  bootstrap Inconclusive). The guard ceiling is pooled the same way (groups
  covered at the ranking ceiling / groups), and the descriptive per-category
  Δ uses the same group-occurrence denominator within the category. Weights
  therefore follow **later-receipt group occurrences**, not categories or
  families: **the pooled guard is dominated by the categories with more
  later-receipt groups** (in the first candidate fixture, post-audit test
  groups per category were 4/7/9/10/8/13/6, so C6 with 13 weighs more than
  three times C1 with 4; distinct families 20), **and it therefore no longer
  bounds the per-category loss**; it bounds the loss over the stratum as a
  whole. To make any concentration visible, the results report the
  later-receipt Δ **per represented category descriptively** (point value,
  groups and families, no CI and no decision), beside the pooled guard. v1
  defined the guard as a macro over the represented categories with the
  per-category family minimum; it was replaced because that minimum cannot be
  met by a 45/25/30 world with 20 queries per category. **What the guard
  means:**
  on strict later-only groups P-top-s1 can never admit the evidence, so its
  stratum coverage is zero by construction and the guard Δ equals minus
  P-top's stratum coverage. The guard therefore bounds the **incremental
  loss** first-receipt-only accepts on exactly the evidence it skips; it does
  not demonstrate that later evidence is preserved. The results report the
  stratum's absolute coverage per arm (pooled), its pooled ranking ceiling
  and its family and category counts beside the Δ, and a zero pooled ranking
  ceiling on the guard stratum makes the decision Inconclusive.

| Outcome | Condition |
| --- | --- |
| **Adopt**: `rank-first-first-source-v1` may become the §15 default under `host-v2` | Δmacro(P-top-s1 − P-top) ≥ **+3 points** with CI lower bound > 0, **and** the guard stratum's Δ has CI lower bound ≥ **−5 points**, and both bootstraps report `ok` |
| **Keep**: `rank-first-whole-v1` stays the default | Δmacro ≤ 0 with CI upper bound < +3, **or** the guard stratum's Δ has CI upper bound < −5, with both bootstraps `ok` |
| Inconclusive | Otherwise; whenever either bootstrap reports too few families or invalid inputs; whenever a §3.2 structural quota failed at freeze; whenever the guard stratum's ranking ceiling is zero |

The thresholds are practical criteria without a power claim; +3 macro points
is not a fixed number of groups (the macro weights categories equally). −5 on
the guard stratum is the incremental loss at which first-receipt-only would
be hiding a systematic miss behind an average gain. Small positive gains
below +3 are deliberately Inconclusive, not Keep. An **Adopt** outcome
authorizes the primary to open a §15 default-change revision, which needs its
own audit and an exact-host validation of the token accounting (§10); it is
not itself that change. A **Keep** outcome leaves
`rank-first-first-source-v1` available and non-default. HR-2's results are
disclosed motivation for this question; no HR-2b query, label, ranking or
assembly output existed when these thresholds were written.

- **Secondary, exploratory (95% CIs, labelled)**: the same contrasts on A1;
  budgets 1,000, 2,000 and 4,000; cost model `O = 0` for the same cells (to
  separate the overhead effect from the length effect); P-cover and
  P-top+tail against P-top (to confirm or refute HR-2's direction on long
  items); strata by placement (`body`, `first-receipt`, `later-receipt`),
  fidelity, language and category; token use and actual budget pressure.
- **Dev inspection.** No dev assembly or scoring happens before this rule is
  frozen (§9 step 1). After the freeze, the dev split may be assembled once to
  check that the pipeline runs end to end; its numbers are recorded in §9 and
  never change §§3–7.

## 5. Fixed inputs

- Fixture `hr2b-fixture-v1` (§3), frozen in `fixtures-hr2b/FROZEN.md`.
- **Rankings**: produced once per split by the HR-1 harness on the frozen
  fixture, with-foreign, CLI scale `S1000` (targets + distractors, §3.1),
  horizon 24, intents as HR-1 §5.1: A1 (`lib/bm25.mjs`, tokenizer T1) and
  bge-m3 + A3 (RRF k = 60, depth 12, equal weights; dense CLS, L2-normalized,
  `maxLength 8192`, truncations recorded). **Documents are memory bodies
  only**, exactly as HR-1's A1/A2/A3 index them (`includeForArm`); receipts are
  not indexed by the primary rankings. The assembler can still admit receipts
  of ranked memories, so a fact placed only in a receipt is reachable exactly
  when its memory's body ranks, which is the product's situation. Indexing
  receipts for ranking is a separately named exploratory treatment that this
  version does **not** run. The ranking run uses a **preregistered HR-2b fixed
  configuration** (arms, fusion parameters, horizon, scale, namespaces)
  recorded in `results/hr2b-rankings/configuration.json` before the run; the
  HR-1 `selection.json` and its fixture hashes are not reused and no
  dev-selection result is fabricated. Frozen under `results/hr2b-rankings/`
  with SHA-256 before any assembly cell exists; the assembly harness
  authenticates them as HR-2 §5.
- Counter `tiktoken@1.0.22`, `o200k_base`, the same as HR-2 and the host.
- Cost models: `host-v2` from `assembly/overhead-host-v2.json` (pinned, HR-2
  §11.1) and the scalar `O = 0`. **Calibration check before rankings:** the
  `host-v2` constants were measured on 15-token probes; the span charge
  `C − bodyTokens + tokens(receipt) = 7 + tokens(receipt)` is the specified
  model, not a long-receipt measurement (HR-2 §11.2 records 164 measured versus
  160 modelled for two concrete receipts). Before any ranking is computed, the
  coordinator serializes deterministic fact-free probes (bodies of 120/220/400
  tokens; receipts of 40/120/200 tokens; 1–4 receipts; `sourcesComplete`
  transitions) with the normative `representation-v2` serializer at
  `b18dabe0` and counts them with `o200k`, publishes the model-versus-measured
  errors in `results/hr2b-rankings/host-v2-calibration.json`, and does **not**
  retune the constants: the primary cell estimates the additive model's
  behaviour, and a product-default revision needs its own exact-host
  validation.
- Budgets: `{1000, 1500, 2000, 4000}`. Under `host-v2`, 24 items with the
  minimum body (120) and one minimum receipt (40) cost 43 + 58 + 23·57 +
  24·(120 + 7 + 40) = **5,420** tokens (3,840 at `O = 0`); with the assumed
  means (220-token bodies, 2.65 receipts of 90 tokens under v1.1; v1 assumed
  2.85 and about 13,300) about **12,900**. Every
  budget is therefore expected to bind on a full horizon, but short rankings
  or restricted schedules can saturate, so the results report the actual
  pressure (rejected-unit query counts, saturation as HR-2 §11.4) rather than
  assume it. 4,000 is the product's maximum; the product's `maxItems` default
  of 12 is not modelled because at 1,500 tokens at most about eight bodies
  fit.

## 6. Items, units, arms, admission

Exactly HR-2 §6 and §11.2: one body unit and one unit per receipt, in receipt
order; whole-unit skip-and-continue; a receipt is scheduled only after its
body was admitted; "first receipt" is `spans[0]` (the earliest by the
fixture's `eventTime`, then id); P-top+tail bundles atomic. Arms: `P-top`,
`P-top-s1`, `P-cover`, `P-cover-s1`, `P-top+tail`. Grid: 5 arms × 2 rankings ×
4 budgets × 2 cost models = **80 cells per split**; the test split is run
once. Only the §4 primary cell and its guard stratum are confirmatory.

## 7. Metrics and statistics

HR-2 §7 and §8 unchanged: group coverage@B over required regions (whole
units), all-required@B, ceiling and assembly loss, token use p50/p95, strata.
New stratum family: **placement** (`body`, `first-receipt`, `later-receipt`),
derived from the audited eligible label members after W3 by the §3.2 rule;
the builder's placement records are diagnostic only. Reported with group and
family counts per category. Bootstrap seed `hr2b-bootstrap-v1`; McNemar on
all-required with the smallest test query id per family. **Guard statistic
(v1.1)**: on the `later-receipt` stratum the confirmatory quantity is the
**pooled** group coverage, `Σ covered later-receipt groups / Σ later-receipt
groups` over the split's scored queries, and its Δ between arms; the cluster
bootstrap follows the §4 mechanics exactly (N contributing families sampled
uniformly with replacement, rows kept with multiplicity, numerator and
denominator recomputed per draw, 10,000 valid draws, N ≥ 10, interpolated
2.5 / 97.5 percentiles). The pooled guard ceiling and the per-category
later-receipt Δ use the same group-occurrence denominator; the per-category
table (point, groups, families) carries no interval and no decision. All other strata and the primary contrast
keep the macro (equal category weight) statistic of HR-2 §8.

## 8. Harness changes (reviewed like HR-2)

- **Fixture tools (`lib/fixture.mjs`, `tools/{facts-view,split,labels,
  validate,apply-audit}.mjs`)**: a **versioned validation profile** keyed by
  the fixture version (`hr1-fixture-v2` keeps its constants: 300/700/100,
  1–3 spans, 35–45% span-only; `hr2b-fixture-v1` carries 160/320/60, 1–4
  receipts, the §3.1 length and receipt-count distributions, the placement
  bands and the §3.2 quotas), the authenticated version propagated into the
  facts view, labels, audit application and validation output, `span: null`
  accepted for body-only expressions, receipt order validated, and the
  placement classification of §3.2 emitted in the labels. HR-1 outputs for the
  frozen HR-1 fixture must be byte-identical before and after (asserted by a
  test over the committed `fixtures/` files).
- **Ranking harness (`run.mjs`, `lib/*`)**: accepts the HR-2b fixture
  directory and version; scale `S1000` and namespaces unchanged; records the
  fixed configuration (§5) in the run metadata. Any other change it needs is a
  finding reported to the coordinator, not a silent edit.
- **Assembly harness (`assembly/*`)**: an **authenticated protocol profile**
  selected by fixture version, containing the protocol identity and freeze
  commit, the fixture manifest (file list and hashes), the ranking members,
  hashes and fixed configuration, the budget whitelist `{1000, 1500, 2000,
  4000}`, the bootstrap seed `hr2b-bootstrap-v1`, the strata (adding
  placement) and the §4 decision selector (primary cell plus guard stratum,
  with the Inconclusive gates). The HR-2 profile (`auth.mjs` identities, the
  seven HR-1 hashes, the HR-2 ranking paths and digests, budgets, seed
  `hr2-bootstrap-v1`, the numeric `O = 0` selector, the §11 saturation grid)
  stays a separate, untouched branch. Source identity extends to the changed
  ranking and fixture-tool modules, and the output-path guard protects
  `fixtures-hr2b/`, `results/hr2b-rankings/` and `results/hr2b-final/` once
  frozen.
- **v1.1 tooling amendment (one Codex worker, two non-author reviews, after
  the v1.1 freeze and before the fixture freeze)**: the `hr2b-fixture-v1`
  profile's receipt histogram becomes four bins `{.20, .25, .25, .30}` and its
  quotas become test `groups: 30, families: 12`, dev `families: 4` (no group
  minimum, no per-category guard minimum); the placement classification keeps
  emitting the frozen `guardCategories` list and the per-split per-category
  family counts; the report computes the §4 pooled guard Δ with a pooled
  cluster bootstrap (`minimumFamilies: 10` on the stratum's families) and the
  pooled absolute coverage and ceiling of the stratum, and adds the
  descriptive per-category later-receipt table; the protocol profile pins the
  v1.1 freeze commit. The primary contrast, the other strata, the HR-2 legacy
  and host-v2 regressions and every authentication rule are unchanged, and
  the toy-fixture tests cover the new branches and refusals. No outcome
  (coverage, Δ, interval or ceiling) is used to select or modify the rule;
  the tooling applies the frozen rule to the results it is given.
- **Regressions, both required**: the HR-2 legacy regression (240 archived
  cells byte-identical after stripping only the current scorer identity;
  regenerated report equal except the current report identity) and a new
  **host-v2 regression** of the same form over the 120 archived
  `results/hr2-host-v2/` cells. Tests on toy fixtures cover every new branch
  and every refusal.

## 9. Procedure

The order is strict: protocol freeze → tools → authoring → fixture freeze →
ranking configuration and rankings freeze → one test run.

1. Non-author audit of this draft (read-only Codex); v1 applies the P0/P1
   findings and is re-checked; the **protocol freeze** commit (§§3–7 fixed)
   precedes every later step. No dev or toy assembly is scored before it.
2. **Fixture tools and harness changes (§8)** by one Codex worker, including
   the versioned validation profile, the assembly protocol profile and both
   regressions; two non-author reviews (Spec, Standards) on a clean detached
   worktree of the exact commit; owned-runner tests on Node 22.16.0 and
   24.15.0 through `cairn-heavy`. Pipeline checks in this step use **toy
   fixtures or the legacy HR-1/HR-2 dev inputs only**; HR-2b dev assembly and
   scoring happen at most once, in step 4, after the fixture, configuration
   and ranking freezes.
3. **Authoring pipeline**: **W1** builds the world, the forbidden lexicon and
   the deterministic builder under `fixtures-hr2b/build/` with
   `check-world.mjs`; the coordinator runs the facts view; **W2** writes
   queries from the facts view only; the coordinator runs split, labels and
   the validator (structural quotas of §3.2 included); **W3** audits labels
   and filler; apply-audit; validator passes; **fixture freeze** commit with
   `fixtures-hr2b/FROZEN.md`. A quota failure sends the fixture back to W1
   with the diagnostics, never forward. **v1.1 path**: the first candidate
   (seed `1924440465`) was rejected at stage 2 for the two structural defects
   recorded in the provenance declaration; its diagnostics stay in the build
   record. Because the acceptance rule and the receipt distribution changed,
   the frozen candidate sequence **restarts at candidate 0 (seed
   `1924440465`)** under v1.1; the seed is not advanced on account of anything
   seen, since no ranking or assembly output exists. W1 re-renders candidate 0
   under the ≤4 receipt cap with the builder otherwise unchanged. The builder
   draws the fact-to-memory plan and the placement allocation **before** the
   receipt counts, so the facts, the fact coverage (`body` / `span-only` /
   `absent`) and the placement allocation are unchanged by construction; the
   coordinator verifies this mechanically (`hr1-facts.json` fact ids, texts,
   families, categories and coverage; the per-fact placement allocation and
   the fact-to-memory plan in `build/world-stats.json`; and the regenerated
   facts view, byte-identical to the W2 input) and, if any of these differ,
   advances to the next candidate seed and W2 re-authors from the new facts
   view. W3 re-audits the rebuilt corpus in full regardless. W2 then revises only the 18
   queries W3 recategorized and any coverage gap the validator names; labels
   are re-derived; W3 re-audits the rebuilt corpus and labels; apply-audit
   and the validator must pass before the fixture freeze.
4. **Rankings**: the coordinator records the fixed configuration (§5), runs
   the host-v2 calibration check, then runs A1 and bge-m3 + A3 on dev and test
   through `cairn-heavy` (bge-m3 is CPU-heavy: about 540 documents and 160
   queries, minutes, no spend), records the ledger and freezes
   `results/hr2b-rankings/` by SHA-256. The dev rankings may be assembled
   once to check the pipeline (§4, recorded here).
5. **One test-split assembly run** of the 80 cells, scoring and report through
   `cairn-heavy` from a clean checkout; artifacts under
   `results/hr2b-final/` with the HR-2 provenance discipline (stage commands,
   exit codes, hashes, compressed archives, logs force-added past the `.log`
   ignore rule, checkout cleanliness recorded before any output).
6. Results document `docs/plans/budgeted-assembly-hr2b-results.md`, a
   non-author transcription check, a `docs/limitations.md` entry, whatever the
   outcome; then the frozen protocol commit and the results commit go to the
   primary for charter §5/§6.
7. After the test run nothing in §§3–7 changes; a defect produces a new
   protocol version (or `hr2b-fixture-v2`) reported alongside, and failures
   are retained.

Heavy runs go through `~/.local/bin/cairn-heavy`; workers and reviewers run
only the test files they touch and receive the 11-item traps list.

## 10. Limits and out of scope

- One synthetic fixture whose lengths, receipt counts and placement shares are
  design choices. The placement shares (45/25/30) are the lever that makes the
  question answerable; a world where later receipts never carry unique
  evidence would make P-top-s1 trivially win, and one where they always do
  would make it trivially lose. The chosen shares are a stated assumption
  about realistic receipts, not a measurement of them.
- Authored filler is realistic-sounding but still synthetic; real chat has
  more repetition and more off-topic text, which flatters whole-unit
  deepening less than this fixture does.
- The `host-v2` cost model is the approximate additive calibration of HR-2
  §11.2, measured on 15-token probes and **extrapolated** here to 40–200-token
  receipts and 1–4 receipts; the §5 calibration check publishes the error but
  does not retune. The shipped host's exact token counts differ, and a product
  default change needs its own exact-host validation.
- The guard stratum measures the incremental loss first-receipt-only accepts
  on evidence it skips by construction (§4); it cannot show that later
  evidence is preserved.
- **Pooled guard (v1.1).** The guard is one pooled ratio over all
  later-receipt groups, so categories with more later-receipt group
  occurrences weigh more (in the first candidate fixture, post-audit test
  groups per category were 4/7/9/10/8/13/6);
  the guard **no longer bounds the per-category loss**, only the loss over the
  stratum as a whole. The per-category later-receipt Δ is reported
  descriptively so that a concentration of loss in one category is visible,
  but no per-category interval or decision is defined.
- **Receipts capped at four (v1.1).** The ≤4 cap is core `admit`'s
  per-call receipt limit under the validator's single-admission seeding, not
  a modelling choice; it is not a limit of the product's storage, which can
  accumulate more receipts on one memory over repeated admissions, and such
  accumulated memories are outside this fixture's scope. The long-item claim
  of this protocol, whatever the outcome, is limited to memories with **at
  most four receipts**; nothing here speaks to notes assembled from longer
  receipt chains.
- Rankings are the two free, body-only arms; receipts are not indexed for
  ranking and the hosted product ranking is not evaluated.
- Generated summaries, prefixes, windows, Cards, MOC, reranking and answer
  correctness are out of scope. Direction only.
