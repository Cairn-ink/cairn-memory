# Explicit embedding-capable ledger: synthetic migration gate

Fixed base: `330ecb13555832003015c5850905860903bfacc4` (accepted PR #218).
Branch: `feat/embedding-ledger-migration`. Primary owns the design and acceptance;
GPT-6 Sol/high owns bounded implementation. This is S3a infrastructure only,
parallel to source-window work, not a comparator score or S3 completion.

## Decision and boundary

The existing ledger's exact v1 SQLite schema permits three channels. An
embedding request cannot truthfully be charged as a completion. Add exactly
one channel, `host-embedding`, behind explicit v2 migration and reopening.
Mem0 chat can later use `host-completion` with a separate immutable stage
grant; never route it through the existing benchmark answer/judge grant.
Those transport and semantic-fairness changes are outside this packet.

The operator campaign ledger is OFF LIMITS to this worker and all tests.
Only new synthetic temporary ledgers may be created, inspected or migrated.
Do not read credentials, source corpora, private run directories or real
accounting files. No API call, actual cap extension, actual ledger migration,
retry, refund, new experiment launch, merge, release or deployment is included.
The last audited cumulative reservation remains USD 86.171460; the operational
cap remains USD 100 and the user ceiling USD 200. This packet changes none.

## Frozen acceptance

- L1 Legacy compatibility: retain exported `CHANNELS` and all existing
  `createExperimentBudget` / `reopenExperimentBudget` inputs, output shapes,
  default schema v1, validations, error behavior and bytes of existing schema.
  An ordinary reopen never migrates a file or accepts `host-embedding`.
  Existing v1 handles reject a file changed to v2 before a subsequent reserve
  or settlement, rather than using a cached schema assumption. An old binary
  cannot read the new schema; document that fact without a compatibility claim.
- L2 Explicit surfaces: add `inspectExperimentBudgetForEmbeddingUpgrade(config)`
  (read-only), `upgradeExperimentBudgetForEmbeddings(options)`, and
  `reopenEmbeddingExperimentBudget(config)`. Common config is the existing
  directory/runId/limitMicroUsd/requestCap tuple, detached once for each new API
  from exact own-data plain-object fields. Reject accessors/custom fields and
  malformed options before filesystem access. Inspection accepts an exact
  valid v1 or v2 ledger and returns exactly schemaVersion, runId, limitMicroUsd,
  requestCap, reservedMicroUsd, requestCount, state, and historySha256; never
  attempt details, source text, file content,
  credentials or a new authority to spend. Reopen requires v2 and never creates
  or upgrades. Its handle retains the existing reserve/outcome/state/close
  semantics but additionally accepts `host-embedding`.
- L3 Binding: upgrade options are the common config plus exactly
  `expectedCheckpoint: { requestCount, reservedMicroUsd }` and
  `expectedHistorySha256` (canonical lowercase 64-hex). Validate and snapshot
  all fields before use. The history digest is domain-separated SHA-256 of a
  documented canonical JSON array containing run identity, unchanged limits,
  totals and state, then EVERY attempt in rowid order with its explicit rowid,
  ID, channel, reservation, outcome and known-or-null actual cost. It excludes
  schemaVersion so a schema-only transition preserves the same digest. Do not
  treat it as a signature or proof against a database owner forging history.
  Check schema, path/privacy invariants, run, limits, checkpoint and full digest
  again under the write transaction, not only in a prior read-only probe.
- L4 Atomic transition: require state open and every historical attempt
  terminal; reject unsettled or overrun ledgers without changing them. Use one
  `BEGIN IMMEDIATE` transaction to rebuild only the attempts table with the
  fourth channel in its CHECK, preserving explicit rowids (including gaps),
  original row order and every field. Keep run_config, application ID, filename,
  run ID, reserved totals, request count and configured caps exactly unchanged.
  Set user_version 2 and revalidate exact v2 schema, integrity, history digest
  and accounting before COMMIT. No table can remain dropped or half-migrated
  on a failure; no reservation is refunded and no attempt becomes settled.
- L5 Recovery/concurrency: the database transaction is the sole durable
  transition; no second authorization file, implicit retry or cross-file
  two-phase protocol is needed for this offline operator API. Success returns
  `{ status: 'upgraded', ...inspection }`; an already-v2 ledger with the exact
  same unchanged checkpoint/history returns `already-upgraded`. If new work
  has occurred, the old upgrade request fails its checkpoint/history binding;
  normal explicit v2 reopening is the subsequent path. Crash before COMMIT
  leaves valid v1, crash after COMMIT valid v2; the same bound request can
  distinguish/recover those states. Concurrent migration/reservation either
  serializes or reports the existing busy/fixed mismatch error, with no spin
  retry. A legacy reservation committed first makes migration refuse its
  unsettled row; if migration wins, a stale v1 handle cannot reserve afterward.
- L6 V2 accounting: continue exact per-attempt reserve-before-use, immutable
  terminal outcomes, unique attempt IDs, nonnegative safe integers, inclusive
  request/money limits, overrun blocking and conservative unknown-cost behavior.
  New embeddings and the original three channels share the SAME counters and
  reservation sum. Reopening after a crash preserves an unsettled embedding
  charge; never silently settle, delete, retry or refund it. This ledger-only
  API does not authorize any HTTP route, model, price or provider attempt.
- L7 Synthetic evidence: prove successful migration preserves all fields and
  rowids in a mixed succeeded/failed/unknown history with known/null actuals,
  including zero reservation, exact limits and legal rowid gaps. Cover empty
  ledgers, repeated bound transition, fresh post-migration work, malformed new
  channels, wrong run/caps/digest/checkpoint, reordered or changed rows, altered
  schema/application ID/modes/symlinks, unsettled/overrun histories and safe
  integer boundaries. Compare original v1 public state and untouched v1 schema
  before/after ordinary use. Use actual child processes and synthetic databases
  for pre-/post-COMMIT crashes, rollback during table-copy/version transition,
  upgrade races and stale open v1 handle access. Fault injection stays in test
  children/import hooks, not a public runtime option. At least one actual v2
  migration/embedding path must fail against the old implementation; unchanged
  historical tests must remain green. A mocked migration alone is insufficient.
- L8 Delivery: inspect affected imports and exact-schema consumers, and record
  test owners. Worker and primary run full experiment-budget and request-guard
  suites and demos, live-evidence-offline (both isolated adapters installed),
  generic tests, JSON and isolated pinned strict plugin validation on Node
  22.16 and 24.15. Inspect full diff and freeze a clean candidate. Independent
  Standards and Spec review the same full fixed-base diff. Correct/reverify/
  rereview, then dependent PR and every exact-head CI check. No paid guard,
  actual migration or S3 promotion follows from offline success.

## Allowed scope

This plan; `evaluation/experiment-budget/index.mjs`; focused new tests under
`evaluation/experiment-budget/test/` and synthetic child helpers under its
`testing/` directory; technical `docs/embedding-ledger-migration.md`; a narrow
entry in `docs/limitations.md`; and only the `test:experiment-budget` command
in root `package.json`, appending the new focused test path to the existing
ledger test path. Do not replace the old test, use a broad unrelated glob or
alter dependencies, lockfiles, other scripts or CI workflow. Inspection found
that this command explicitly names just `ledger.test.mjs`, so without this
narrow integration the new migration tests would not run in CI. This scope
addition is frozen before editing that command; L8's full-suite evidence and
exact-head CI must include the new tests, not only a separate manual invocation.
Share version-aware internal validation/handle
logic where safe without widening legacy v1 behavior. No root dependency,
storage-core schema, request-guard implementation, live runner, pricing,
Python gateway, corpus, product host, release artifact or CI workflow change.
Report any interface mismatch to primary before expanding scope.

## Acceptance and next step

Planning only; implementation and gates pending. Passing L1–L8 establishes an
explicit synthetic-tested accounting transition, not a usable competitor
transport. Next S3b must freeze a separate Mem0 stage grant, bounded chat and
embedding requests/usage, every-attempt accounting including fallback,
key-owning Node loopback gateway, child termination and fake-HTTP tests. Only
after independent review, official price verification, temporal-treatment and
matched-roster decisions may primary plan a new paid phase within the unchanged
cumulative ceiling. Never infer authority to migrate the real ledger here.
