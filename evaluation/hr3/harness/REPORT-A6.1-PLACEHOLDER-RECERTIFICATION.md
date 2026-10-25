# A-6.1 placeholder inventory — certificates pass; harness suite stops verification

This fresh recertification ran directly and **unlocked**, as authorized. The primary owns the locked rerun, audit and freeze. No network, key, paid call, new paid reservation, freeze or commit. No ceiling, model, margin, retry, call-plan or budget rule changed.

## Inventory fix and regressions

`private-field-inventory.mjs:19` derives all 22 placeholder identifiers mechanically from the actual exported generator template bank using the renderer grammar. The report hash-binds `generator/bank.mjs`. At `:27` only the exact private support path `optional_trivia.emission_inputs[].variables` treats those identifiers as map keys. Unknown names throw `undeclared_template_placeholder`; every value is still recursively visited at `:31`, including nested objects and arrays. Values remain private and the existing value scans are unchanged. No formatter or public-path allowance changed; there is no blanket `record` exemption.

The regenerated inventory contains 205 private fields (previously 217). The removed names occurred as declared placeholder identifiers, not private metadata fields. `record` outside that exact map path, including a nested value object, is still inventoried.

Four tests in `test/placeholder-inventory-a6.test.mjs` passed independently and within the full harness suite:

- `:11` P formatter record alias passes without public-path exemptions.
- `:17` A real private family identifier under every formatter header key is rejected.
- `:23` Undeclared map keys fail closed; nested private value metadata under each of the 22 declared keys is still inventoried.
- `:32` Genuine record metadata outside the placeholder-map keys is inventoried.

The 12 authenticated expected-case consumer regressions also pass. No declared-offset licensing fallback was introduced.

## Actual commands and exits

`node evaluation/hr3/harness/verify-a6.mjs` exited **1** and stopped at `harness-tests`. Artifact directory: `evaluation/hr3/harness/artifacts/a61-placeholder-verification-o3kJZH`. `reports/a6-verification.json` records every exact command, child exit and diagnostic hash. All diagnostic hashes were checked again.

| Step | Result | Exit |
| --- | --- | ---: |
| strict-schema | PASS | 0 |
| published-schemas | PASS | 0 |
| private-field-inventory | PASS | 0 |
| inspected-references | PASS | 0 |
| runtime-closure | PASS | 0 |
| placeholder-inventory-tests | 4 passed / 0 failed / 0 skipped | 0 |
| authenticated-consumers | 12 passed / 0 failed / 0 skipped | 0 |
| context-certificate | PASS | 0 |
| output-certificate | PASS | 0 |
| input-feasibility | PASS | 0 |
| request-embedding-certificate | PASS | 0 |
| accounting | PASS | 0 |
| projection-schema | PASS | 0 |
| budget | PASS | 0 |
| continuation-projection | PASS | 0 |
| generator-tests | 62 passed / 0 failed / 0 skipped | 0 |
| scorer-tests | 100 passed / 0 failed / 0 skipped | 0 |
| integration-tests | 26 passed / 0 failed / 0 skipped | 0 |
| harness-tests | 369 passed / 2 failed / 0 skipped | 1 |

## First failing gate

The harness suite finished with **369 passed, 2 failed, 0 skipped** (371 tests), exit 1. Both failures are stale test assumptions:

- `test/a4.test.mjs:97`: `A6 runtime requires the fourth-pilot chain and a primary preparation completeness record` expects the real A-6 carry to throw `a6_preparation_completeness_required`. The primary has since supplied that completeness record, and current accounting correctly accepts it. The test fails with “Missing expected exception.”
- `test/a3-audit.test.mjs:116`: `complete request certificate covers auditor U/T requests, all provider framing and maximal structures` loads preserved `request-certification-a4.json` (E=20,480, R=40,960) and compares it to active A-6.1 constants (E=40,960, R=57,344). The historical evidence has not been rewritten.

Per the stop-at-first-failure instruction, neither test was changed or rerun after the suite failed. The next work would isolate missing/stale preparation cases in independent fixtures and compare historical certificate limits against historical authority, while keeping active A-6.1 certification separate. The standalone 480-answer fake pilot, complete pilot leak scan, bound report, reconciliation and derived certificate bundle were **not reached**. No earlier artifact is relabelled as current success.

## Passed certificates

Complete requests: **5,282 bodies**, 240 families, plus 72 independent context-case bodies; zero request/P privacy hits. Extraction feasibility independently measured 1,920 bodies. All complete input requests pass the 5% margin gate.

| Kind | Worst reservation | Ceiling | Headroom | Body SHA-256 |
| --- | ---: | ---: | ---: | --- |
| extraction/primary | 34,504 | 40,960 | 15.761719% | `713f0b5ecc28fba4b232f47f520ae2cea16d20c8ed8db37db9bdef18409f16d0` |
| extraction/alternative | 34,518 | 40,960 | 15.727539% | `9750be3b0b183d80f019e1c9f2db059184696b132c1e747d556c243695ff098f` |
| reader/T | 43,572 | 57,344 | 24.016462% | `1dde559035a79815e484ac065dda66ca7a4d01eac7da92343d051bc679d91d59` |
| reader/U | 44,396 | 57,344 | 22.579520% | `6de55d3d01c9ec54701ce6fa6357ed06a42198b27c14bc14532923e9a48e2e21` |
| reader/O | 42,251 | 49,152 | 14.040120% | `9d15254069c151cba1a11479ef96f0e5663662bfcfe4bb64523850467ff130b2` |
| reader/P | 49,422 | 57,344 | 13.814872% | `ff90c8237509a9db18bc18fbd99e8fc877ce4e0ed989b51fb6c15deda7066be4` |

Output caps remain E=4,352 and R=2,176. Worst extraction output: 2,276 tokens, **47.702206%** headroom. Worst reader output: 1,774 tokens, **18.474265%** headroom. Both exceed 10%.

Embedding request/body/unit instrumentation covers **12,902 requests**, including **138 requests across nine independent context cases before maxima/projections**. Max input=1,220 units; max request=3,379 units; max complete body=3,798 bytes. Cumulative projected research=**63,602,229**, product=**23,831,025** units; each is below 64,000,000 with carry and two transport-failure reservations included. These are simulated measurements, not paid counters.

Context conformance: six adopted contexts, three unresolved contexts, three shared-turn ambiguities; pass. The complete-request privacy scans include extraction, readers, P operations, private registry and authentication metadata; zero hits. Final conformance/allocation/embedding/privacy certificate bundle and full-pilot arm-blinding/gold-leakage scans remain unreached after the harness failure.

## Accounting and preservation

The accounting gate verified the complete four-pilot ledger chain and primary preparation record. Settled exposure **$4.110354120** plus outstanding **$0.034723600** gives **$4.145077720** carried exposure. The unchanged conservative increment **$38.342656** gives cumulative **$42.487733720**, below $50. Budget and continuation reports were regenerated successfully (both exit 0).

All **139 protected generator/scorer/protocol/real-runner source files** match the task-entry SHA-256 snapshot. Provider dispatches and new paid reservations are zero. Test transports use local fake responses and simulated journals. The complete standalone fake pilot was not run.

The cumulative `reports/a6-changes.json` is mechanically regenerated against original A-6 entry using (1) Git inventory including ignored files plus Python SHA-256 and (2) independent filesystem Dirent traversal plus Node crypto SHA-256, then canonically diffed. It includes reports, docs, schemas, fixtures and ignored artifacts. The manifest self-entry uses null size/digest. Primary inputs already present are not attributed as new authoring.
