# HR-2b: long-item budgeted assembly, offline protocol (v0.1 draft)

Status: **draft v0.1, 2026-10-24, awaiting non-author audit; frozen before any
fixture is built or any test-split cell is scored.** Written by the U5b
coordinator at the primary's request (charter §6 "next step: a long-item
fixture"). Branch `experiment/hr2-assembly` (it holds the HR-1 ranking harness,
the HR-2 assembly harness and the host-v2 model). No public core API, schema,
default, adapter or installed artifact changes; the engineering consumer is a
possible contract §15 default change, which this protocol does not make.

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

The fixture reuses the HR-1 **schema** (`hybrid-retrieval-hr1-fixture-schema.md`)
unchanged except the version string, so the HR-1 tools (`facts-view`,
`labels`, `split`, `validate`, `apply-audit`) and the HR-1 ranking harness run
on it after a one-line allowlist change (§8). Memories' `spans` are the
receipts; `expresses[].where ∈ {body, span}` with `span` naming the receipt.
It differs from `hr1-fixture-v2` in **shape**, not in schema:

### 3.1 World

- **Setting and families.** A new synthetic world in the same invented
  Taiwan-based founder setting, same six domains and language mix (about 55%
  zh-TW, 30% en, 15% mixed). **At least 40 target families**, each a thread of
  5–7 canonical facts with the HR-1 lifecycle (a changed decision with its
  reason, a bounded amount, two assignments with a near-miss attribute, a
  rejected or proposed option, one absent fact). Facts and families are new
  text, not copies of HR-1's, so that neither world leaks into the other.
- **Long items.** A target **memory** is an assistant-style extracted note of
  **2–4 facts of its family** in **120–400 `o200k` tokens** (3–8 sentences, one
  or two paragraphs), with **1–6 receipts** of **40–200 tokens** each (chat
  turns with the natural wording a person uses, including the filler people
  actually type). Receipt counts are drawn from the frozen distribution
  `{1: 20%, 2: 25%, 3: 25%, 4: 15%, 5: 10%, 6: 5%}` per family thread by the
  seeded builder.
- **Evidence placement** is the designed variable. For every required fact
  expressed by a target memory, the builder places its evidence region in
  exactly one of three locations, by a seeded draw with frozen shares over the
  S-target universe: **body 45%**, **first receipt only 25%**, **a later
  receipt only (receipt 2–6) 30%**. "Only" means the body and the other
  receipts refer to the topic without stating the fact (the HR-1 `S` row
  discipline, extended to receipts). The validator reports the realized shares
  per split; a deviation above 5 points from any share is a build defect.
- **Filler is authored, fact-free and in-domain.** Long bodies and receipts are
  composed from authored sentence banks per domain and per role (assistant
  note sentences; user chat sentences), disclosed as filler in the build
  sources, and checked by the validator to contain **none** of any fact's
  entities, numbers, dates or distinctive terms. This replaces the rejected
  §6.1 foreign-text padding of HR-2, whose irrelevance was unverified.
- **Distractors and scale.** `S-long` = about **160 target memories** (40
  families × 4 episodes) + about **320 distractor memories** rendered from 40
  distractor families with the **same** length, receipt-count and placement
  distributions (validator: means within 15%, receipt-count histogram within 5
  points per bin) + about **60 foreign** memories including near-duplicates of
  target facts. Template rendering is allowed for at most half of the
  distractors and must be disclosed, as in HR-1.
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
  the receipt id, as HR-1; the **placement stratum** of a group is derived
  mechanically from the builder's placement record: `body`, `first-receipt`,
  `later-receipt`. The validator requires, per split, **at least 30 required
  groups and 12 families** in the `later-receipt` stratum and the same in
  `first-receipt`; otherwise the fixture is rebuilt with another seed before
  freeze.
- **W3** audits labels as HR-1 §4.1 step 5; overrides are applied before the
  freeze.

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
  stratum (groups whose only evidence is a receipt after the first), macro over
  the categories represented in that stratum, same bootstrap.

| Outcome | Condition |
| --- | --- |
| **Adopt**: `rank-first-first-source-v1` may become the §15 default under `host-v2` | Δmacro(P-top-s1 − P-top) ≥ **+3 points** with CI lower bound > 0, **and** the guard stratum's Δ has CI lower bound ≥ **−5 points** |
| **Keep**: `rank-first-whole-v1` stays the default | Δmacro ≤ 0 with CI upper bound < +3, **or** the guard stratum's Δ has CI upper bound < −5 |
| Inconclusive | Otherwise, and whenever the bootstrap reports too few families or invalid inputs |

The thresholds are practical criteria without a power claim: +3 points is
about one required group in thirty on this suite, and −5 on the guard stratum
is the loss at which first-receipt-only would be hiding a systematic miss
behind an average gain. An **Adopt** outcome authorizes the primary to open a
§15 default-change revision; it is not itself that change. A **Keep** outcome
leaves `rank-first-first-source-v1` available and non-default.

- **Secondary, exploratory (95% CIs, labelled)**: the same contrasts on A1;
  budgets 1,000, 2,000 and 4,000; cost model `O = 0` for the same cells (to
  separate the overhead effect from the length effect); P-cover and
  P-top+tail against P-top (to confirm or refute HR-2's direction on long
  items); strata by placement (`body`, `first-receipt`, `later-receipt`),
  fidelity, language and category; token use.
- **Dev inspection.** The dev split may be assembled and scored before the
  freeze of this rule only to check the harness runs end to end; its numbers
  are recorded in §9 and never used to pick the thresholds, which are fixed in
  this draft.

## 5. Fixed inputs

- Fixture `hr2b-fixture-v1` (§3), frozen in `fixtures-hr2b/FROZEN.md`.
- **Rankings**: produced once per split by the HR-1 harness on the frozen
  fixture, with-foreign, `S-long`, horizon 24, intents as HR-1 §5.1: A1
  (`lib/bm25.mjs`, tokenizer T1) and bge-m3 + A3 (RRF k = 60, depth 12, equal
  weights; dense CLS, L2-normalized, `maxLength 8192`, no truncation expected
  for ≤ 400-token bodies, truncations recorded). Documents are memory bodies
  plus receipt text collapsed as HR-1 did (`collapseMemories`), so the
  rankings see the same text the assembler can admit. Frozen under
  `results/hr2b-rankings/` with SHA-256 before any assembly cell exists; the
  assembly harness authenticates them as HR-2 §5.
- Counter `tiktoken@1.0.22`, `o200k_base`, the same as HR-2 and the host.
- Cost models: `host-v2` from `assembly/overhead-host-v2.json` (pinned, HR-2
  §11.1) and the scalar `O = 0`.
- Budgets: `{1000, 1500, 2000, 4000}`. Rankings' top-24 long items cost about
  24 × (57 + 260 + receipts) ≈ 10,000–15,000 host-v2 tokens, so every budget
  binds; 4,000 is included as the product's maximum.

## 6. Items, units, arms, admission

Exactly HR-2 §6 and §11.2: one body unit and one unit per receipt, in receipt
order; whole-unit skip-and-continue; a receipt is scheduled only after its
body was admitted; "first receipt" is `spans[0]` (the earliest by the
fixture's `eventTime`, then id); P-top+tail bundles atomic. Arms: `P-top`,
`P-top-s1`, `P-cover`, `P-cover-s1`, `P-top+tail`. Grid: 5 arms × 2 rankings ×
4 budgets × 2 cost models = **80 cells** per split. Only the §4 primary cell is
confirmatory.

## 7. Metrics and statistics

HR-2 §7 and §8 unchanged: group coverage@B over required regions (whole
units), all-required@B, ceiling and assembly loss, token use p50/p95, strata.
New stratum family: **placement** (`body`, `first-receipt`, `later-receipt`),
derived from the fixture's placement record, reported with group and family
counts per category. Bootstrap seed `hr2b-bootstrap-v1`; McNemar on
all-required with the smallest test query id per family.

## 8. Harness changes (reviewed like HR-2)

- `lib/fixture.mjs`: the version allowlist accepts `hr2b-fixture-v1` from the
  `fixtures-hr2b/` directory (one frozen constant per fixture; HR-1 files and
  hashes untouched). The HR-1 tools and ranking harness are otherwise
  unchanged; any other change they need is a finding, not a silent edit.
- `assembly/`: a fixture selector (`--fixture-dir fixtures-hr2b`,
  `--rankings` pointing at `results/hr2b-rankings/`), the placement stratum,
  the §4 decision rule as a second, separately selected confirmatory rule
  keyed by fixture version (the HR-2 rule and its O=0 selector stay untouched
  and keep passing the legacy regression of §11.5), budgets `{1000, 1500,
  2000, 4000}` in the whitelist for this fixture only.
- Tests on toy fixtures for every new branch; the HR-2 legacy regression
  (240 archived cells byte-identical after stripping scorer identity) and the
  host-v2 regression (120 archived cells) must still pass.

## 9. Procedure

1. Non-author audit of this draft (read-only Codex); v1 applies the P0/P1
   findings; the rule in §4 is then frozen in a commit before step 2.
2. **W1** builds the world and the deterministic builder under
   `fixtures-hr2b/build/` with `check-world.mjs`; the coordinator runs the
   facts view; **W2** writes queries; the coordinator runs split, labels and
   the validator; **W3** audits labels; apply-audit; validator passes;
   **fixture freeze** commit with `FROZEN.md`.
3. Harness changes (§8) by one Codex worker; two non-author reviews (Spec,
   Standards) on a clean detached worktree of the exact commit; owned-runner
   tests on Node 22.16.0 and 24.15.0 through `cairn-heavy`.
4. **Rankings**: the coordinator runs A1 and bge-m3 + A3 on dev and test
   through `cairn-heavy` (bge-m3 is CPU-heavy: about 540 documents and 160
   queries, minutes, no spend), records the ledger and freezes
   `results/hr2b-rankings/` by SHA-256. The dev rankings may be assembled
   once to check the pipeline (§4, recorded here).
5. **One test-split assembly run** of the 80 cells, scoring and report through
   `cairn-heavy` from a clean checkout; artifacts under
   `results/hr2b-final/` with the HR-2 provenance discipline (stage commands,
   exit codes, hashes, compressed archives, logs force-added past the `.log`
   ignore rule).
6. Results document `docs/plans/budgeted-assembly-hr2b-results.md`, a
   non-author transcription check, a `docs/limitations.md` entry, whatever the
   outcome; then the frozen protocol commit and the results commit go to the
   primary for charter §5/§6.
7. After the test run nothing in §§3–7 changes; a defect produces a new
   protocol version reported alongside.

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
  §11.2; the shipped host's exact token counts differ.
- Rankings are the two free arms only; the hosted product ranking is not
  evaluated.
- Generated summaries, prefixes, windows, Cards, MOC, reranking and answer
  correctness are out of scope. Direction only.
