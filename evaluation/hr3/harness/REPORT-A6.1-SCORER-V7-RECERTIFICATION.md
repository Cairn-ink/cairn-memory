# A-6.1 scorer v7 migration and complete offline recertification — PASS

**PASS_OFFLINE_PENDING_PRIMARY_FREEZE.** The complete verifier exited **0**, with all 25 ordered child commands exit 0. This attempt ran **directly and unlocked**, as explicitly authorized. The primary owns the locked rerun, non-author acceptance and freeze. No network, key access, provider dispatch, new paid reservation, numerical amendment, freeze or commit.

The primary-stopped a6j attempt at `artifacts/a61-placeholder-verification-Siy8BY` is explicitly discarded and marked `DISCARDED_PRIMARY_STOPPED_SCORER_INTERFACE_CHANGED`; its termination exit was not captured, and no success code is invented. Its partial certificates/suite results were not reused. Every requested certificate and all four suites were regenerated from the start for scorer v7.

## Migration and clause mapping

| Requirement | Implementation |
| --- | --- |
| Scorer-issued no-trivia token; A-6 §5 authenticated provenance | `scoring-a6.mjs:23` constructs `createUnlicensedTriviaAuthority` from canonical fixed-catalog bytes plus one newline and a separately hardcoded pin. `:24` calls `createUnlicensedTriviaCase({authority,target,gold})`, using the original trusted source world and exact adapted gold. |
| Preserve complete-target harness guard; trivia P2-2 | `scoring-a6.mjs:13`–`:20` retain independent fixed-record checks for family, source-specific case ID, exact question, original-world digest and full-gold digest. `:25` records the same scorer-issued token in the existing private gold/token WeakMaps. `:35` also requires scorer `authenticated_unlicensed`, so both layers agree. |
| Trusted fixed absence authority | `unlicensed-authority-a6.mjs` keeps all four prior engineering records unchanged; its independent pin is `99777a3592375f84efce9c2547ee6626055260f359b9b136b0e483e1fda97e9f`, over 1,677 exact bytes. The pin is not calculated from candidate data at dispatch. Generator targets still require the separately freeze-pinned licensed authority. |
| No A-6 verdict without one mode | `scoring-a6.mjs:29`–`:30` rejects missing or conflicting modes. `:38` retains licensed proof/expected-case verification. The only production direct scorer call is `:41`, after these checks. `runner.mjs` and `integration/mechanical.mjs` pass separate options; `integration/adapters.mjs:96` routes every no-trivia challenge through the shared helper. |
| No candidate repair, fallback or evidence rewrite; A-6 §§2–5 | No metadata stripping, legacy graph fallback, punctuation inference, answer rewrite or quality retry is added. Source/case mismatch remains an authoring error. The new successful no-trivia status is `authenticated_unlicensed` and grants zero optional positions. |
| Versions / closure / recertification; A-6 §§6–7 | `verify-a6.mjs` binds the scorer-v7 attempt, records discarded a6j, discovers every scorer test, checks source preservation after every step, and runs the full ordered verification. Both closure routes include the fixed authority module. |

The direct token-consumer regression proves that the same helper-issued token is accepted by both harness and raw scorer with identical results. The mode regression rejects missing or dual options before forwarding any verdict. Existing bilingual stripping/replay, private-inventory, source-integrity and quotation tests remain.

## Focused checks and full suites

Before the full verifier, focused harness/placeholder checks passed **22/22**, exit 0; the seven relevant integration adapter tests passed **7/7**, exit 0. Their source and exit logs are retained as `reports/a61-v7-focused.*` and `reports/a61-v7-integration-focused.*`. The full verifier reran its own focused gates as well.

| Suite | Passed | Failed | Skipped | Actual exit |
| --- | ---: | ---: | ---: | ---: |
| generator-tests | 62 | 0 | 0 | 0 |
| scorer-tests | 123 | 0 | 0 | 0 |
| integration-tests | 26 | 0 | 0 | 0 |
| harness-tests | 377 | 0 | 0 | 0 |

## Complete ordered verification

Command: `node evaluation/hr3/harness/verify-a6.mjs`, actual exit **0**. The wrapper captured that exact child exit; no pipe-tail status is substituted. Full artifact directory: `evaluation/hr3/harness/artifacts/a61-scorer-v7-verification-yL39wE`. Exact command arguments, individual exits and stdout/stderr digests are in `reports/a6-verification.json`.

| Step | Exit |
| --- | ---: |
| strict-schema | 0 |
| published-schemas | 0 |
| private-field-inventory | 0 |
| inspected-references | 0 |
| runtime-closure | 0 |
| placeholder-inventory-tests | 0 |
| authenticated-consumers | 0 |
| context-certificate | 0 |
| output-certificate | 0 |
| input-feasibility | 0 |
| request-embedding-certificate | 0 |
| accounting | 0 |
| projection-schema | 0 |
| budget | 0 |
| continuation-projection | 0 |
| generator-tests | 0 |
| scorer-tests | 0 |
| integration-tests | 0 |
| harness-tests | 0 |
| pilot-inputs | 0 |
| fake-pilot | 0 |
| leak-scan | 0 |
| bound-report | 0 |
| integration-reconciliation | 0 |
| certification-bundle | 0 |

Freeze was deliberately not run. The certificate bundle is offline evidence, not a non-author review attestation or paid-preflight approval. `paidReadiness` remains false.

## Certification numbers

Output caps remain extraction=4,352 and reader=2,176. Worst complete outputs: extraction **2,276 tokens / 47.702206% headroom**, reader **1,774 tokens / 18.474265% headroom**; both pass the unchanged 10% gate.

Complete request certificate: **5,282 bodies across 240 families**, plus **72 independent context-case bodies**. Both extractors and all four readers are covered, including languages, full engineering branches/ranking fixtures and actual P public operations. Extraction feasibility independently checks 1,920 complete bodies. All complete request reservations pass the unchanged 5% gate.

| Kind | Worst complete reservation | Ceiling | Headroom | Body SHA-256 |
| --- | ---: | ---: | ---: | --- |
| extraction/primary | 34,504 | 40,960 | 15.761719% | `713f0b5ecc28fba4b232f47f520ae2cea16d20c8ed8db37db9bdef18409f16d0` |
| extraction/alternative | 34,518 | 40,960 | 15.727539% | `9750be3b0b183d80f019e1c9f2db059184696b132c1e747d556c243695ff098f` |
| reader/T | 43,572 | 57,344 | 24.016462% | `1dde559035a79815e484ac065dda66ca7a4d01eac7da92343d051bc679d91d59` |
| reader/U | 44,396 | 57,344 | 22.579520% | `6de55d3d01c9ec54701ce6fa6357ed06a42198b27c14bc14532923e9a48e2e21` |
| reader/O | 42,251 | 49,152 | 14.040120% | `9d15254069c151cba1a11479ef96f0e5663662bfcfe4bb64523850467ff130b2` |
| reader/P | 49,424 | 57,344 | 13.811384% | `220fd6773e3dc9d4533115819903681e521c3be8bd3659cc190113b39c32b72d` |

Embedding instrumentation covers **12,902 request bodies**, including **138 context requests across nine cases, included before maxima/projection**. Max input=1,220 units; max request=3,379 units; max request body=3,798 bytes. Complete-run projections including carry and failure reservations: research **63,602,229**, product **23,831,025** units, each below its unchanged 64,000,000 limit. This is simulated certification, not billable usage.

Context conformance passes: six adopted contexts, three unresolved contexts, three shared-turn ambiguities. Conformance and semantic-inventory certificates pass. Allocation reconciliation passes: 60 families, 30 lineages, 12 families per change type, correct bilingual multiplicity/causal controls and fresh seed `hr3-worlds-a6-pilot-v1`; no held-out sources rendered.

## Full fake pilot, privacy, blinding and bounds

The standalone pilot completed **480/480**, exit 0, `FakeTransport`, `offline=true`, scorer `hr3-scorer-a6-v7`. Its new journal records **2661 simulated reservations and 2661 simulated settlements**; every settlement ID has the `fake-` prefix. Carried real exposure and unknown holds remain intact. There are **zero provider dispatches and zero new paid reservations**. No semantic accuracy or calibration claim is made from fake answers.

The complete scan passed: **240 extraction requests**, **480 reader requests** (120 per arm), **1,747 P public-operation payloads**, and **1,942 exact outgoing embedding-body scans/reservations**, all with **zero hits**. The P text blocks match the raw returned contexts unchanged. The recursively derived inventory includes the private identity registry and authentication metadata: 205 private fields, 1,100 variants; the declared-placeholder exception remains narrowly constrained. Arm blinding passes on all 480 reader bodies; gold-leakage checks include all 240 complete extraction bodies and report zero private-metadata hits.

The bound report passes with 480 valid completions, zero failed/unexecuted observations, 60 represented families and 30 lineages. It publishes mechanical identification bounds only: no confidence intervals, bootstrap estimates or uncertainty contrasts; adjudication and inferential use remain prohibited under A-1/A-1.1. It cannot authorize development/test continuation.

Integration reconciliation passes lossless round trips for **120 generator checkpoints**, **240 extraction batches** and **752 field paths**, with its two field/inventory routes agreeing. The final certificate bundle passes embedding, conformance, allocation, complete accounting and semantic inventory.

## Budget and verified source bindings

The complete ledger chain through pilot four and the primary preparation-completeness record verify. Settled **$4.110354120** + outstanding **$0.034723600** = carried **$4.145077720**. Unchanged A-6.1 increment **$38.342656** gives cumulative bound **$42.487733720**, below **$50**. Budget and continuation reports were regenerated (exit 0 each); carry receipts/holds were not reset. No preparation, supervision or review attestation was authored.

All current certificate source bindings were independently checked again across **1660 distinct paths**, along with every command-log digest. All **142 protected files** match task entry; all **116 scoped code files** match the post-migration snapshot through verification. No code was changed after the successful run began. Runtime closure fingerprint: `be5e1f7f462d1522bc785f9e8ee7039336e30d557800c0b3e54987f68c1000fa`.

The changed-file manifest `reports/a6-changes.json` is cumulative against original A-6 entry. It includes reports, docs, schemas, fixtures and ignored artifacts and excludes protected sibling work from author attribution. Git inventory/Python SHA-256 and an independent recursive Dirent/Node crypto inventory are canonically diffed; self-entry digest/size are null. The primary owns the locked rerun, non-author acceptance and final freeze.
