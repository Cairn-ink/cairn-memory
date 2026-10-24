# HR-3 independent bilingual calibration challenge, v1

This directory contains 1,984 seeded synthetic challenge bundles, authored independently of the scorer against the frozen [protocol v0.3.4](../protocol/protocol-v0.3.4.md), primarily §§6–8. No scorer file was read or imported. No network, API, external model, credential, research extraction, or adjudication call was used. Everything written is inside this directory. No dependencies were added and no commit was made.

**Referral qualification is pending.** The 960 referral-like bundles have the required world/language/style/component composition. Protocol §8 additionally requires the frozen mechanical pipeline actually to refer the designated component. That observable fact cannot be certified by an independent author who cannot inspect or invoke the scorer. `manifest.json` records `certified_genuine_referrals: null`. Passing this directory's validator does not pass calibration or authorize a paid stage.

## Contents and quotas

| File | Bundles | Independent worlds | Composition |
| --- | ---: | ---: | --- |
| `pooled.jsonl` | 400 | 400 | 200 equivalent, 200 incorrect; incorrect: 60 C-only, 60 O-only, 60 R-only, 20 C/O/R |
| `referral-candidates.jsonl` | 960 | 240 | 80 worlds per Traditional Chinese/English/mixed class; one positive and three single-component negatives per world |
| `evidence-contrasts.jsonl` | 240 | 48 | Five deliveries per world: adequate, endpoint-only, negated, truncated, removed |
| `representation-pairs.jsonl` | 384 | 48 | 3 languages × 4 distortion classes × 4 worlds × 2 faithfulness states × 4 styles |
| Total | 1,984 | 736 | 680 equivalent, 1,304 incorrect |

The pooled set is exactly 200 Traditional Chinese and 200 English bundles, with 100 positive and 100 negative per language. Each component has 80 negatives and 320 positives, as required by the pooled component gates. Every language/style pooled cell has 50 bundles, including 25 positives.

The four frozen styles are `terse`, `conversational`, `formal`, and `operational`. Across the complete collection each has 496 bundles. Language totals are 728 Traditional Chinese, 728 English, and 528 mixed. The language classification concerns the authored natural language; schema field names, audience codes, identifiers and timestamps retain their machine representation.

For each referral component/language/style stratum there are 20 candidate negatives and 20 matched candidate positives. Each language/component therefore has 80 of each. A world's single positive is deliberately reused in the C, O, and R denominators; these are not 720 independent positives. All 960 candidates remain **unqualified** until the frozen pipeline supplies observed referrals. They use contextual idioms for both scoped policies and causal statements, rather than only spelling substitutions.

Evidence groups contribute 48 adequate and 192 insufficient deliveries, balanced across all 12 language/style cells. Question, candidate answer and `G_correct` are byte-identical within each five-way group. In the negated variant the submitted quotation remains findable but is explicitly denied by its delivered context. In other insufficient variants required cited passages are absent or incomplete. Other unrelated context cannot repair a submitted citation.

Distortion classes are `wrong_reasons`, `commitment_changes`, `broadened_scopes`, and `dropped_qualifications`. There are 192 faithful and 192 distorted bundles. Each distorted bundle includes a locally supportive extracted body that disagrees with factual source gold; the relevant faithful delivered assertion is removed rather than left as a conflicting current assertion. Representation/faithfulness labels never enter a pass bundle.

`worlds.jsonl` preserves all 736 source ASTs, derivation notes, accepted causal graphs and authoring support plans. `answer.schema.json` is the closed executable §6 encoding; `schema.mjs` implements its validation using no dependencies. `generate.mjs` contains the frozen authored phrase banks and explicit mutations. `validate.mjs` checks the deliverables; `challenge.test.mjs` contains the focused tests. `bundles.mjs` exposes pass-specific allowlists. `manifest.json` contains quota tables, protocol hash, artifact byte lengths and SHA-256 hashes. `REPORT.md` records verification, limitations and the mechanically cross-checked file list.

## Reproduce and validate

Run from the repository root with plain Node >=22.16:

```sh
node evaluation/hr3/challenge/generate.mjs
node evaluation/hr3/challenge/validate.mjs
node --test --experimental-test-isolation=none evaluation/hr3/challenge/challenge.test.mjs
```

Run only these focused tests in the shared sandbox (TRAPS item 11). The test isolation option avoids child-process/pipe restrictions. Direct execution with `node evaluation/hr3/challenge/challenge.test.mjs` also runs the same `node:test` tests. No server or background process is started.

Seed: `hr3-independent-challenge-v1-2026-10-25`. The seed determines a SHA-256 permutation of a fixed authored candidate pre-order, before any judgments; each JSONL file freezes that order. There is no wall-clock input, random source, environment lookup, network I/O or scorer import. JSONL uses UTF-8/LF and stable sorted object keys. Regeneration overwrites only the generated JSON/JSONL in this directory, including the manifest. Scripts and documentation are also hashed; after an intentional change regenerate before validating. Tests reconstruct all cases and worlds in memory and compare complete serialized bytes to disk.

The manifest hashes every regular file except itself to avoid recursive self-hashing. Validation independently enumerates the directory through recursive `readdir` and breadth-first `opendir`, diffs the lists, and checks the complete manifest inventory, counts, byte sizes and hashes. The delivery report also records a Python `pathlib.rglob` cross-check against the manifest and a SHA-256 audit using Python's independent implementation.

## Authoring procedure and independence

1. Read only the frozen protocol and the explicitly supplied TRAPS instructions, plus repository identity/status. Do not read any sibling implementation or test. The authoring namespace is exclusively `hr3-calibration-independent-v1/…`; no research-world input or derivative paraphrase was imported.
2. Declare explicit synthetic semantic facts before rendering: current status/claims, all requested predecessors and historical labels, qualifications, source-claimed validity and the accepted directed causal graphs. These facts are the AST; they are not extracted or inferred by a model. The protocol supplies interpretation rules, while the AST supplies only synthetic subject matter.
3. Cover correction, reversal, partial refinement, overlapping scope change, expiry without fallback, multiple named predecessors, unresolved anchors, initial adoption and retroactive correction. Corrections label old assertions `erroneous`, expiry labels them `expired`, and initial adoption has no predecessor. Refinement inherits unspecified fields. Scoped changes retain the JP residual while amending TW. Old source-claimed intervals stay distinct from historical adoption status.
4. Render Traditional Chinese, English and deliberately mixed text from authored semantic-atom rows. Each row licenses four human-readable phrasings of one atom. The rows are authoring provenance, **not** a substitute for the scorer's frozen equivalence dictionary. Causal classes include unstated, direct, two-/three-edge serial, conjunctive mediated and alternative mediated graphs. Each required edge has a delivered authoring support plan.
5. Apply independently reviewable faithful transformations: idiomatic paraphrase, exact rational minute/hour/second conversions, UTC versus +08:00 instants, equivalent DNF audiences, unordered field/value/claim/record/edge order, NFKC full-width subjects and whitespace, and duplicate equivalent claims. Numeric transformations are tested with BigInt rational cross-products, including historical quantities that are not divisible by 60.
6. Produce explicit negative mutations with before/after snapshots and a reason: wrong values, extra audience cells, dropped qualifications, wrong exclusive date boundary, contradictory extra claims, status changes, promoting rejected content, wrong historical labels, missing/extra predecessors, reversed/missing/shortcut causal edges, false reason nodes, unsupported added edges and citations to a rejected proposal despite adequate support remaining elsewhere. Single-component negatives preserve both other candidate components byte-for-byte relative to the matched positive.
7. Build the five-way delivery contrasts and the four distortion classes without changing gold. A false extracted body can support its submitted local content without making that content factually correct. No labels depend on observed scorer output or judgment feedback.
8. Freeze labels, candidate order, styles and selection rule in these bytes. Verify schema, uniqueness, exact quotas, semantic-transform invariants, provenance, pass isolation and every artifact hash. No calibration error rate, agreement, model identity or acceptance threshold is fabricated.

Variant counts must never be treated as independent worlds. The 736 worlds are disjoint by construction within this authoring namespace; no sibling split inventory was inspected, so external split/ancestry auditing remains the primary's responsibility.

## JSONL contract and pass isolation

Every case contains `question`, `gold`, `candidate`, `true_label`, language/style, world/lineage keys, delivered units and provenance. Candidates and `gold.answer` have the complete §6 Answer shape. No Answer field is optional. The Value union has all five variants: Text, Boolean, Quantity, Instant and Range.

`gold = { answer: Answer, acceptedGraphs: [[{from,to}, …], …] }`. The outer graph array is OR; each inner array is AND. An unstated reason uses `[[]]`. Canonical gold contains no supporting quotations, delivery labels or supporting-span metadata: every claim/edge citation list in `gold.answer` is empty. Supporting span alternatives belong only to the authoring `world.edge_support`, never to `G_correct`.

`true_label.components` holds factual C, factual O, and final R. R is `causal_correct && causal_supported`; `equivalent` is their C/O/R conjunction. This distinction matters: all insufficient evidence variants remain causally correct while failing delivered-supported R. The concise `reason` and mutation snapshots explain every negative. A valid JSON/schema-shaped candidate can still be wrong.

`bundles.mjs` constructs exactly:

```text
correctnessBundle(row) = { question, answer: candidate, G_correct: gold }
supportBundle(row)     = { question, answer: candidate, delivered }
```

Neither bundle includes labels, world/provenance metadata, representation tags, styles, arm identities or another answer. The support bundle contains no gold or accepted graph. The correctness bundle excludes delivery context. Both copy their objects. Original submitted citations remain in both answers, as required. These are export helpers, not adjudicators; they do not launch a session or repair citations.

## Ambiguities, conventions and pending gates

These are the complete interpretation and encoding decisions made while authoring:

| Issue | Handling |
| --- | --- |
| Task says at least 400; §8 enumerates four sets totalling 1,984 | Author all four exact §8 constructions. The 400-case minimum is the pooled set, not the entire calibration collection. |
| “Balanced Chinese/English” alongside mixed-language requirements | Balance the pooled set 200/200; use all three language classes in referral, evidence and representation sets. “Chinese” is Traditional Chinese for this task. |
| §8 names four styles but does not enumerate them | Freeze the four named registers above; use 20 worlds per referral language/style and every style in each representation pair. No scorer-dependent style selection. |
| “Genuine referral” depends on the not-yet-observed mechanical pipeline | Supply all 960 referral-like candidates and mark qualification pending. A referral counts only when the frozen mechanics actually refer its designated component in the relevant pass. Select the first qualifying candidates in frozen file order, without judgment feedback. If quotas fail, this version fails that gate; do not relabel candidates or count direct decisions as referrals. |
| §6 is a typed sketch, not a literal executable JSON Schema | Use the explicit discriminator `type` for Value, decimal strings for exact quantities/range bounds, nullable range bounds, and ISO date-time strings for instants. Delivered item/source identifiers use nonnegative zero-based integers; occurrence is positive and one-based. These are local wire conventions, not additional semantic equivalences. The primary must freeze the shared executable wire schema before integration; an incompatible schema requires a coordinated versioned serialization change, not silent acceptance. |
| Frozen dictionaries are required but not supplied by the protocol | Do not invent the scorer's dictionary or decide what it mechanically recognizes. Author explicit atom-level equivalences, record their provenance and leave observed referral qualification pending. |
| “Equivalent” for an evidence contrast whose causal answer stays correct | Record final C/O/R equivalence and separate causal correctness/support fields. Inadequate cited support makes final R false even when all causal facts match. |
| §7 support expressions versus §6 gold boundary | Keep accepted graph structure in G_correct; keep supporting quotations and span OR/AND expressions solely in the authoring support plan/delivered evidence. The support pass never sees the gold graph. |
| Dates and historical validity | Follow §2 exactly: Asia/Taipei rendered as UTC or equivalent offsets; March 1 local midnight is February 29 16:00Z in leap-year 2028; “through March 31” ends March 31 16:00Z. Historical validity is source-claimed, not an invented retirement interval. |
| Hashing a manifest that contains hashes | Exclude only the manifest itself; enumerate and hash all other regular files, including code, tests and docs. |
| No independent research-split inventory available within the assigned scope | Use an exclusive calibration namespace and no research inputs; report external ancestry checking as pending rather than claim an unseen cross-split audit. |

No adjudication or scorer gate has been run. The frozen protocol's pipeline thresholds, independent sessions, support-panel behavior, agreement, resource gates and no-unresolved-verdict requirement remain necessary before calibration acceptance or paid work. This collection does not claim exhaustive product/reducer verification under §§3–5 or analysis validation under §§12–15.
