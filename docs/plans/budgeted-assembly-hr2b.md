# HR-2b: long-item budgeted assembly, offline protocol (v0.2 draft)

Status: **draft v0.2, 2026-10-24, awaiting the auditor's re-check; frozen
before any fixture tool is built, any fixture is authored or any cell is
scored.** Written by the U5b coordinator at the primary's request (charter §6
"next step: a long-item fixture"). v0.1 (`9b3095cb`) was audited by an
independent, non-author, read-only Codex (`hr2b_protocol_audit`,
gpt-6.1-sol/xhigh): four P0, six P1, one P2; v0.2 applies all eleven. Branch
`experiment/hr2-assembly` (it holds the HR-1 ranking harness, the HR-2 assembly
harness and the host-v2 model). No public core API, schema, default, adapter or
installed artifact changes; the engineering consumer is a possible contract §15
default change, which this protocol does not make.

**Pre-freeze inspection declaration.** This protocol is written after HR-2
v1.1 and before any HR-2b fixture exists. No HR-2b query, label, ranking or
assembly result was inspected; the only inputs are the frozen HR-2 results, the
HR-1 fixture generator and schema, and the shipped `representation-v2`
constants. Dev-split inspection, if any, is recorded in §9 before the test run.

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
  paragraphs, with **1–6 receipts** whose lengths are drawn from a frozen
  distribution (mean about 90 tokens, bands 40–70: 35%, 70–130: 40%, 130–200:
  25%), each a chat turn with the natural wording a person types. Receipt
  counts are drawn from the frozen distribution `{1: 20%, 2: 25%, 3: 25%,
  4: 15%, 5: 10%, 6: 5%}` per target memory.
- **Deterministic generation, frozen before rendering.** The builder is a
  seeded program (`fixtures-hr2b/build/`, one named PRNG, one seed constant,
  ordered sentence banks, length-target distributions, the joint
  receipt-count/placement allocation, whole-sentence assembly). Receipts are
  ordered by `eventTime` then id before ordinal ids `#s1…#s6` are assigned, and
  the validator checks array order. A seed is accepted only if the fixture
  passes the preregistered structural checks of §3.1–3.2; the first passing
  seed is used and every rejected seed's diagnostics are retained in the build
  record. No check reads queries, rankings or assembly output.
- **Evidence placement** is the designed variable. It is defined over
  **distinct rendered target facts**: each such fact is assigned one placement
  by the seeded allocation with frozen shares **body 45%**, **first receipt
  only 25%**, **later receipt only (receipt 2–6) 30%**, and every target memory
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
  accepted).** Per split, the `later-receipt` and `first-receipt` strata each
  have **at least 30 required groups and 12 families**, and, because the
  bootstrap's `minimumFamilies: 10` applies **per category**, every category
  represented in the guard stratum has **at least 10 test families** (and at
  least 4 dev families); the set of represented guard categories is frozen
  with the labels and is never trimmed afterwards to obtain a CI. A fixture
  that cannot meet these quotas is rebuilt with another seed (or more
  authored families) before freeze; W1 is told the quotas up front.
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
- **Guard stratum**: the same contrast restricted to the `later-receipt`
  stratum (§3.2 classification: groups with no body or first-receipt support
  among eligible members), macro over the categories represented in that
  stratum as frozen with the labels, same bootstrap. **What the guard means:**
  on strict later-only groups P-top-s1 can never admit the evidence, so its
  stratum coverage is zero by construction and the guard Δ equals minus
  P-top's stratum coverage. The guard therefore bounds the **incremental
  loss** first-receipt-only accepts on exactly the evidence it skips; it does
  not demonstrate that later evidence is preserved. The results report the
  stratum's absolute coverage per arm, its ranking ceiling and its family and
  category counts beside the Δ, and a zero ranking ceiling on the guard
  stratum makes the decision Inconclusive.

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
  tokens; receipts of 40/120/200 tokens; 1–6 receipts; `sourcesComplete`
  transitions) with the normative `representation-v2` serializer at
  `b18dabe0` and counts them with `o200k`, publishes the model-versus-measured
  errors in `results/hr2b-rankings/host-v2-calibration.json`, and does **not**
  retune the constants: the primary cell estimates the additive model's
  behaviour, and a product-default revision needs its own exact-host
  validation.
- Budgets: `{1000, 1500, 2000, 4000}`. Under `host-v2`, 24 items with the
  minimum body (120) and one minimum receipt (40) cost 43 + 58 + 23·57 +
  24·(120 + 7 + 40) = **5,420** tokens (3,840 at `O = 0`); at the distribution
  midpoints (220-token bodies, 2.8 receipts of 90) about **16,300**. Every
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
derived from the fixture's placement record, reported with group and family
counts per category. Bootstrap seed `hr2b-bootstrap-v1`; McNemar on
all-required with the smallest test query id per family.

## 8. Harness changes (reviewed like HR-2)

- **Fixture tools (`lib/fixture.mjs`, `tools/{facts-view,split,labels,
  validate,apply-audit}.mjs`)**: a **versioned validation profile** keyed by
  the fixture version (`hr1-fixture-v2` keeps its constants: 300/700/100,
  1–3 spans, 35–45% span-only; `hr2b-fixture-v1` carries 160/320/60, 1–6
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
   24.15.0 through `cairn-heavy`. Toy-fixture and dev-pipeline checks happen
   here, after the rule freeze.
3. **Authoring pipeline**: **W1** builds the world, the forbidden lexicon and
   the deterministic builder under `fixtures-hr2b/build/` with
   `check-world.mjs`; the coordinator runs the facts view; **W2** writes
   queries from the facts view only; the coordinator runs split, labels and
   the validator (structural quotas of §3.2 included); **W3** audits labels
   and filler; apply-audit; validator passes; **fixture freeze** commit with
   `fixtures-hr2b/FROZEN.md`. A quota failure sends the fixture back to W1
   with the diagnostics, never forward.
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
  receipts and 1–6 receipts; the §5 calibration check publishes the error but
  does not retune. The shipped host's exact token counts differ, and a product
  default change needs its own exact-host validation.
- The guard stratum measures the incremental loss first-receipt-only accepts
  on evidence it skips by construction (§4); it cannot show that later
  evidence is preserved.
- Rankings are the two free, body-only arms; receipts are not indexed for
  ranking and the hosted product ranking is not evaluated.
- Generated summaries, prefixes, windows, Cards, MOC, reranking and answer
  correctness are out of scope. Direction only.
