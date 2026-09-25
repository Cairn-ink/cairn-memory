# Bound embedding accounting — offline integration gate

Fixed dependency base: `062b7da4c809d7f35581899918bc16555d61ce4b`
(accepted adaptive guard, PR #235). Branch: `feat/bound-embedding-accounting`.
Primary owns this prospective contract and acceptance. One bounded GPT-6
Sol/high worker implements; two nonauthor reviewers check Standards and Spec.

## Purpose and limits

Prepare shared accounting for a future Cairn/Mem0 comparison without adding
embedding dependencies to the ordinary memory core. Port the accepted explicit
embedding migration from `a9c00a5615e3116213758a8d11bdc3f2fa4f07d5`
(PR #221), integrating rather than overwriting subsequent v1 bound-handle work.
The older migration branch and this base overlap in the ledger handle and
existing-only opener; a blind whole-file replacement is not acceptable.

This packet is synthetic accounting only. It does not authorize a provider
request, migrate the operator ledger, create a mixed-engine grant, run a corpus
or holdout, publish, deploy or merge. The H compatibility probe stays on its
separate accepted v1 checkout. Workers and tests must not open actual budget,
parent/grant, credential, corpus or prior paid-run files. Use fresh synthetic
temporary ledgers only. No refund, reset, implicit retry or budget increase.

## Observable acceptance

- B1 Preserve legacy behavior. Default creation remains exact v1. Existing
  exports, arguments, errors, result shapes, three-channel list, v1 cap
  transitions and bound-handle behavior remain unchanged. Every existing v1
  reader, handle and guard must reject v2; neither `host-embedding` nor a v2
  selector becomes valid through an old API. A stale v1 handle rejects after
  migration. Keep request-guard, phase-quota, runtime and adapter sources unchanged.
- B2 Port the three accepted explicit migration APIs and their tests:
  `inspectExperimentBudgetForEmbeddingUpgrade`,
  `upgradeExperimentBudgetForEmbeddings`, `reopenEmbeddingExperimentBudget`.
  Preserve their reviewed contracts, including own-data configuration snapshots,
  terminal/open bound migration, existing-only opens, exact version checks,
  atomic schema transition and unchanged legacy v2 reopen state shape.
  Import the historical migration plan as history, not present spending authority.
- B3 Add `inspectEmbeddingExperimentBudgetSnapshot(configuration)`: exact-v2,
  read-only, detached deeply frozen `{schemaVersion: 2, ...publicState,
  historySha256}`. It creates no files or sidecars, performs no repair, and
  permits diagnostic inspection of valid pending or overrun state. Reject v1.
  Its digest uses the existing domain-separated embedding convention, covering
  run identity, limits, counters, state and every ordered original rowid and
  attempt field. It is a consistency witness, not a cryptographic authority.
- B4 Add `openBoundEmbeddingExperimentBudget({configuration, authorize})`:
  exact-v2 existing-only writable open. Require open state and terminal history.
  In one transaction, pass the B3 snapshot to a synchronous authorization
  callback, require an undefined return, and verify unchanged identity and
  state afterward. Throwing, promises and other returns refuse and close.
  The resulting handle's `getState()` has B3's shape; reserve/outcome return
  existing public-attempt shapes. No implicit upgrade or HTTP authority.
- B5 The new B3/B4 APIs inspect exact own data descriptors before filesystem
  access and never invoke input accessors. Detach configuration once. Existing
  old entrypoints retain their reviewed behavior. No generic public version
  selector or hidden fallback to v1. Bound mutations must likewise snapshot
  untrusted arguments without an accessor-driven validation/use discrepancy.
- B6 Every bound-v2 operation validates path/device/inode/privacy and a complete
  rowid-aware history witness before and after work, within the transaction.
  Predict the permitted mutation independently (new row, next rowid, counter
  increments or single terminal outcome); compare actual result to that
  prediction. Advance the witness only after commit. Do not bless arbitrary
  resulting state by merely hashing it. Foreign append, settlement, rowid-only
  mutation, cap/schema or path change fences the handle without further work.
  Failed commit closes it; do not refund or pretend a possibly committed
  reservation vanished. Witness comparisons also include configured caps.
- B7 Preserve each original historical row and rowid, including gaps, order,
  succeeded/failed/unknown outcomes, known/null costs, counters and reservations
  during migration. The version-independent history digest stays equal.
  SQLite bytes necessarily change during schema migration; no byte-equivalence
  claim. Read-only and rejected nonmutating checks preserve bytes/state.
  Preserve existing crash, rollback and repeated-bound-migration semantics.
- B8 Existing-only opens cannot create a replacement if the inspected file
  disappears. Test the actual DatabaseSync constructor seam, including special
  character paths, missing file, symlink/hardlink/mode/inode drift before/after
  callback and operations. Do not weaken the newer URL-string opener while
  porting the old URL-object implementation. A malicious callback's arbitrary
  filesystem writes cannot be rolled back by SQLite; test refusal, not undo.
- B9 Embedding and existing channels share one request/money cap. Synthetic
  physical dispatch happens only after reservation, including failed batching
  and individual fallback. Unknown and pending reservations persist; actual
  cost overrun blocks further reservations. Neither an in-memory shadow nor a
  second ledger substitutes for the shared durable record. All old G factories
  deny migrated v2 before claim/reservation/HTTP; test actual factory entrypoints.
- B10 Tests cover B1–B9 with fresh nonempty mixed histories and rowid gaps,
  malformed config/callback/schema/history, accessor getter-call count zero,
  callback mutation/wrong return, pending/overrun bound-open, foreign edits,
  missing-file races and pre/post-commit failures. Include actual migrated v2
  positive paths, not only mocked schema handling. Retain all existing tests.
  At least one new bound-v2 behavior must be observed absent on the fixed base.
- B11 Run both Node 22.16 and 24.15: full budget tests including migrated and
  new bound-v2 tests; complete current request-guard suite; live-evidence-offline
  (includes phase-quota callers, isolated adapters installed); generic tests;
  JSON validation; pinned strict Claude plugin/marketplace validation; budget
  and guard demos. No TypeScript gate exists in this JavaScript repository.
  Primary inspects actual combined diff and independently exercises key paths.
  Separate nonauthor Standards/Spec review the same fixed-base final commit.
  Correct/reverify/rereview before push; exact-head CI must pass before ready.

## Scope and ownership

Allowed: this plan; ledger `evaluation/experiment-budget/index.mjs`; ported
`test/embedding-ledger-migration.test.mjs` and
`testing/embedding-ledger-child.mjs`; new focused
`test/bound-embedding-ledger.test.mjs` and a narrowly scoped synthetic child if
needed; ported `docs/embedding-ledger-migration.md` and its historical plan;
narrow `docs/limitations.md` entry; only append these focused tests to root
`test:experiment-budget` without removing either existing ledger test.

No request-guard/quota/runner/core/adapter changes, dependencies/lockfiles,
CI configuration, models, pricing, transport or actual operational files.
Record affected callers and verification ownership here. If the frozen seam
cannot support the later mixed grant, report the mismatch instead of silently
expanding this packet. Primary alone coordinates shared-file integration.

## Next gate, not included

After accepted offline accounting: separately freeze a mixed-engine grant and
revocable key-owning transport, then a matched runner/rendering/statistics and
resource protocol. Only that complete accepted route can support an explicit
operator migration plan and the original reserved 30-case paired holdout.
This packet supplies no benchmark score or memory-reliability claim.

## Execution record

Implemented locally on the fixed G base; this remains an offline accounting
candidate, not an operator migration or provider launch. The accepted L
migration's three explicit APIs and tests were integrated with G's newer bound
v1 handle and URL-string existing-only opener. New B3/B4 APIs add exact-v2
read-only snapshots and bound accounting. The latter witnesses the complete
rowid-aware state and file identity, predicts each allowed mutation, and
closes on failure without refund or retry. Default v1 creation, its public
shapes and the G guard sources remain unchanged. The imported L plan is
retained as dated history, not a current spending authority.

Affected direct callers are the ledger's v1 create/reopen/bound and cap
transition consumers; their original ledger, bound-ledger, request-guard,
qualification and offline live test owners are included in the matrix below.
The new APIs have no production caller in this packet. The synthetic B9
control exercises every existing G guard factory on migrated v2 and observes
`invalid_ledger` before any claim or fake transport. It uses a test-only
tokenizer import stub solely because the budget test job does not install the
isolated adapter; no guard source is changed. The B9 batch/fallback control
reserves each synthetic physical dispatch in the same durable v2 ledger and
observes the exact `request_cap_exceeded` boundary.

Focused observations: on Node 22.16.0 and 24.15.0, the new bound test passed
13/13. It covers mixed unknown/succeeded history with original rowids 1 and
9, next rowid 10, exact digest equality across migration, pending/overrun
diagnosis, accessor getters zero, a real same-transaction callback rowid edit
that is rolled back, foreign rowid-only edits and path drift, and actual
DatabaseSync URL-string constructor races. A callback filesystem rename is
refused without claiming that SQLite undoes its external write. The accepted
L suite passed 17/17 before the full matrix. Its first imported run had four
test-only fault-hook string mismatches against the newer G implementation;
after matching the actual URL-string source seam it passed. A new child test
also initially passed an extra `filename` configuration field and failed with
`invalid_options`; the child now passes the exact four-field configuration.
These were fixture integration failures, not evidence of a product ledger
failure. The fixed base has no `inspectEmbeddingExperimentBudgetSnapshot` or
`openBoundEmbeddingExperimentBudget` export; the new positive controls
exercise behavior absent there.

Final sequential matrix, with isolated `npm ci` only under `adapters/openai`,
`adapters/mcp` and `tools/plugin-validation`:

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm run test:experiment-budget` | 55 pass | 55 pass |
| `npm run test:experiment-request-guard` | 249 pass | 249 pass |
| `npm run test:live-evidence-offline` | 340 pass, 30 expected skips | 340 pass, 30 expected skips |
| `npm test` | 112 pass | 112 pass |
| `npm run validate` | pass | pass |
| `npm run validate --prefix tools/plugin-validation` (pinned Claude 2.1.260, marketplace and strict plugin) | pass | pass |
| `npm run demo:experiment-budget` | pass | pass |
| `npm run demo:experiment-request-guard` | pass | pass |

Commands used the explicit selected Node binary through `PATH` and
`login=false`; the two matrices did not overlap. `git diff --check` passed.
No TypeScript gate exists here. Primary still owns final fixed-head direct
acceptance, independent reviews, PR and CI. Nothing here authorizes reading
or migrating a live ledger, supplying credentials, making a paid request,
running a comparator, or claiming a semantic result.
