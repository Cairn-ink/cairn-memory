# A-4 / A-4.1 / A-4.2 harness and integration — offline verification passed

The runtime migration and all **18 ordered offline gates pass**, root exit **0**. Reader reservations are **40,960 for T/U/P and 32,768 for O**; extraction remains **20,480**, outputs **4,352/2,176**. No other limit changes. The supplemental accounting chain is verified and consumed by budget/run gating. No network, key access, paid call or commit occurred. **Freeze is left to the primary**; this is not paid readiness or a calibration decision.

P: **Pinned product + frozen public-operation agent + shared research extraction + slot reader.** This evaluates product operations under shared extraction, not native capture/extraction accuracy.

## Clause mapping

| Authority | Implementation and evidence |
|---|---|
| A-4 §2 | requests.mjs sends deterministic complete public-contract projections to extraction and reader. contract-projection-a4.mjs retains all relevant slots, aliases, labels, unit/scope/update rules and independent examples. Reader projections use common public family/question context before arm fan-out. No gold-assisted selection or source truncation. |
| §3 | preflight-a4-schema.mjs / schema.mjs replace model-authored masks and graphs with slot assignments and flat quoted reasons. Core metadata failures exclude events; assignment and quotation admission remain independent. Derived masks follow admitted assignments. Non-slot context must be anchored and cannot update slots. Exact source-turn/quotation/occurrence anchors compute UTF-16 offsets. Diagnostics retain overlapping exclusion reasons and batch failures before fan-out. |
| §3 policy behavior | research.mjs preserves T inheritance and U/O whole-version updates, including entire replacement/expiry clearing of inherited fields. Versioned reference states and independent integration witnesses cover partial updates, missing anchors, context and invalid-quote isolation. |
| §4 | Active reader schema is the scorer's closed current/old slot rows plus selected explanation quotations. Requested predecessor identities, labels, scope and source-claimed intervals are preserved. No generated reason graph, prior answer, archive or fallback is delivered. |
| §5 | inputs.mjs keeps private causal/support structures in scoring only; bounds.mjs preserves within-family J, partial denominators, not_stated strata and support-not-applicable accounting. No statistical decision or adjudication rule changes. |
| §6 | research.mjs and product.mjs compact supplied fields and distinct admitted quotations with provenance. No predecessor prose reconstruction, new evidence archive, residual-scope merge or rejection fallback. P uses existing public operations and maxTokens:2000 current/history retrieval, with actual returned blocks preserved. Logs cover exclusions, missing/nonunique/incompatible anchors, eligibility, operation refusal and scheduled expiry. |
| §7 | A-4 cache/schema/journal/run/artifact versions and source hashes remain active; requests and budget have A-4.2 versions. Fresh fake stores/caches are isolated. Historical journals and original carry manifest are unchanged. Published schemas, output/body/embedding/privacy certificates and ordered verification are regenerated. freeze-a4.mjs includes harness and active integration files and remains primary-only. |
| §8, A-4.1, A-4.2 | Only the authorized extraction/reader input ceilings change. Output caps and 10%/5% gates remain. New pilot journals enforce the $50 cumulative cap, carrying complete exposure and embedding counters. $450 operational / $500 authorization / $50 unavailable headroom, 64M units/channel, one transport retry and no quality retry remain. |
| §10 integration row | adapters.mjs / field-map.mjs accept A-4 slot answers and explicit authored delivery plans, join private causal gold, validate exact source spans and restore complete audit inputs. No legacy graph-answer conversion. Independent source→admission→policy→delivery and actual P-operation witnesses exercise the new admitted shapes. Generator/scorer gold and tests are unchanged. |

The superseded challenge candidates are explicitly rejected by the A-4 adapter. Their owner must supply calibration v2; historical label strata in synthetic integration gate tests check arithmetic only and do not qualify calibration v2. Diagnostic gold witnesses deliver only licensed causal spans and select complete paths/unions; they never enter live extraction, policy, P or reader execution. All 120 frozen pilot checkpoints validate and earn full credit under that restricted witness delivery. Extra unrelated delivered context correctly leaves support for adjudication in independent tests.

## Certifications

[Complete-request certificate](reports/request-certification-a4.json): **4994** complete provider requests across **240** pilot/engineering families: 1,920 extraction requests (both models), 2,880 research reader requests, 192 actual P reader requests, two auditor regressions. Reservation includes the entire provider-body UTF-8 bytes plus 4,096 framing units: prompts, schema, contract, question, both delivered intents and addresses. **Every row passes the 5% gate.**

| Reader | Requests | Max body bytes | Max reservation | Ceiling | Headroom | Failing requests |
|---|---:|---:|---:|---:|---:|---:|
| T | 961 | 25235 | 29331 | 40960 | 28.3911% | 0 |
| U | 961 | 29430 | 33526 | 40960 | 18.1494% | 0 |
| P | 192 | 31197 | 35293 | 40960 | 13.8354% | 0 |
| O | 960 | 23926 | 28022 | 32768 | 14.4836% | 0 |

Extraction worst: **18409/20,480**, **10.1123%** headroom. P identities/selections can vary across fresh stores; this certifies observed full bodies and their hashes, not every ranking or future replacement bank. No evidence or public requirement was truncated or omitted.

[Output certificate](reports/cap-certification-a4.json): extraction **2,241/4,352 tokens, 48.5064% headroom**; reader **1,774/2,176, 18.4743%**. Both pass ≥10%. Strict provider schemas pass (extraction 86 nodes/16 closed objects; reader 69/18). These are grammar/reference-structure certificates, not bounds over arbitrary schema-valid padding or future banks.

Embeddings: **10530** measured offline requests; per-input max **1220/8,192**, per-request max **3362/300,000 units**, complete body **3794/2,097,152 bytes**. Complete third-pilot counters are now included: research **954,729**, P **211,608**. Conservative fixture projections: research **63,593,693/64M** and P **23,605,774/64M**. These include largest measured family × full remaining family allocation and two conservative transport-failure reservations; replacement banks still require recertification. Dynamic counters remain cumulative hard stops.

Privacy: complete-request certificate **0 hits**. Private-field inventory **60 fields / 312 naming variants**, **6,360** injection checks with **0 missed**. Public-contract keys are exempt only at that boundary after exact deterministic reprojection. The complete final pilot scan below also passes.

## Budget and continuation

[Budget](reports/budget-a4.json): **PASS_CUMULATIVE_PILOT_BOUND**; [accounting](reports/accounting-a4.json): **COMPLETE_VERIFIED_CHAIN**. All amounts are exact integer nanodollars at frozen rates; owner-rounded spending is never substituted for exposure.

| Item | Bound |
|---|---:|
| Carried settled | $2.102137440 |
| Carried outstanding, reserved in full | $0.034723600 |
| **Total carried exposure** | **$2.136861040** |
| 480 extraction attempts | $7.274496000 |
| 960 reader attempts at amended arm ceilings | $18.284544000 |
| Entire fresh 128M embedding allowance (conservative illustration) | $2.560000000 |
| Incremental maximum with entire allowance | $28.119040000 |
| **Cumulative, carry plus entire fresh allowance** | **$30.255901040** |
| Remaining embedding allowance after carried counters | $2.536673260 |
| **Actual cumulative planning gate with remaining allowance** | **$30.232574300 ≤ $50** |

The original a3-carry-forward.json remains SHA-256 **8a133069ea1851e49f75db199253ec3a5576be33ac58ff0a089afffe24745e28**. The separate supplemental manifest is **f110569bb55808e6f40e6cc5dec8d5ca1a91d9e64eb74f25336b6a293cdf92b6**. It merges the hash-pinned pilot3 chain exactly once and leaves historical ledgers/configurations and primary-supplied fixtures unchanged. Real run gating re-verifies complete accounting and exact regenerated budget/source hashes before opening a journal; the old carry is rejected. The final fake pilot also uses the supplemental manifest, while its new usage remains explicitly simulated.

[Continuation](reports/continuation-a4.json) is regenerated: **$282.003200**, nonbinding, status **PENDING_PAID_A4_USAGE**. Complete historical accounting is satisfied; actual paid A-4 pilot usage, review/freeze and the binding ≤$400 total-completion projection remain future prerequisites. Stage limits stay $50/$46/$345/$45; they are independent stops, not simultaneous allocations (sum $486). The global $450 stop binds; disclose allocations within $450 before development. No later-stage ceiling increases. The old full-$24 carry illustration would now exceed $50 and is not the actual gate.

## Full ordered verification

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0**, **PASS_OFFLINE_PENDING_PRIMARY_FREEZE**. [Machine record](reports/a4-verification.json); artifacts: `evaluation/hr3/harness/artifacts/a4-verification-Uhgv95`. All 18 actual child exits are cross-checked against their separate .exit files; source/log hashes are verified.

| Suite | Pass/total | Fail | Exit |
|---|---:|---:|---:|
| generator-tests | 43/43 | 0 | 0 |
| scorer-tests | 52/52 | 0 | 0 |
| integration-tests | 20/20 | 0 | 0 |
| harness-tests | 126/126 | 0 | 0 |

| Ordered step | Exit | Exact command |
|---|---:|---|
| strict-schema | 0 | `node evaluation/hr3/harness/strict-schema.mjs` |
| published-schemas | 0 | `node evaluation/hr3/harness/schemas-a4.mjs` |
| private-field-inventory | 0 | `node evaluation/hr3/harness/private-field-inventory.mjs` |
| inspected-references | 0 | `node evaluation/hr3/harness/inspected-references.mjs` |
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
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/inputs --out evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/pilot evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/inputs --out evaluation/hr3/harness/artifacts/a4-verification-Uhgv95/bounds.json` |

The generator/scorer tests run unchanged; a harness import hook redirects only their scratch directories into harness/artifacts. **No generator/scorer gold or test files were edited.**

Final fake pilot: **480/480** answers, **240** shared extraction attempts, all four arms **120/120 schema-valid**, complete and no stop. The intentionally weak source-only fake produces **148 admitted / 92 excluded events**, **288 admitted / 132 excluded assignments**, **0 batch failures**. These are retained extraction errors, not quality retries or a semantic accuracy floor.

[Complete leak scan](reports/privacy-scan-a4.json): **PASS**, **480/480** exact reader requests, **0 missing**, **0 reader hits**, **1747 P payloads / 0 hits**; actual P returned context unchanged. Every arm has 120 requests and zero hits. Exit **0**.

Bound report: exit **0**; **480 planned/attempted/valid completions**, **0 failed attempts**, **0 unexecuted**, **60 families / 30 lineages**. Label: **Uncalibrated engineering pilot — mechanical score bounds; no adjudication.** No adjudication, score pooling, calibrated accuracy or Advance/Keep claim.

Earlier retained checks: standalone request certification exit 0; integration migration iterations exited 1 (13/18) then 0 (18/18), and the added pipeline witness initially exited 1 (19/20) before correcting its operation-log expectation. Focused audit recheck passed 11/11, exit 0. The first ordered A-4.2 run exited 1 on two stale harness expectations (124/126): the obsolete O ceiling and a zero-exclusions assumption about the weak fake. Its complete fake pilot/leak/bound steps already exited 0. Both test expectations were corrected, with no runtime admission relaxation, and the full ordered sequence above was rerun. Failed run records and actual exits are preserved in artifacts/a4-verification-kXWHqr/verification.json and the corresponding logs.

All **51** changed JavaScript modules pass `node --check`, exit 0. Final postflight records whitespace, portability, certificate/source/log hashes and mechanically cross-checked file lists. Its first publication check exited 1 on legacy absolute temporary-path examples in the modified integration README; those examples were made repository-relative before the passing recheck. Only newly generated diagnostic logs have workspace-root prefixes removed; raw inputs, provider bodies, P blocks, caches, states and journals are unchanged. Before/after diagnostic hashes are retained.

Freeze was **not run**. The primary runs `node evaluation/hr3/harness/freeze-a4.mjs`; it rejects failed verification, stale certificate hashes or incomplete accounting, and includes active integration sources.

## Changed files

[Mechanical manifest](reports/a42-changes.json): **5295** cumulative candidate files, including retained verification artifacts; **4631** changed/new files in this continuation. Git-visible vs ignored counts and unchanged primary-supplied accounting inputs are separately identified. Git tracked diffs plus untracked paths (including ignored retained artifacts) are compared with independent recursive filesystem/content hashes and HEAD blob hashes. Exact set equality, exit **0**. The previous A-4 manifest is retained unchanged.

All repository writes in this continuation are inside **evaluation/hr3/harness/** or **evaluation/hr3/integration/**. The primary-owned protocol/errata.md change is pre-existing and outside this delivery. No commit was made.
