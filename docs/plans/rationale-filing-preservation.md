# Preserve rationale through filing-only revisions

## Contract

RF1. With the existing opt-in capture rationale path, capture a decision and a later challenge using a scripted model. If filing changes only a memory's filing status, revision and update timestamp, its existing receipt-bound rationale proposals remain inspectable at the new revision, including after reopening the store. The original decision stays current; a challenge remains a reconfirmation suggestion, not an adopted replacement or a proven invalid premise. Assert retained content and complete receipts are unchanged.

RF2. Preserve a valid incident proposal exactly once when both endpoints change filing revision in one placement batch or when an edge refers to a single memory on both sides. Exercise unfiled-to-filed, filed-to-unfiled and filed-to-another-MOC transitions. Old revision refs must fail; index epoch and in-flight review/recall freshness checks must still reject stale snapshots. Filed-to-filed changes that do not revise memory must not duplicate edges.

RF3. Preservation is limited to the placement transaction's filing-only memory updates. Content correction, receipt insertion/update/removal, forgetting, retirement, namespace mutation and an arbitrary revision update continue to invalidate incident proposals. Never restore an already absent edge or an edge with a missing, stale, foreign or deleted endpoint or an invalid receipt digest.

RF4. Collect only valid existing incident rows for memories whose revision actually changes, before placement updates. Rebind endpoint revisions only after all memory updates, inside the existing transaction. A restoration failure rolls back placement, rationale, MOC and epoch changes together. Do not change the global rationale invalidation trigger, storage schema, public API or model behavior.

## Verification

Run the new focused regression red against the fixed base, then green after the fix. Run targeted rationale, MOC, capture and recall tests on supported Node 22.16 and 24, plus the repository validation gate. Use only synthetic local databases and scripted models; no paid calls or production access. Report command outcomes and any environment-specific exceptions.

This is a link-lifecycle correctness fix, not evidence that proposed links are semantically correct or that decision evolution is implemented.

## Implementation checkpoint

- Fixed base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`; worktree `fix/rationale-filing-preservation`. A bounded worker owns the storage change, regression and docs; primary owns acceptance, full-suite verification and independent review. No new API, schema migration, provider call or production data is involved.
- Red on the fixed base: `node --test core/test/rationale-filing.test.mjs` reached two captured rationale edges before placement, then failed RF1 because the after-placement status was `unassessed` instead of `reconfirmation-suggested`. An initial test-fixture error (reading content from a list summary) was corrected before treating the result as a bug signal.
- Green after the change: `node --test core/test/rationale-filing.test.mjs` passed 18/18 on Node 22.16; Node 24.15 passed 59/59 across the new regression plus existing rationale, MOC and automatic-rationale tests. `npm run validate` passed. The first expanded regression run exposed two test setup errors: captured qualification prevented direct receipt deletion and public supersede required a qualified transition; unqualified explicit-admission fixtures now exercise those real paths. The first metadata-race test returned `storage_error` before the raw receipt comparison; validation order was tightened and the final test passed.
- Two simultaneous full-core runs were stopped before completion to avoid duplicating the primary's final gate. They are not counted as passes. Final all-core, demos and delivery checks are primary-owned and pending at this checkpoint. No performance, token/cost or model-quality measurement was made.
