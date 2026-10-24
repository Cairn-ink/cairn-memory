# R4 provenance re-check

The accepted remaining finding, fix, tests and changed-file inventory are in
[../harness/REVISION-REPORT.md](../harness/REVISION-REPORT.md).

R3 engineering/pilot banks are now disclosed as same-split revisions of retired
archived predecessors, not fresh independent roots. The 38 affected held-out
entries remain provisional derived specifications. After calibration v2 passes,
and before development or affected held-out generation, genuinely fresh banks
for 8 development and 30 test replacements must preserve all frozen allocations
and multiplicities and have their ancestry/allocation published before generation.
That gate is recorded as pending; fresh banks are not instantiated in this task.

Regeneration changes provenance/grammar metadata only. Family, gold and support
bytes for all 90 engineering/pilot worlds are unchanged from commit 14504dfc.
All 120 pilot checkpoints validate and self-score C=O=R=J=1, and all 1,984
challenge observations score without validation/execution failures. Scorer,
challenge, policies and prompts are unchanged. The previously resolved bound
reporting and E-2 findings remain covered by the focused harness suite.

Current hashes/results are in `mechanical-results.json`; the field ledger is
`reconciliation-fields.json`. Generated integration artifacts are retained in
`artifacts/provenance-r4/`. Calibration/adjudication and the fresh held-out bank
requirement remain external continuation gates; no paid work or adjudication ran.
