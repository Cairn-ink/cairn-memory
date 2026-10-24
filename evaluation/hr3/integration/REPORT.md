# HR-3 reconciliation and mechanical calibration

**Re-checked offline against revised E-1/A-1 at base `983d239d6315c1d4f36434acc73c367e8f5416f6`, Node v22.16.0.**
The scorer schema is the authority. All 120 pilot checkpoints validate and
self-score C=O=R=J=1; every one of the 1,984 challenge bundles scored without
adapter, validator or execution failure. Pooled mechanics have zero false
accepts and zero false rejects. **Genuine-referral calibration cannot pass with
this frozen challenge version: 36/72 required style strata meet quota.**
No adjudicator, API, network operation, credential/env-file read, paid workload,
held-out generation, broad/sibling test suite, product mutation or commit ran.
This re-check updates integration records; coordinated generator/harness work is recorded in their own directories.

## Reconciliation and defects

`mechanical-results.json` records the frozen scorer/integration/protocol/errata
hashes, source checks, all confusion cells, selected referral IDs and counts.
`reconciliation-fields.json` enumerates **792 observed leaf-pattern mappings**
with counts and dispositions: **1,563,796 source leaves** across **2,104 adapted
checkpoints**, including repeated full private authoring contexts. These are
leaf occurrences, not independent cases. Every audit envelope restores its
exact original inputs, verified for all 2,104 records. Source shapes/semantics
are validated separately; keeping originals is not used to excuse a bad mapping.

| Generator source | Scorer destination and audit rule |
| --- | --- |
| Selected `family.checkpoints[].question` | `gold.question`; joins require exactly one matching batch and family |
| `G_correct.current.status`, `.claims[]` | `gold.current`, preserving each Claim field |
| `G_correct.old.status`, `.records[].status/.claims[]` | `gold.old`, preserving explicit predecessor status/set, with no inference |
| Claim `subject`, `predicate`, `value`, `scope`, `valid`, `qualifiers` | Identical typed fields; all five Value variants, exact decimal strings, DNF scopes, null bounds and half-open intervals retained |
| Claim `citations:[]` | Removed only after checking empty; exact reversible constant retained in sidecar; nonempty input is an error |
| `G_correct.reason.status/.nodes[]` | `gold.reason.status/.nodes[]`, with Claim projection above |
| `G_correct.reason.edges:[]` | Checked empty; gold topology comes from acceptedGraphs, never interpreted as a missing answer graph |
| `G_correct.acceptedGraphs[].edges[].from/to` | `gold.reason.acceptedGraphs[].edges[].from/to`, cross-checked against support topology |
| `support.acceptedGraphs[].edges[].support` | Same outer graph OR / edge AND / support OR-of-ANDs; source spans interned to deterministic IDs |
| Span `turn_id/start/end/quote` | `supportSpans.origin/start/end/text`; check exact source turn slice and UTF-16 length |
| Span `offset_unit` | Must equal `utf16`; checked and retained privately |
| `assertion_spans[].spans[]` | Source/context spans, not added edge licenses |
| Family/lineage/batch/event IDs, controls, ASTs and other metadata | No closed scorer slot: reported defect, retained privately |

| Challenge source | Scorer destination and audit rule |
| --- | --- |
| `row.question` | `gold.question`, checked against authored world |
| `row.gold.answer.current/old/reason.status/nodes` | Same projection as generator; no correctness labels used |
| `row.gold.answer.reason.edges` | Empty citations checked; topology must equal one accepted graph; redundant source retained privately |
| `row.gold.acceptedGraphs: [[edge,...],...]` | `gold.reason.acceptedGraphs: [{edges:[edge,...]},...]`; `[[]]` for not_stated becomes `[]`, reversible from retained source |
| `world.edge_support[].alternatives` | OR-of-AND source span ID arrays; exact authored source citation/occurrence verified |
| `world.delivered[].text` | Original source/context spans with local source identity; only edge_support attaches causal licenses |
| `row.candidate` | Exact `submission.answer`; never repaired, translated or supplied extra citations |
| `row.delivered[].item/unit/source/text` | Exact address fields and final text, as one source segment starting at 0 |
| `world.claims_support[].citation.intent` | Historical intent from authored harness plan, independent of reader citations; other units use authored current intent |
| Normalization, truncation and aliases | Already-delivered fixture identity map: `false`, `null`, `[]`; no invented source ancestry or alias |
| Changed/new delivered bodies | Distinct local source origin, never original causal span identity |
| True labels, lineage/language/style, representation, referral designations, provenance, source AST, group and role | No closed scorer slot: reported defect, retained privately; never passed to scorer/judges |

Reported defects, counted per adapted record (not per individual field):

| Defect | Count | Disposition |
| --- | ---: | --- |
| Generator non-scorer metadata | 120 | Full private source sidecar; exact unmapped paths/counts in field ledger |
| Challenge non-scorer metadata | 1,984 | Full private source sidecar; excludes true labels and construction information from scoring |
| Challenge delivery provenance limitation | 1,984 | Final fixture text supports a local identity map; product normalization/truncation/raw ancestry cannot be recovered |

The audit **envelope** is lossless. A scorer-only object cannot losslessly hold
metadata/provenance absent from its closed schema; these defects are explicitly
reported rather than represented as invented scorer fields. There are **zero
unmappable core Claim/Value/status/graph fields** and zero suppressed validation
failures. This does not certify natural-language causal entailment or product
source-map authenticity. A future production harness must supply actual trusted
origins/slices/normalization/truncation observations.

## Pilot validation

60 families × two checkpoints = **120 scorer schema validations and 120
self-scores**, all full credit; failure list is empty. Self-scoring constructs
an explicit gold witness: expected claims/statuses, one complete accepted graph,
and its exact supporting citations against delivered authored source slices.
It does not submit the generator's empty `reason.edges` gold placeholder as an
answer, claim that uncited causal answers earn credit, or claim these are actual
research-arm deliveries. Raw source offsets are checked before any mapping.

Revised E-1 (2026-10-25) is applied in the regenerated generator artifacts.
All 24 pilot expiry checkpoints accept the supported deadline-trigger graph;
the four formerly `not_stated` expiry checkpoints now have stated causes.
Trigger-only witnesses score C=O=R=J=1. Deadline mentions without an edge,
uncited trigger edges, bare deadline fragments and `not_stated` answers receive
R=0, verified by the focused integration tests. The scorer is unchanged and no
scorer defect blocks the revised gold. The generator README discloses all 36
engineering/pilot expiry checkpoints, including the six previously reported.
E-2 product controls remain outside this mechanical re-check.

## Mechanical observations

A decision is accept for score 1, reject for 0, and referred for null. The
scorer may additionally emit a pass referral even when final R/J is already
forced to zero; those applications remain in the adjudication population.

| Set | Component | Accept | Reject | Referred |
| --- | --- | ---: | ---: | ---: |
| pooled | C | 244 | 74 | 82 |
| pooled | O | 276 | 60 | 64 |
| pooled | R | 152 | 26 | 222 |
| pooled | J | 84 | 140 | 176 |
| referral_candidates | C | 0 | 156 | 804 |
| referral_candidates | O | 360 | 120 | 480 |
| referral_candidates | R | 0 | 12 | 948 |
| referral_candidates | J | 0 | 288 | 672 |
| evidence_contrasts | C | 165 | 0 | 75 |
| evidence_contrasts | O | 180 | 0 | 60 |
| evidence_contrasts | R | 12 | 144 | 84 |
| evidence_contrasts | J | 12 | 144 | 84 |
| representation_pairs | C | 60 | 96 | 228 |
| representation_pairs | O | 384 | 0 | 0 |
| representation_pairs | R | 48 | 0 | 336 |
| representation_pairs | J | 48 | 96 | 240 |

Across all 1,984 bundles, component × language × style counts follow. The
full **component × set × language × style × true-label confusion cells** are
in `mechanical-results.json.confusion`, including zero false accept/reject
cells and explicit referred counts. All mechanically decided components are
correct against challenge truth; no referral is counted as a false rejection.

| Component | Language | Style | Accept | Reject | Referred |
| --- | --- | --- | ---: | ---: | ---: |
| C | en | terse | 80 | 30 | 72 |
| C | en | conversational | 42 | 31 | 109 |
| C | en | formal | 37 | 30 | 115 |
| C | en | operational | 38 | 30 | 114 |
| C | zh-Hant | terse | 80 | 30 | 72 |
| C | zh-Hant | conversational | 42 | 31 | 109 |
| C | zh-Hant | formal | 37 | 30 | 115 |
| C | zh-Hant | operational | 38 | 30 | 114 |
| C | mixed | terse | 40 | 21 | 71 |
| C | mixed | conversational | 15 | 21 | 96 |
| C | mixed | formal | 10 | 21 | 101 |
| C | mixed | operational | 10 | 21 | 101 |
| O | en | terse | 123 | 17 | 42 |
| O | en | conversational | 110 | 17 | 55 |
| O | en | formal | 109 | 18 | 55 |
| O | en | operational | 104 | 18 | 60 |
| O | zh-Hant | terse | 123 | 17 | 42 |
| O | zh-Hant | conversational | 110 | 17 | 55 |
| O | zh-Hant | formal | 109 | 18 | 55 |
| O | zh-Hant | operational | 104 | 18 | 60 |
| O | mixed | terse | 82 | 10 | 40 |
| O | mixed | conversational | 77 | 10 | 45 |
| O | mixed | formal | 77 | 10 | 45 |
| O | mixed | operational | 72 | 10 | 50 |
| R | en | terse | 60 | 16 | 106 |
| R | en | conversational | 13 | 16 | 153 |
| R | en | formal | 9 | 16 | 157 |
| R | en | operational | 14 | 17 | 151 |
| R | zh-Hant | terse | 60 | 16 | 106 |
| R | zh-Hant | conversational | 13 | 16 | 153 |
| R | zh-Hant | formal | 9 | 16 | 157 |
| R | zh-Hant | operational | 14 | 17 | 151 |
| R | mixed | terse | 20 | 13 | 99 |
| R | mixed | conversational | 0 | 13 | 119 |
| R | mixed | formal | 0 | 13 | 119 |
| R | mixed | operational | 0 | 13 | 119 |
| J | en | terse | 45 | 61 | 76 |
| J | en | conversational | 5 | 62 | 115 |
| J | en | formal | 5 | 62 | 115 |
| J | en | operational | 7 | 61 | 114 |
| J | zh-Hant | terse | 45 | 61 | 76 |
| J | zh-Hant | conversational | 5 | 62 | 115 |
| J | zh-Hant | formal | 5 | 62 | 115 |
| J | zh-Hant | operational | 7 | 61 | 114 |
| J | mixed | terse | 20 | 44 | 68 |
| J | mixed | conversational | 0 | 44 | 88 |
| J | mixed | formal | 0 | 44 | 88 |
| J | mixed | operational | 0 | 44 | 88 |

Pooled whole-answer mechanics: **84 accepted, 140 rejected, 176 referred**;
mechanical coverage **224/400 = 56%**. There are zero false accepts among 200
incorrect answers and zero false rejects among 200 correct answers. The 176
pending J outcomes contain 116 correct and 60 incorrect answers. These observed
mechanics pass only the pooled-mechanics row, not the complete pipeline gate.

Evidence contrasts: all 144 endpoint-only/truncated/removed variants have
support=0; all 48 negated variants have support=null and go to the support pass.
No insufficient bundle is mechanically accepted. Of 48 adequate bundles, 12
have final R=1 and 36 await equivalence/support adjudication; none is rejected.

## Referral population and genuine-referral observation

**1,736 answers / 584 independent worlds** generate **3,284 pass applications**:
1,698 correctness and 1,586 support. Identical contextual pass payloads reuse
keys, leaving **3,140 distinct judge-input files**. First-two judgments therefore
require 6,280 fresh isolated sessions before any necessary third reviews.
There are no generalized propagated equivalence rules.

| Composition | Referred answers |
| --- | ---: |
| bySet: pooled | 248 |
| bySet: referral_candidates | 960 |
| bySet: evidence_contrasts | 192 |
| bySet: representation_pairs | 336 |
| byLanguage: en | 620 |
| byLanguage: zh-Hant | 620 |
| byLanguage: mixed | 496 |
| byStyle: conversational | 474 |
| byStyle: operational | 468 |
| byStyle: formal | 474 |
| byStyle: terse | 320 |

The full set/language/style intersection is in `population.bySetLanguageStyle`.
**564 referred answers already have J=0**; they still require their outstanding
component/pass findings. Model-dependent final scores: C=1,189, O=604, R=1,590,
J=1,172. Any-referral share is **1,736/1,984 = 87.5%**. This is a calibration
population, not a forecast of research-arm performance or independent errors.

All 960 referral-candidate answers trigger some referral. **684** trigger an
actual referral for at least one **designated** component. Designated observed
component applications total **1,044/1,440** (the same 240 matched positive
answers are deliberately reused across C/O/R). Of the 72 required
component/language/style/sign strata, **36 meet** their 20-case quota.

The following counts apply identically to **each** language (en, zh-Hant,
mixed); each language has four styles with 20 required positives and negatives
per style:

| Component | Observed positives/language | Observed negatives/language | Per-style positive / negative | Quota |
| --- | ---: | ---: | --- | --- |
| C | 80 | 28 | 20 / 7 | FAIL: 52 negatives missing/language |
| O | 40 | 40 | 10 / 10 | FAIL: 40 positives and 40 negatives missing/language |
| R | 80 | 80 | 20 / 20 | MET under actual-pass referral definition |

The observed definition is an emitted scorer referral containing the designated
component, regardless of a mechanically forced final R/J zero. If certification
instead required final score=null, R has **76** negatives/language; all other
counts are unchanged. `qualification.strata[].finalPending` publishes that
stricter population too. Protocol §§7–8 and the scorer explicitly retain
unresolved components even with forced J=0, so the emitted-pass definition is
used here. The C/O shortages block certification under either definition.

Candidates remain in their frozen file order; the first qualifying cases are
selected up to 20/style/sign without judgment feedback. Direct decisions are
never counted as referrals. No spare candidates exist within the frozen
strata. A coordinated new calibration version with fresh cases is needed to
fill the shortages; neither relabeling nor relaxing quotas can repair this
version. **No complete §8 calibration pass is claimed.**

## Adjudication handoff and gate

`artifacts/revised-e1-final/judge-input/` contains the 3,140 real blinded pass files.
The primary must distribute exactly one file per fresh isolated session;
`README.md` specifies the judgment interchange and provenance attestations.
No arm identity, other answer, label, mechanical score, threshold, consequence,
private audit or cross-pass finding enters those payloads. Correctness contains
no support source spans or delivered context; support contains no gold or
expected graph. Original submitted citations and legitimate delivered addresses
remain intact. Node IDs are anonymized by the canonical scorer. Shared synthetic
subject/update tokens are evidence referents, not arm labels.

The gate CLI validates payload hashes, pass identity, model/effort/command and
fresh non-author sessions; requires structured findings/citations/rationale;
computes first-two agreement before independent third resolution; combines
causal correctness with support; preserves unresolved cases; and evaluates
every §8 observed threshold. It reports pass errors, style/class/language
strata, independent key/world counts, κ and Wilson 95% intervals. Variant
rates are descriptive; world intervals concern any error within a world.
Execution attestations and external ancestry/resource/audit gates still need
the primary's verification.

Running the real index with **zero judgments** returns exit **1**, status
**fail**: genuineReferralQuotas/genuineReferrals fail, inputCompleteness and
pooledMechanics pass, judgment-dependent gates and completion remain pending.
This is an expected calibration failure, not an execution/test failure. It
cannot falsely pass because of empty inputs, absent verdicts, reused matched
positives, or mechanically forced J zeros. Artificial passing and failing
full-size fixtures are confined to the integration test suite; no synthetic
judgment is written into the real artifacts.

## Verification, scope and interpretation choices

| Command/check | Actual exit code | Result |
| --- | ---: | --- |
| `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` | 0 | 18 tests, 18 pass, 0 fail |
| `node evaluation/hr3/integration/cli.mjs mechanical --out evaluation/hr3/integration/artifacts/revised-e1-final` | 0 | 120 gold checkpoints + 1,984 challenges; no execution/validation failures |
| Actual generator CLI, `--split pilot --out <TEMP>/pilot` | 0 | 60 families; all eight emitted pilot files match freeze hashes |
| Actual copied challenge CLI, `node <TEMP>/challenge/generate.mjs` | 0 | All 13 artifacts match challenge manifest hashes |
| `node evaluation/hr3/integration/cli.mjs gate --index evaluation/hr3/integration/artifacts/revised-e1-final/private-index.json --judgments evaluation/hr3/integration/artifacts/empty-judgments.jsonl --out evaluation/hr3/integration/artifacts/revised-e1-final/gate-no-judgments.json` | 1 | Expected quota failure; missing judgments remain pending |

No exit status was inferred from stdout tails or pipelines. Child processes use
explicit log file descriptors and captured status; no task remains unattended.
43 frozen source/output/protocol byte/hash checks passed, plus recorded scorer,
integration and errata hashes. Detailed test TAP is retained at
`tests.log` (local ignored log). Regeneration command logs use `<TEMP>`
in canonical records so temporary path names do not change emitted results.

Protocol coverage: §2 exact typed claims/scopes/intervals and explicit
predecessors; §6 schema reconciliation, source maps and pass isolation; §7
accepted graph OR/AND support and C/O/R/J; §8 mechanical confusion, actual
referral qualification, blinded handoff and deferred gate computation; §9
pilot gold validation; §13 freeze/provenance records; §16 judgment-error
accounting inputs, without running research inference. E-1 is applied, E-2 is
acknowledged as outside mechanical control execution.

Resolved representation ambiguities are explicit: empty citations are checked
constants; gold's empty reason.edges is distinct from submitted causal edges;
challenge `[[]]` versus scorer `[]` means unstated; challenge already-delivered
text has local identity provenance; historical intent uses authored plans;
original context spans do not acquire edge licenses; actual pass referrals and
pending final components are reported separately; independent units are worlds
or contextual keys rather than variants. No semantic alias is learned from
challenge labels. Non-author semantic/ancestry, runtime resource and production
control audits remain external. No repository packaging manifest was edited:
these are local evaluation tools, with no imports from shipped product entries.

Reproduction/independent audits also exited **0**: two complete runs have
byte-identical 1,984 observations, 120 pilot records and 3,140 blinded pass
payloads. Independent Python canonical JSON/SHA-256 rederived every payload hash
and scorer key, and checked every payload's pass-specific top-level allowlist.
All 3,140 checks passed. Generated file lists were independently derived by
`pathlib.rglob` and `os.walk`, compared exactly, and hashed after readback:
**3,148 artifacts excluding their manifest, 3,149 including it**.

## Delivery inventory (mechanically cross-checked)

The source/delivery file list below was derived using
`git ls-files --cached --others --exclude-standard -- evaluation/hr3/integration`
and independently using recursive `pathlib.rglob` excluding ignored artifacts;
the lists match exactly: **13 files**. A second full-directory comparison using
`pathlib.rglob` and `os.walk` agrees on **3,162 total files**, comprising these
13 files and 3,149 generated artifacts. The artifact manifest enumerates every
generated filename/hash except itself; `delivery.json` records its hash and
all source hashes except its own, avoiding recursive self-hashing.

```text
evaluation/hr3/integration/.gitignore
evaluation/hr3/integration/README.md
evaluation/hr3/integration/REPORT.md
evaluation/hr3/integration/adapters.mjs
evaluation/hr3/integration/cli.mjs
evaluation/hr3/integration/delivery.json
evaluation/hr3/integration/field-map.mjs
evaluation/hr3/integration/gate.mjs
evaluation/hr3/integration/mechanical-results.json
evaluation/hr3/integration/mechanical.mjs
evaluation/hr3/integration/reconciliation-fields.json
evaluation/hr3/integration/reproduce.mjs
evaluation/hr3/integration/test/integration.test.mjs
```

`artifacts/revised-e1-final/artifact-manifest.json` includes the full generated list;
large regenerated files are ignored by the integration-local `.gitignore`.
`mechanical-results.json` and `reconciliation-fields.json` retain the compact
observations and field-by-field report independently of ignored data.

Scoped `git diff --check` and explicit untracked UTF-8/newline/trailing-whitespace
inspection exited **0**. The revised generator, integration and harness were tested within the authorized three-directory scope. No task remains
running and no continuing monitor is claimed.
