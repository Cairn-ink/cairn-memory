# A-6.1 resumed recertification — stopped at preparation-completeness gate

The primary refreshed the protected generator freeze. Its current errata binding
was verified before this run. Output and context certification now pass.
Complete-request/embedding certification exits **1** because the existing PASS
predicate also requires `accounting.preparationComplete`, which was false when the certificate ran.
The primary preparation record was absent at that point. No attestation or requirement waiver
was produced, and no numerical limit or implementation rule was changed.

All three commands ran **directly and unlocked**, as explicitly authorized.
The primary must repeat final verification under the machine-wide lock before
freezing. No network, keys, paid calls, new paid reservations, freeze or commit.

## Actual command results

| Command | Result | Exit |
| --- | --- | ---: |
| `node evaluation/hr3/harness/cap-certification.mjs` | PASS | **0** |
| `node evaluation/hr3/harness/context-certification.mjs` | PASS | **0** |
| `node evaluation/hr3/harness/request-certification.mjs` | FAIL_INPUT_EMBEDDING_OR_PRIVACY_GATE: missing preparation completeness | **1** |
| Generator, scorer, integration and harness suites | Not run after first certificate failure | — |
| Full 480-answer fake pilot; complete leak/arm-blinding/gold-leak scan; bound report | Not run after first certificate failure | — |
| Standalone embedding, conformance and allocation bundle; final freeze | Not run after first certificate failure | — |

Actual child exits and log digests are retained in
`reports/a61-resume-verification.json` and `reports/a61-resume/*.exit`.
Earlier passing suites and partial scans are not current recertification results.
The old measurement-mode verifier was not rerun as a substitute for full
certification. The current overall result is **FAIL_STOPPED_AT_CERTIFICATE**.

## Output and context certificates

| Output | Worst tokens | Unchanged cap | Headroom | Gate |
| --- | ---: | ---: | ---: | --- |
| Extraction | 2,276 | 4,352 | 47.7022058824% | PASS ≥10% |
| Reader | 1,774 | 2,176 | 18.4742647059% | PASS ≥10% |

Context conformance passes all nine English/Traditional Chinese/mixed cases:
six adopted contexts, three unresolved contexts, three shared-turn ambiguities,
72 complete request checks. Adopted/unresolved policy and common link decisions
are checked across arms with actual local P operations.

## Complete-body measurements inside the failed composite certificate

All **5,282** main complete-body checks across 240 pilot/engineering families
pass the unchanged 5% input margin. All 72 additional independent context bodies
also pass. These are component results; the composite certificate is failed.

| Request kind | Worst reservation | Ceiling | Headroom |
| --- | ---: | ---: | ---: |
| Extraction 4.1 | 34,504 | 40,960 | 15.7617187500% |
| Extraction 5.4 | 34,518 | 40,960 | 15.7275390625% |
| Reader T | 43,572 | 57,344 | 24.0164620536% |
| Reader U | 44,396 | 57,344 | 22.5795200893% |
| Reader O | 42,251 | 49,152 | 14.0401204427% |
| Reader P | 49,411 | 57,344 | 13.8340541295% |

Reservation means complete UTF-8 provider-body bytes plus 4,096 framing units.
P identifiers/tie selections vary between fresh stores. The earlier 49,553
observation used by A-6.1 remains disclosed; no ceiling was reduced to this
run's observed maximum. The runtime continues to check every actual request.
PrivacyGuard reports **zero hits** for the complete measured extraction/reader
bodies and actual P inputs. This does not replace the unrun complete fake-pilot
privacy/arm-blinding/gold-leak scan or its standalone certificate.

## Embedding instrumentation and cumulative-unit components

The attempt validates **12,902 embedding provider bodies**, including **138
context requests across nine context cases before maxima/projections**.
Maximum input reservation is 1,220 units; maximum complete request reservation
is 3,379 units; maximum complete JSON body is 3,798 bytes. Existing limits are
unchanged and every measured embedding request passes `validateRequest`.

| Channel | Carried units | Max measured family units | Projected cumulative units | Limit | Component |
| --- | ---: | ---: | ---: | ---: | --- |
| Research | 1,799,591 | 29,998 | **63,602,229** | 64,000,000 | PASS |
| Product | 436,859 | 12,574 | **23,831,025** | 64,000,000 | PASS |

Projection retains the existing 2,060 research / 1,860 product family envelope
and two transport-failure reservations (6,758 / 6,526 units), plus full carried
units. Offline measurement totals are not charged or added to paid counters.
No standalone passing embedding certificate is emitted after the composite
certificate failure.

## Exact blocker and preserved accounting

`request-certification.mjs:108` requires all of:

- `accounting.preparationComplete`;
- every complete main request's 5% gate;
- both cumulative embedding allowances;
- zero privacy hits.

The latter three conditions pass. A read-only `accountingA6()` check confirms
`preparationComplete:false`, `NOT_SUPPLIED_FOR_POST_PILOT_FOUR`, with the full
four-pilot ledger chain verified. At that time `reports/accounting-input-a6.json` had no
`preparation` record. The existing contract requires the primary to supply
its completed record and any hash-pinned receipts; code must not invent it.
Stop occurred at this first failed certificate. No later gate was executed.

Verified carried exposure remains **$4.145077720**. A-6.1's unchanged arithmetic
remains **$38.342656 incremental**, **$42.487733720 cumulative ≤ $50**.
Continuation planning remains non-binding at **$282.00320**. Outstanding holds
and both cumulative embedding counters remain intact.

## Readback and manifest

All three attempts bind the same runtime closure. Before the external accounting
update, independent byte readback verified 44 output-certificate, eight context-
certificate and 27 request-certificate source bindings. The failed request
certificate is now stale against the two newly updated accounting files. All **132 protected sibling files** match
this resumed turn's entry hashes, including the primary-refreshed freeze.
`git diff --check` exits 0.

`reports/a6-changes.json` is regenerated against the original A-6 task entry
using Git inventory/Python SHA-256 and independent Dirent/Node SHA-256 routes.
Sorted paths, sizes and digests agree exactly; the manifest contains the count.
Its own digest/size are null to avoid self-reference. No protected sibling,
provider body, P block, fixture or journal is rewritten for portability.

## Primary record arrived after the failure

During the changed-file manifest readback, both accounting files changed: the
primary supplied its completed preparation record and regenerated the carry.
A read-only `accountingA6()` check now verifies `preparationComplete:true` and
the complete four-pilot chain, with exposure still $4.145077720 and cumulative
bound still $42.487733720. No attestation was produced by this harness task.

The failed request certificate binds the earlier accounting files. Their old
and new digests are recorded in `a61-resume-verification.json`; no certificate
source binding was rewritten. The instructed stop at the first certificate
failure remains in effect. No certification, suite or fake pilot was rerun
after the new record appeared. A fresh certification attempt is still needed.
