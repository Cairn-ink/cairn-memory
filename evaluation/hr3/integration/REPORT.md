# Audit re-check R3 (supersedes prior implementation interpretation)

The finding → fix → test mapping and full change inventory are in
[../harness/REVISION-REPORT.md](../harness/REVISION-REPORT.md).

The auditor's fixture-rebalancing alternative was chosen. Effective strata are
computed from gold rather than authored topology labels. Unscheduled expiry
fixtures replace non-direct deadline cases with fresh `-R3` identities and bank
aliases. The original per-type allocation definitions, realized 40 multi-hop / 10
unstated pilot families, guard weights and power allocation are preserved.
Direct expiry still accepts a supported elapsed-deadline trigger. Earlier
rendered datasets/freeze are archived in the generator; integration's earlier
records are retained in `artifacts/previous-ff192c6b/`.

All 120 pilot checkpoints validate and self-score C=O=R=J=1. All 1,984 challenge
observations score without execution/validation failures. The frozen scorer and
challenge are unchanged. Incomplete multi-hop submissions cannot receive a
mechanical R=1; unknown semantic equivalences may still be referred by the frozen
scorer. No scorer change or new equivalence rule is introduced.

Fresh hashes/results are in `mechanical-results.json`; the updated field ledger
is `reconciliation-fields.json`. Focused integration tests cover the restored
expiry strata, supported direct triggers, incomplete graphs, and all 120 gold
self-scores. The calibration-v1 referral deficit (36/72 strata) remains an external
blocker; no adjudication or paid work occurred. Current generated outputs are in
`artifacts/audit-recheck-r3/`; previous outputs are retained.
