# A-4 implementation audit repair

All five P1 findings and the P2 code gap are repaired. The complete ordered offline verifier passes: **21 commands, root exit 0**, including **269/269 harness tests**, a **480/480** fake pilot, the complete leak scan and bound report. **143 audit/amendment regressions** are included (the original 56 cases, expanded for stage-specific gates and supervision). No network, key access, paid calls or commit occurred. Generator/scorer gold and their tests, the real runner directory and pinned product modules were read-only.

**Paid readiness remains blocked.** Under prospective A-1.1, the engineering pilot requires a primary-supplied supervision record, a primary-run freeze and a passing non-author review attestation confirming A-1.1 as well as A-4/4.1/4.2. Actual analysis/coverage and measured adjudication resources remain required before development/test and any inference. Those primary-supplied records remain pending. The analysis/coverage workload was **not run** here and is not replaced with a reduced demonstration. The passing offline verifier tests enforcement; it does not satisfy those external preflight requirements or authorize paid execution. No production paid-preflight record or review attestation was generated. Test-only review placeholders are explicitly rejected by production validation.

## Fixes and regression names

[Original regression inventory](reports/a4-audit-regressions.json) records the original names and red/green evidence; [current regression inventory](reports/a11-regressions.json) records all 143 current audit/amendment names after stage expansion.

### P1-1

Canonicalize public subject/predicate names in predecessor anchors with the event alias table.

Locations: `evaluation/hr3/harness/schema.mjs:121`.

Regression tests:

- `audit aliases: zh-Hant predecessor names resolve through the public alias table`
- `audit aliases: mixed predecessor names resolve through the public alias table`

### P1-2

Resolve the common slot/context identity graph before fan-out; share P/research link decisions and derive diagnostics from actual materialized views.

Locations: `evaluation/hr3/harness/runner.mjs:69`, `evaluation/hr3/harness/research.mjs:112`, `evaluation/hr3/harness/research.mjs:126`, `evaluation/hr3/harness/product.mjs:83`.

Regression tests:

- `audit common links: shared-turn context ambiguity is identical in T/U/O and P diagnostics`
- `audit context coverage: certificates exercise adopted, unresolved and shared-turn context branches`
- `audit research diagnostics: unresolved context and overwrite dispositions match materialized state`

### P1-3

Use delivered receipt-array positions for scorer addresses; retain original receipt indices only as metadata; preserve P blocks.

Locations: `evaluation/hr3/harness/product.mjs:214`, `evaluation/hr3/harness/product.mjs:220`.

Regression tests:

- `audit P addresses: omitted original receipt indices and sameAs aliases use delivered positions without changing blocks`

### P1-4

Validate all 13 bound preflight requirements, full analysis results and primary-supplied passing review before journal/dispatch; reject synthetic reviews and non-boolean resource claims.

Locations: `evaluation/hr3/harness/runner.mjs:47`, `evaluation/hr3/harness/paid-preflight.mjs:21`, `evaluation/hr3/harness/paid-preflight.mjs:8`, `evaluation/hr3/harness/paid-requirements-a4.mjs:3`.

Regression tests:

- `audit paid gate: missing preflight cannot open a journal or dispatch`
- `paid-preflight complete synthetic interchange reaches review boundary and cannot produce readiness`
- `paid-preflight semanticInventory missing blocks journal creation and dispatch`
- `paid-preflight semanticInventory stale blocks journal creation and dispatch`
- `paid-preflight output missing blocks journal creation and dispatch`
- `paid-preflight output stale blocks journal creation and dispatch`
- `paid-preflight requests missing blocks journal creation and dispatch`
- `paid-preflight requests stale blocks journal creation and dispatch`
- `paid-preflight embeddings missing blocks journal creation and dispatch`
- `paid-preflight embeddings stale blocks journal creation and dispatch`
- `paid-preflight privacy missing blocks journal creation and dispatch`
- `paid-preflight privacy stale blocks journal creation and dispatch`
- `paid-preflight conformance missing blocks journal creation and dispatch`
- `paid-preflight conformance stale blocks journal creation and dispatch`
- `paid-preflight allocation missing blocks journal creation and dispatch`
- `paid-preflight allocation stale blocks journal creation and dispatch`
- `paid-preflight accounting missing blocks journal creation and dispatch`
- `paid-preflight accounting stale blocks journal creation and dispatch`
- `paid-preflight analysisCoverage missing blocks journal creation and dispatch`
- `paid-preflight analysisCoverage stale blocks journal creation and dispatch`
- `paid-preflight resources missing blocks journal creation and dispatch`
- `paid-preflight resources stale blocks journal creation and dispatch`
- `paid-preflight freshRun missing blocks journal creation and dispatch`
- `paid-preflight freshRun stale blocks journal creation and dispatch`
- `paid-preflight freeze missing blocks journal creation and dispatch`
- `paid-preflight freeze stale blocks journal creation and dispatch`
- `paid-preflight review missing blocks journal creation and dispatch`
- `paid-preflight review stale blocks journal creation and dispatch`
- `paid-preflight output stale source binding independently blocks before journal`
- `paid-preflight requests stale source binding independently blocks before journal`
- `paid-preflight privacy stale source binding independently blocks before journal`
- `paid-preflight embeddings stale source binding independently blocks before journal`
- `paid-preflight analysisCoverage stale source binding independently blocks before journal`
- `paid-preflight analysis result missing cannot open journal or dispatch`
- `paid-preflight analysis result stale cannot open journal or dispatch`
- `paid-preflight analysis result reduced-grid cannot open journal or dispatch`
- `paid-preflight analysis result stale-implementation cannot open journal or dispatch`
- `paid-preflight altered frozen analysis baseline blocks journal and dispatch`
- `paid-preflight unperformed resource strings cannot count as completed benchmarks`

### P1-5

Freeze the import closure, real runner, pinned product and installed dependencies; cross-check graphs/inventories independently and include external bytes in certificate bindings.

Locations: `evaluation/hr3/harness/runtime-closure.mjs:3`, `evaluation/hr3/harness/runtime-closure.mjs:19`, `evaluation/hr3/harness/freeze-a4.mjs:7`.

Regression tests:

- `audit freeze closure: graph and independent loader include scorer, real runner and pinned product dependencies`
- `audit freeze closure: external dependency bytes participate in every certificate binding`
- `paid-preflight freeze missing dependency evaluation/hr3/scorer/slots.mjs blocks before journal`
- `paid-preflight freeze missing dependency evaluation/hr3/scorer/contract.mjs blocks before journal`
- `paid-preflight freeze missing dependency evaluation/hr3/runner/openai-transport.mjs blocks before journal`
- `paid-preflight freeze missing dependency core/context-read-assembly.mjs blocks before journal`

### P2

Recursively derive private authoring fields against explicit public paths/schema bindings; scan complete extraction bodies before cache/transport and in certification/leak scans.

Locations: `evaluation/hr3/harness/private-field-inventory.mjs:19`, `evaluation/hr3/harness/public-paths-a4.mjs:6`, `evaluation/hr3/harness/extraction.mjs:10`, `evaluation/hr3/harness/request-certification.mjs:47`, `evaluation/hr3/harness/leak-scan.mjs:31`.

Regression tests:

- `audit recursive privacy: independent authoring injection 0`
- `audit recursive privacy: independent authoring injection 1`
- `audit recursive privacy: independent authoring injection 2`
- `audit recursive privacy: independent authoring injection 3`
- `audit extractor privacy: complete body is scanned before cache or transport`

## Frozen-reference unresolved links

A replay of the frozen pilot reference extraction counts every update with predecessor anchors, before branch materialization. All 120 updates are retained in the denominator.

| Language | Before unresolved/updates | After unresolved/updates |
|---|---:|---:|
| English | 0/36 | 0/36 |
| Chinese | 66/66 | 0/66 |
| Mixed | 18/18 | 0/18 |

[Before](reports/a4-audit-links-before.json) / [after](reports/a4-audit-links-after.json). Canonicalization uses the published public table for both event and anchor names; no inferred identity, case-specific repair or source harvesting is added.

## Context and diagnostic certification

[Reference property](reports/a4-audit-context-property.json): all **960** frozen/reference contexts are authored `commitment: unresolved` unsupported-cause distractors: 240 pilot plus 720 independent stress contexts. **Zero adopted reference context is a generator/fixture property**, not an admission bug. Generator gold and source allocations remain unchanged.

[Independent context certificate](reports/context-certification-a4.json): **9** language × context-mode cases; **6 adopted contexts**, **3 unresolved contexts**, **3 shared-turn ambiguities**, and **6 actual P adopted-context writes**. Both extractors and all four readers contribute **72 complete body/output checks**. Declared unresolved context remains queryable in research and is filtered by P; common identity decisions agree before those eligibility differences. Actual per-arm materialized views and outcomes are recorded. In particular, unresolved commitments are not mislabeled as filtered, and O's overwritten records are labeled not_materialized.

The P citation regression uses the pinned assembler itself to omit an oversized first receipt and retain original index 1 at delivered position 0, plus sameAsBody and sameAs aliases. Every public-position citation resolves and both returned blocks remain byte-identical.

## Paid preflight and freeze closure

[Requirement catalog and interchange](PAID-PREFLIGHT-A4.md), [machine catalog](reports/paid-requirements-a4.json), and paid-requirements-a4.mjs enumerate **13** requirements with exact clause citations: semantic inventory, output, complete requests, embeddings, privacy, conformance, allocation/fresh seed, cumulative accounting, analysis/coverage, resources, one fresh run, freeze and non-author review.

Authority: A-4 status and §§2–8; A-4 §5 analysis adapters and §9 final paragraph; A-4.1/4.2 review/cap amendments; A-1's retained non-adjudication requirements; protocol §§12,13.4–5,15–16. A-1 waives calibration ordering and pilot sampling CIs, not analysis or resource validation.

The analysis record must bind its implementation and result manifest, retain the full **60-cell power grid and 12-cell coverage grid**, **2,000 datasets/cell**, **10,000 corrected draws/dataset**, lineage sensitivity, paired/shared draws, variance/covariance, direct/count parity, ICC, boundaries, Monte Carlo uncertainty and reviewed undercoverage. Frozen allocations, seed, weights, baseline/effects/discordance/ICC and decision/guard thresholds are checked against the published design. Missing, stale, reduced and changed designs fail before journal creation. Resource flags must be completed Boolean assertions; strings such as unperformed cannot pass.

Every real transport must supply the complete hash-bound record before `new Ledger` or dispatch. Each requirement's missing/stale variant is tested independently with zero journal and zero dispatch. Additional tests cover stale certificate sources, analysis manifests/implementation, reduced grids, changed baseline, missing closure members and the synthetic review boundary. The record is bound to one empty output directory and fixed 240-extraction/480-reader plan. No attestation writer or automatic readiness producer is provided.

[Runtime closure](reports/runtime-closure-a4.json): **195 repository modules** agree exactly between Node resolver/load observation and independent SourceTextModule traversal (including literal dynamic imports). The paid CLI's entry bytes/imports are bound without evaluating it or reading a key. All real-runner modules, runtime scorer/generator imports, pinned product modules and support files are included. **1480 files** participate in certificate fingerprints, including **1240 installed dependency files**. The external inventory separately agrees between a Dirent walk and native recursive readdir/stat enumeration. The primary-only freeze script binds these complete bytes and verifies current certificates; it was **not run**.

## Certificates and budget

[Request certificate](reports/request-certification-a4.json): **4994** pilot/engineering requests plus the **72** independent context checks; every row passes the 5% headroom gate. Both extraction models are scanned, including complete instructions/schema/contract/source bodies. Extraction worst **18409/20,480**, margin **10.1123%**. No cap or other numerical limit changed; no evidence was truncated.

| Reader | Main certificate requests | Worst reservation | Ceiling | Headroom |
|---|---:|---:|---:|---:|
| T | 961 | 29343 | 40960 | 28.3618% |
| U | 961 | 30167 | 40960 | 26.3501% |
| O | 960 | 28022 | 32768 | 14.4836% |
| P | 192 | 35193 | 40960 | 14.0796% |

Output caps pass: extraction **2,241/4,352 tokens (48.5064% headroom)**; reader **1,774/2,176 (18.4743%)**. Independent context outputs also pass ≥10%. These are pilot/engineering grammar/reference certificates; future replacement banks and arbitrary schema-valid padding are not claimed covered.

[Embedding certificate](reports/embedding-certification-a4.json): max input **1220/8,192**, max request **3379/300,000 units**, body **3798/2,097,152 bytes**. Cumulative fixture projections, including pilot3 counters and conservative failures, are research **62,757,367/64M** and P **23,605,774/64M**. Dynamic stops remain; replacement banks require recertification.

Privacy inventory: **93 fields / 474 variants**. Every AST/control/expected object is traversed; public collisions have explicit closed-model-schema or pinned public-operation field bindings. Validated public-contract removal is justified by exact deterministic reprojection. No authoring subtree is exempt. Independently enumerated authoring injections, including distractor:unsupported_cause, reject. Complete request scans report zero hits.

[Budget](reports/budget-a4.json) and continuation are regenerated: carried exposure **$2.136861040**, incremental ceiling with entire fresh embedding allowance **$28.119040000**, cumulative gate with remaining allowance **$30.232574300 ≤ $50**. Historical journals, accounting input/fixtures and original carry-forward manifest remain unchanged. Continuation remains **$282.003200**, nonbinding pending actual paid A-4 usage and later-stage prerequisites. Global/stage/embedding/retry limits are unchanged. Fake usage never enters real accounting.

## Verification and actual exit codes

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0**, **PASS_OFFLINE_PENDING_PRIMARY_FREEZE**. [Ordered machine record](reports/a4-verification.json); artifacts `evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4`. Every child exit is read back from its separate .exit file; logs, source hashes and current full-closure bindings are verified.

| Suite | Pass/total | Fail | Exit |
|---|---:|---:|---:|
| generator-tests | 43/43 | 0 | 0 |
| scorer-tests | 52/52 | 0 | 0 |
| integration-tests | 20/20 | 0 | 0 |
| harness-tests | 269/269 | 0 | 0 |

| Ordered command | Exit | Invocation |
|---|---:|---|
| strict-schema | 0 | `node evaluation/hr3/harness/strict-schema.mjs` |
| published-schemas | 0 | `node evaluation/hr3/harness/schemas-a4.mjs` |
| private-field-inventory | 0 | `node evaluation/hr3/harness/private-field-inventory.mjs` |
| inspected-references | 0 | `node evaluation/hr3/harness/inspected-references.mjs` |
| runtime-closure | 0 | `node evaluation/hr3/harness/runtime-closure.mjs` |
| context-certificate | 0 | `node evaluation/hr3/harness/context-certification.mjs` |
| cap-certificate | 0 | `node evaluation/hr3/harness/cap-certification.mjs` |
| request-certificate | 0 | `node evaluation/hr3/harness/request-certification.mjs` |
| accounting | 0 | `node evaluation/hr3/harness/accounting-a4.mjs` |
| projection-schema | 0 | `node evaluation/hr3/harness/projection-schema.mjs` |
| budget | 0 | `node evaluation/hr3/harness/budget-a4.mjs` |
| continuation-projection | 0 | `node evaluation/hr3/harness/continuation-a4.mjs` |
| generator-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` |
| scorer-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/scorer/test/canonical.test.mjs evaluation/hr3/scorer/test/citations.test.mjs evaluation/hr3/scorer/test/contract.test.mjs evaluation/hr3/scorer/test/schema-cli.test.mjs evaluation/hr3/scorer/test/scorer.test.mjs` |
| integration-tests | 0 | `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` |
| harness-tests | 0 | `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/inputs --out evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/pilot evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/inputs --out evaluation/hr3/harness/artifacts/a4-verification-Rvw2G4/bounds.json` |
| certification-bundle | 0 | `node evaluation/hr3/harness/certification-bundle-a4.mjs` |

Full fake pilot: **480/480**, **240 extractions**, **120 schema-valid answers/arm**, no stop. [Complete leak scan](reports/privacy-scan-a4.json): **PASS**, **240/240 extraction bodies**, **480/480 reader bodies**, **1747 P payloads**, **zero hits**, zero missing requests, P blocks unchanged; exit 0. Bound report exit 0: **480 planned/attempted/valid**, **0 unexecuted**, **60 families/30 lineages**. Label: **Uncalibrated engineering pilot — mechanical score bounds; no adjudication.** No calibrated accuracy, pooling or Advance/Keep decision.

The baseline regressions genuinely failed before correction:

| Red evidence | Pass/total | Fail | Exit |
|---|---:|---:|---:|
| a4-audit-red.tap | 0/12 | 12 | 1 |
| a4-audit-paid-red.tap | 1/40 | 39 | 1 |
| a4-audit-external-red.tap | 0/1 | 1 | 1 |
| a4-audit-diagnostics-red.tap | 0/1 | 1 | 1 |
| a4-audit-resource-red.tap | 0/1 | 1 | 1 |

The committed-runner red probe used local stubs and restored the fixed runner byte-for-byte. No real calls occurred. The first external inventory attempt hit sandbox EPERM for spawning find; native filesystem enumeration replaced it and passed. Other intermediate runs exposed the legacy control/snapshot expectations and invalidated source bindings while hardening continued. They remain preserved; failures were not discarded or converted to passes. The final full run above is on the settled code.

Retained ordered-run exits:

- `a4-audit-verify-certified.exit`: exit **0**.
- `a4-audit-verify-complete.exit`: exit **1**.
- `a4-audit-verify-final.exit`: exit **1**.
- `a4-audit-verify-finalized.exit`: exit **0**.
- `a4-audit-verify-release.exit`: exit **1**.
- `a4-audit-verify.exit`: exit **1**.

The original audit checked **25** changed JavaScript modules; A-1.1 additionally rechecks its **10** changed JavaScript modules, each `node --check` exit 0. Postflight also checks `git diff --check`, authored whitespace, absolute-path portability, exact certificate/source/log bindings, original accounting bytes and manifest equality. Only new diagnostic logs are path-normalized; raw scientific inputs, requests, returned P blocks, answers, states, caches and journals are unchanged. Pre-existing verification archives are preserved byte-for-byte.

## Original audit-repair changed files (before A-1.1)

[Historical two-route manifest](reports/a4-audit-changes.json): **13914** changed/new files, including retained ignored verification artifacts; **115** Git-visible and **13799** retained ignored files. Git tracked diff plus all untracked paths (including ignored) is compared with an independent recursive content-hash baseline. Exact set equality, exit **0**. No generator/scorer/real-runner/product source or gold/test edits. All repository writes are within evaluation/hr3/harness/; no commit. Freeze remains with the primary.

## A-1.1 prospective sequencing amendment

Read A-1.1 in errata.md. Non-author confirmation is still pending; this repair creates no approval or supervision attestation. The v2 paid-preflight catalog is selected by stage. Pilot omits analysisCoverage and adjudication/subscription resources (A-1.1); development/test preserve their exact source/result/design/workload and resource validations. Existing held-out execution restrictions remain. Every applicable requirement retains independent missing/stale, no-journal/no-dispatch regressions; development/test keep missing/stale/reduced-grid/stale-implementation analysis tests.

Pilot-required IDs and authority: semanticInventory (A-4 status, §7.1); output (A-4 §4, §7.3, §8, A-2); requests (A-4 §2, §7.3, §8, A-4.1/4.2); embeddings (A-4 §7.3, §8); privacy (A-4 §2, §7.3, A-3); conformance (A-4 §§3,5,6, §7.3); allocation (A-4 §2, §7.5, A-2); accounting (A-4 §7.4, §8, A-4.1/4.2); supervision (A-1.1, protocol §15); freshRun (A-4 §7.6, §8, A-1); freeze (A-4 status, §7.2, protocol §13.5); review (A-1.1 confirmation, A-4 status, §7.1, A-4.1/4.2 Review, protocol §16). See PAID-PREFLIGHT-A4.md and the regenerated catalog for all clauses and interchange details.

| Stop / supervision duty | Enforcement | Regression |
|---|---|---|
| Attended execution; checks at least every minute | Primary-supplied completed strict boolean record; never authored by production code. Runner also starts a 60-second watchdog with accounting/progress callback. | A-1.1 supervision field tests; supervisor checks actual progress each minute |
| Three transport failures | Durable cumulative ledger count; third failure stops, one retry maximum. | one transport retry, cumulative third failure stops, no quality retries |
| Five minutes without progress | Watchdog between dispatches and during pending dispatch; aborts active request. Pre/post dispatch checks prevent delayed replies from resetting the clock. | A-1.1 supervisor tests; five-minute elapsed dispatch test |
| Accounting mismatch | Full hash-chain/config/carry validation before journal and each guarded dispatch; corruption blocks dispatch and preserves damaged evidence. | A-1.1 accounting corruption stops before any dispatch and preserves evidence |
| Model mismatch | Guard rejects before settlement and persists stop. | model mismatch, unexplained usage, duplicate provider IDs and unknown contract failures stop |
| Unexplained usage | Ledger requires unique provider ID and integer usage within reservation; full unknown reservation remains carried. | same ledger usage regression; inherited provider-ID regression |
| Authorization exposure | Reservation gate enforces stage, cumulative, embedding, $450 operational/$500 authorization with unavailable $50 headroom; P exposure hook stops. | stage, operational and unavailable authorization headroom deny before dispatch; P budget regressions |

Pilot bounds contain no confidence intervals, bootstrap estimates or contrasts with uncertainty. The builder rejects nested inferential metadata, and the standalone report is checked recursively. Mechanical identification bounds retain unresolved cases. A blocked event loop is checked when it resumes; mechanical callbacks do not establish human attendance.

A-1.1 final verification: `node evaluation/hr3/harness/verify-a4.mjs` **exit 0**, all **21** ordered child commands **exit 0**. Generator **43 pass / 0 fail**, scorer **52 / 0**, integration **20 / 0**, harness **269 / 0**, each exit **0**. The 119-case preflight matrix includes independent missing/stale checks for all 12 pilot and 14 development/test requirements; analysis source/result missing/stale/reduced-grid/stale-implementation and unchanged-baseline/resource-boolean tests remain enforced for both later stages. Ten new mechanical/report cases complement the expanded preflight matrix; [exact names](reports/a11-regressions.json).

The standalone fake pilot completed **240 extractions / 480 answers**, **120 valid per arm**, with no stop. Complete leak scan **exit 0**: **240 extraction requests, 480 reader requests, 1,747 P payloads**, **zero missing / zero hits**, returned P blocks unchanged. Bound report **exit 0**; recursive inspection of the actual report found no inferential estimates. [Postflight](reports/a11-postflight.json) verifies every child .exit file, all log hashes, eight certificates' source and runtime bindings, and absent paid readiness. Both output/input headroom gates, embedding limits and cumulative accounting were recertified without numerical changes. Cumulative pilot bound remains **$30.232574300 ≤ $50**.

Focused mechanical/report tests: **52 pass / 0 fail, exit 0**. An initial standalone preflight run before accounting recertification produced **2 pass / 115 fail, exit 1**, all blocked by the stale budget gate and dispatched nothing; the complete ordered run regenerated accounting/budget first and all 119 current preflight tests passed. This failure is retained in a11-preflight.tap and is not presented as a successful test. Ten syntax commands, portable-diagnostic normalization, certificate rebinding and `git diff --check` each exited **0**. Only one newly generated diagnostic log had workspace prefixes removed; scientific artifacts and previous archives remain unchanged.

Implementation locations: stage catalog `paid-requirements-a4.mjs:12` and `:21`; conditional analysis/resource checks `paid-preflight.mjs:38`; strict primary supervision record `paid-preflight.mjs:45`; A-1.1 review binding `paid-preflight.mjs:52`; runner pre-journal gating `runner.mjs:44`, watchdog start/cleanup `runner.mjs:56`; watchdog and guarded checks `transport.mjs:12`; descriptive-only report enforcement `bounds.mjs:56`. Existing durable failure/usage/exposure stops remain at `ledger.mjs:66`, `:76`, `:81`.

A-1.1 changed files: see [two-route delta manifest](reports/a11-changes.json). **2342 changed/new files** relative to task entry: **42 Git-visible**, **2300 ignored retained artifacts**, including **13 authored source/document/test files**. Git tracked differences plus all untracked paths (including ignored), filtered by the entry snapshot, exactly match an independent recursive content-hash inventory; exit **0**. All **52470** pre-existing artifact files are byte-identical. The 13 authored source/document/test changes are PAID-PREFLIGHT-A4.md, README.md, REPORT-A4-AUDIT.md, bounds.mjs, certification-bundle-a4.mjs, cli.mjs, paid-preflight.mjs, paid-requirements-a4.mjs, runner.mjs, transport.mjs, test/bounds.test.mjs, test/ledger.test.mjs and test/paid-preflight.test.mjs. Regenerated certificates/reports and retained verification artifacts are included, including ignored files. No files outside harness were written; the primary's errata amendment was already present at task entry. No network, key access, paid calls or commit; freeze and primary attestations remain pending.
