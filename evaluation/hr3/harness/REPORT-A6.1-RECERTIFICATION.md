> Superseded status: the primary refreshed the generator binding. The resumed
> output/context certificates pass; request certification now stops at missing
> primary preparation completeness during that attempt. The primary record arrived
> after the failure; no certificate was rerun. See `REPORT-A6.1-RESUME.md`.

# A-6.1 recertification — stopped at a failed certificate

A-6.1 was read before editing. Its input ceilings are applied exactly in
`requests.mjs:3–4`: extraction 40,960, T/U/P 57,344, O 49,152.
Output caps remain 4,352/2,176. No prompt, model, margin, call-plan, retry,
admission, retrieval or policy rule was changed in this turn. No network,
credentials, paid call, new paid reservation, freeze or commit occurred.

## Actual results

The attended certification prefix was invoked through
`setsid -w ~/.local/bin/cairn-heavy` and exited **1**. Each child exit is captured
separately in `reports/a61-recertification.json` and its `.exit` file.

| Check | Result | Actual exit |
| --- | --- | ---: |
| Strict provider schema | PASS | 0 |
| Published schemas | PASS | 0 |
| Recursive private-field inventory | PASS: 120 fields / 608 variants, including identity registry | 0 |
| Inspected-reference inventory | PASS | 0 |
| Dual-route runtime closure | PASS: 199 modules, 1,489 pinned/runtime files, 1,240 external files | 0 |
| Four-pilot accounting | PASS: exact ledger chain and outstanding holds retained | 0 |
| A-6.1 conservative budget | PASS: $42.487733720 ≤ $50 | 0 |
| Continuation planning projection | Generated: $282.00320; non-binding, paid usage pending | 0 |
| Maximal output certificate | FAIL: stale protected generator errata binding | **1** |
| Complete provider bodies and embedding bodies/cumulative units | NOT RUN after failure | — |
| Context/conformance/allocation certificates and complete privacy/arm-blinding/gold-leak scans | NOT RUN after failure | — |
| Generator/scorer/integration/harness suites | NOT RUN after failure | — |
| Full 480-answer fake pilot and bound report | NOT RUN after failure | — |

No earlier passing suite or certificate is relabelled a current A-6.1 result.
Old output/request/privacy and measurement artifacts are historical or stale;
the current aggregate result is **FAIL_STOPPED_AT_CERTIFICATE**. The existing
measurement verifier and its blocked-gate tests were not migrated or rerun
past this stop.

## Certificate blocker

`cap-certification.mjs:76` requires the current errata hash to equal
`generator/freeze.json.errata_sha256`. The protected generator freeze records:

- Frozen: `05102088c42ea22fa596d6cfd06cff028db88a561125caa4167cdac388decc1d`
- Current A-6.1 errata: `0a5f74d8e72ca582f37568d45e49c91198c0525281a77879b4822de1eb1f2a35`

It fails before maximal-output measurement, so no current output or input
margin is certified. The primary/protected generator owner must refresh the
upstream provenance binding before recertification can resume. This task did
not edit that file, bypass the assertion, adjust a ceiling or run final freeze.

A separate existing readiness prerequisite remains absent:
`accounting-input-a6.json` contains no primary-supplied completed preparation
record. `accountingA6().preparationComplete` is false. The request-certificate
PASS predicate and paid-run gate still require it; this code has not fabricated
or waived an attestation. No conclusion about the unrun embedding certificate
is made.

## Heavy-run supervision limitation

The requested wrapper's default machine-wide lock is read-only in this
sandbox. It reports `Read-only file system`, then `flock: 9: Bad file descriptor`,
yet continues into the command and prints “lock acquired.” Therefore the
observed run **did not acquire the shared lock** and is not a properly locked
heavy verification. No alternate lock, load threshold or wrapper modification
was used. The primary needs to supply access to the intended shared lock before
a supported heavy rerun. Logs retain this failure, with portable paths.

## Recomputed arithmetic

`accounting-a6.mjs` and the new `budget-a6.mjs` use unchanged integer rates and
call counts, with the A-6.1 ceilings:

| Component | Nanodollars | USD |
| --- | ---: | ---: |
| Extraction, retries included | 11,206,656,000 | 11.206656 |
| Reader, retries included | 24,576,000,000 | 24.576000 |
| Entire conservative embedding allowance | 2,560,000,000 | 2.560000 |
| Incremental bound | 38,342,656,000 | **38.342656** |
| Verified prior settled exposure | 4,110,354,120 | 4.110354120 |
| Verified prior outstanding exposure | 34,723,600 | 0.034723600 |
| Verified carried exposure | 4,145,077,720 | **4.145077720** |
| Cumulative bound | 42,487,733,720 | **42.487733720** |

The full embedding allowance remains in the bound as A-6.1 specifies. Carried
embedding counters remain research 1,799,591 and product 436,859; they are not
reset. The smaller remaining-allowance arithmetic is separately labelled and
is not substituted for the conservative amendment bound. The unchanged
carry-forward manifest and hash-pinned four-pilot fixtures remain intact.
The runner's existing A-6 accounting gate consumes the updated arithmetic;
per-request ledger reservations consume the new constants through validation.

`continuation-a6.mjs` regenerates the unchanged forecasting method at
$282.00320, with the entire $50 pilot envelope retained and 25% contingency on
the remaining response/embedding forecast. It remains non-binding and cannot
replace reconciled paid usage or approve development. Other stage/global caps
are unchanged.

## Preservation and delivery

All 132 protected sibling files match this turn's entry hashes, including the
primary's A-6.1 errata amendment. `reports/a61-preservation.json` records this.
`reports/a6-changes.json` is regenerated against the original A-6 entry snapshot
using Git inventory/Python hashes and independent Dirent/Node hashes, with an
exact diff of sorted paths, sizes and digests. It includes this stopped report,
all new budget/continuation outputs and diagnostic logs; its self-entry has a
null size/digest to avoid self-reference.
