# Rationale pilot evidence delivery

Base `3c15d25abecef4821a07baed6a7ecd7227d44ccc` (frozen runner #74).
Preserve this one-shot experiment, including failures; do not modify its fixture,
runner, model prompts, old reports or ledger to improve reported results.

## Acceptance

1. Export a closed public projection of the exact frozen 16-arm report. Retain
   every arm, statuses, partial capture outcomes, memory interpretations,
   source receipts, rationale graphs, recall context, cold checks and costs.
   Omit paths, credentials, authorization tokens, namespace identity and raw
   transport metadata. Reject sensitive retained text rather than publish it.
2. Record source/fixture/artifact hashes and distinguish observed mechanical
   completion from pending or performed independent semantic review. No automatic
   keyword scorer may declare reliability. Failed/missing outcomes stay visible.
3. Independently review original sources against proposed links and returned
   context using the already frozen rubric. Publish disagreements/limitations,
   not only successes. No live retry; any halted remainder remains not-run.
4. Tests cover fixed identity/denominator, private-field removal, sensitive-text
   rejection and retention of failures. Generic/plugin checks and both Node
   live-offline suites, independent dual review and CI precede merge.

No publication of the private raw report, new provider call, release or deployment.

## Verification record

Node 22.16.0 and 24.15.0 generic tests, JSON/version/plugin validation and complete
live-offline suites passed before the final projection additions (117 pass,
30 installed skips per runtime). After retaining provider proposals separately
from exposed graphs, the final affected export suite passes 4/4 per runtime,
including frozen public hash and 8-proposed-versus-4-exposed preservation.
The complete raw live report is immutable and its source-linked export has been
checked against both reviewers' independent source judgments. Independent code
review of this final committed diff and CI are still required before merge.
