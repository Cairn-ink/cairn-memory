# A-6: stop at the unchanged complete-request gate

**STOP_NUMERICAL_AMENDMENT_REQUIRED. A-6 implementation is incomplete.**
Authority: errata A-6 §§2–4, 6–7 at `12355a8e`; the pilot-four diagnosis and
the generator/scorer implementation reports were read. Existing uncommitted
generator/scorer work is preserved. No network, key, paid call, commit or
execution freeze was used. Writes are confined to `harness/`.

The requested early feasibility check fails even after operation-specific
projection and lossless factoring. Per the task's request-size stop rule and
A-6 §6's numerical-amendment rule, runtime/name-registry/integration migration
and full verification have **not** continued. Existing certificates and the
A-4 runner are not claimed to satisfy A-6. No limit changed.

## Clause mapping and exact status

| Clause | Work and location | Status |
| --- | --- | --- |
| A-6 §2 wire contract | `preflight-a6-schema.mjs:28` replaces model predecessor anchors with nullable own-name and referenced-name exact Anchor objects. Core domains remain strings for event-level admission. | Prospective schema only; live admission and registry not migrated. |
| A-6 §2 name rules | `contract-projection-a6.mjs:12` retains the complete published name-token/role/anchor rules in extraction projections. | Supplied in measured prospective bodies; no name registry or linking implementation claim. |
| A-6 §3 extraction instructions | `prompts-a6.mjs:4`; `contract-projection-a6.mjs:19` retains the full extraction crosswalk, independent-admission rules and all twelve bilingual extraction worked examples. | Prospective only; no runtime repair, enum restriction or retry added. |
| A-6 §4 reader instructions and pairs | `prompts-a6.mjs:5`; `contract-projection-a6.mjs:28` preserves all bilingual address, recovery, causal and both inheritance pairs/four variants verbatim after expansion. | Projection/instruction tests pass; no across-arm execution/inheritance conformance claim. |
| A-4 §2 complete deterministic projection / A-6 §§3–4, 6 | `contract-projection-a6.mjs:40`, `:57`, `:88`; `preflight-a6.mjs:20`, `:36`, `:46`. | Four lossless representations compared; complete extraction gate FAIL. |
| A-6 §6 / §7 accounting | `accounting-a6.mjs:13`, `:17`, `:26`, `:30`; pinned inputs in `reports/accounting-input-a6.json`. | Complete four-pilot ledger chain verified. Retained-limit planning only; not binding authority. |
| A-6 §7 harness/integration rows and pre-pilot list | `preflight-a6.mjs:67`, `:77`. | STOP: registry/cache/runtime, lossless integration/support adapters, conformance, full certificates, allocation certification, binding continuation, fifth-pilot review catalog, verifier and freeze migration remain pending. |

The isolated schema is never substituted into the A-4 runner. The paid
preflight catalog is not weakened, and no review/primary attestation is
generated. The registered private identity surface must be added to privacy
certification when the registry is implemented; there is no such registry yet.
The scorer's new `supportVersion`/`supportTrivia` adapter remains pending.

## Complete-body feasibility

Report: `reports/preflight-a6.json`; actual gate exit **1**. Each body is the
complete prospective provider JSON, including system prompt, public projection,
unchanged current-batch source input and strict provider schema. Reservation is
UTF-8 bytes plus exactly 4,096 framing units. Actual `o200k_base` counts are
also retained; tokens do not replace the mandated byte reservation.

**1,920 / 1,920 extraction requests fail**, covering all 60 fresh pilot families
and all 180 independent engineering stress families, four batches and both
frozen extractor configurations. Output caps remain E=4,352/R=2,176; no output
cap certificate was regenerated after this stop.

| Cohort / extractor | Complete body bytes | Reservation | Ceiling | 5% maximum | Excess over 5% gate | Margin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pilot / primary 4.1 | 30,408 | 34,504 | 20,480 | 19,456 | 15,048 | −68.4765625% |
| Pilot / alternative 5.4 | 30,422 | **34,518** | 20,480 | 19,456 | **15,062** | **−68.544921875%** |
| Engineering / primary 4.1 | 30,333 | 34,429 | 20,480 | 19,456 | 14,973 | −68.1103515625% |
| Engineering / alternative 5.4 | 30,347 | 34,443 | 20,480 | 19,456 | 14,987 | −68.1787109375% |

The arithmetic minimum ceiling for the measured worst body to have 5% headroom
is **36,335** (`ceil(34,518 / .95)`). This is evidence for a primary decision,
not an enacted or recommended limit. It does not certify future reader bodies
or the still-unmeasured A-6 output references. The full canonical contract is
49,669 bytes; its worst engineering alternative reservation is 65,533.

Projection includes only relevant public subject/predicate aliases, every slot
and field spelling, unit/Boolean/scope/time/update rules, and every relevant
operation's rules and worked examples. Reader-only answer/labels/address rules
and reader examples are omitted from extraction. Extraction-only schema/name
annotation rules and extraction examples are omitted from reading. Both
languages remain; no gold/AST/answer/allocation-based branch selects examples.

Repeated exact teaching content is factored into explicit definitions and
event-default overlays, including null overrides. Literal examples, repeated
definitions, modal defaults plus definitions, and byte-minimal-per-field
defaults plus definitions are compared deterministically; the smallest is
retained. Every candidate expands to exactly the literal operation projection.
This is not a proof of minimum size over arbitrary new semantic rewritings of
the public contract. No opaque compression, repository-only reference, evidence
truncation or requirements omission is used. This factoring itself remains
prospective and subject to non-author review before any model use.

**Reader numbers below are empty-delivery lower bounds, not complete-request
certificates.** They include the new shared projection, answer schema, prompt
and question metadata, but deliberately no migrated memory blocks. Real blocks
will add bytes. No existing arm's physical delivery was rewritten to fit.

| Arm | Worst empty-delivery reservation | Retained ceiling | Margin |
| --- | ---: | ---: | ---: |
| T | 33,841 | 40,960 | 17.38037109375% |
| U | 33,841 | 40,960 | 17.38037109375% |
| O | **33,841** | **32,768** | **−3.2745361328125%** |
| P | 33,841 | 40,960 | 17.38037109375% |

Reader O already fails before any evidence. No reader arm is certified by this
lower-bound exercise. The fresh seed is the producer's
`hr3-worlds-a6-pilot-v1`; the full allocation gate remains pending.

## Accounting through pilot four and retained-limit arithmetic

`accounting-a6.mjs` exited **0**. The three user-supplied paid pilot-four files
were copied byte-for-byte under the pilot-three naming pattern and hash pinned
in `reports/accounting-input-a6.json`. The ledger fixture digest is
`ed220b1c1ba59a1ba5b1ea421b1c75246594d9ce4a448454cbf4909c979156c9`;
run digest `a84fa0154d35f404f35e599f7927a3ea421cb8742955cb00a372d453d5f1bd6a`;
summary digest `e0108f983df99a7813a049fc64f96ad3eb269098ec68d6972724775a18e6c584`.

All 5,389 fourth-ledger records and the recursively pinned four-pilot ancestor
chain verify, including equality of its inherited snapshot to the existing
A-4 carry. Eleven charge-source hashes and 7,253 distinct charge/request IDs
are retained; no ancestor or outstanding reservation is counted twice or
released. The existing carry manifests and fixtures are unchanged.

| Quantity | Exact USD |
| --- | ---: |
| Exposure carried through pilot three | 2.136861040 |
| Additional exposure through pilot four | 2.008216680 |
| Settled cumulative charges | 4.110354120 |
| Outstanding exposure (five carried holds) | 0.034723600 |
| **Verified cumulative exposure** | **4.145077720** |
| Fifth-pilot extraction maximum, two attempts | 7.274496000 |
| Fifth-pilot reader maximum, two attempts | 18.284544000 |
| Remaining cumulative embedding allowance at frozen rates | 2.515271000 |
| **Retained-limit cumulative planning bound** | **32.219388720** |
| Retained cumulative pilot cap | 50.000000000 |

Cumulative reserved embedding counters are research **1,799,591**, product
**436,859**, against separate 64M limits. The prospective supplemental
`reports/a6-carry-forward.json` extends the chain but explicitly marks fresh
preparation completeness false: the supplied ledger/run/summary authenticate
recorded exposure, not a new primary assertion that no other preparation calls
exist. No such attestation is fabricated. Consequently this is not a complete
paid-run record or a replacement binding budget/continuation report.

The displayed $32.219388720 assumes the **unchanged** request ceilings that
failed certification. Any numerical amendment must reprice that envelope and
regenerate the binding budget and continuation; the sub-$50 arithmetic alone
does not authorize work. Global/stage limits and model settings are unchanged.

## Verification and actual exit codes

| Command/check | Pass / fail | Actual exit |
| --- | --- | ---: |
| `node evaluation/hr3/harness/accounting-a6.mjs` | Ledger-chain reconciliation passed | 0 |
| `node evaluation/hr3/harness/preflight-a6.mjs` | 0 / 1,920 extraction size gates | **1 (required STOP)** |
| `node --test --experimental-test-isolation=none evaluation/hr3/harness/test/preflight-a6.test.mjs` | **8 / 0**, no skipped tests | **0** |
| `node --check` each of six new `.mjs` files | 6 / 0 | 0 each |
| Strict prospective schema traversal | 89 nodes / 17 closed objects | 0 (within preflight before size failure) |
| Scoped `git diff --check` | Passed | 0 |
| Two-route task-delta manifest and input/source/fixture preservation readbacks | Passed | 0 |
| Full generator/scorer/integration/harness suites | Not run after mandated stop | N/A |
| 480-answer fake pilot / complete leak scan / bound report | Not run after mandated stop | N/A |
| All A-6 output, reader-request, embedding, privacy, conformance/allocation certificates; full verifier | Not run / not certified | N/A |
| Primary freeze and passing A-6 review | Not performed / not supplied | N/A |

The preflight was run three times while tightening deterministic factoring;
all returned actual exit 1. The first scoped whitespace check returned exit 2
for a new blank line at the README EOF; it was corrected and the final check
returned exit 0. Early prototype figures were 34,509 for the worst
reservation; the final byte-ordered definition selection above is **34,518**.
The focused tests ran three times and passed 8/8 each time, exit 0. Final logs
are `reports/a6-{accounting,preflight,preflight-tests}.*` and
`reports/a6-syntax.json`. There is no new all-gates-PASS claim.

Regression names are in `test/preflight-a6.test.mjs`: exact operation projection
round-trips; relevant bilingual/mixed aliases; preservation/address pairs;
closed own/reference wire and domain-admission precedence; exact evidence/model
envelopes; saved-body threshold/source reproduction; cyclic/missing factoring
reference rejection; complete four-ledger accounting with retained holds.

## Changed files and preservation

`reports/a6-changes.json` is the mechanically generated task-delta inventory,
including ignored reports, this report, documentation, test and fixture files.
It excludes the generator/scorer changes that already existed at task entry.
Route one uses Git tracked/untracked inventory (including ignored files) and
content comparison to the entry snapshot. Route two independently walks the
filesystem with Node Dirents and hashes every file against that snapshot. The
sorted paths and bytes/digests must match exactly. The manifest records counts,
the self-entry convention and preservation of all pre-existing sibling files.

Authored source/doc/test files: `accounting-a6.mjs`,
`contract-projection-a6.mjs`, `preflight-a6-schema.mjs`, `preflight-a6.mjs`,
`prompts-a6.mjs`, `test/preflight-a6.test.mjs`, `README.md`, this report.
Remaining entries are hash-pinned fixture copies and generated offline reports
and logs. No writes to integration, runner, generator, scorer or protocol; no
commit. Needed protocol action is a primary numerical decision; the remaining
runtime/integration/recertification work is explicitly listed above.
