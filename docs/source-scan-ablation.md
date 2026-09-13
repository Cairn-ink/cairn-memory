# Source-selection ablation v1

This is an operator-only, one-shot diagnostic comparison. It does not run when
imported, in the product, or as a paid CI test. See the
[acceptance plan](plans/source-scan-ablation.md).

Eight frozen synthetic cases compare normal MOC label selection with opt-in
bounded source scanning over identical manually admitted sources. Sixteen arms
alternate order and use an actual installed core, OpenAI adapter and MCP stdio
host. The only product-call difference is `selectionMode`. Manual oracle
ingestion isolates retrieval; it does not evaluate capture or extraction.

The runner records exact returned source indices and counts required and
irrelevant sources separately. These diagnostic counts are not answer accuracy,
truth, decision-adoption safety or real-user reliability. The rubric is retained
for evaluation but never included in model-facing requests. Independent review
must inspect both successful and failed cases before interpreting results.

## Bounded operator procedure

1. Verify/review a fixed source commit and an installed local artifact. Prepare
   a fresh empty mode-0700 evidence directory. Compute `getSourceScanPins()` and
   record the artifact SHA plus exact existing ledger checkpoint offline.
2. Use `runSourceScanAblation` only under the authorized cumulative experiment
   budget. Supply an explicit parent-only key and single-attempt transport;
   child MCP receives only an authenticated loopback token. Never save the key
   in an artifact, configuration, PR or evidence file.
3. The existing policy binding must exist and remain unchanged. A new exclusive
   `source-scan-ablation-v1-intent.json` in the shared ledger binds this run.
   The attempt permits only baseline select/rank and count routes, at most
   64 HTTP reservations / US$0.32 within the existing US$50 ceiling. The full
   normal schedule uses at most 48 HTTP requests; failures are not retried.
4. Preserve the intent and evidence even if interrupted or failed. Do not reset
   the checkpoint, replace the intent, resume the run or rerun failed arms.
   A fresh directory does not authorize repetition. Unknown provider costs are
   retained conservatively, never treated as zero or a final invoice.
5. Raw reports contain synthetic records and operator paths. Do not publish raw
   artifacts; prepare a reviewed allowlisted public projection after completion.

Use `node --test evaluation/live/test/source-scan-attempt.test.mjs
evaluation/live/test/source-scan-session.test.mjs` for local guard checks.
After the documented adapter installs and `node packaging/prepare-cache.mjs`,
`node --test packaging/test/source-scan-ablation.test.mjs` runs the actual
installed sixteen-arm flow with relevance-blind fake HTTP, not paid inference.
Its deliberately wrong irrelevant-source returns must stay visible in evidence.
