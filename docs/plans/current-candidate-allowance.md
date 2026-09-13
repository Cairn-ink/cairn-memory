# Current-memory candidate allowance

Dependent base: query-candidates `d1381aed856effd4448236a872cf3ecaced92fe9`.
This slice supersedes Q1's raw-row allowance, not its frozen experimental result.
Retaining history must not consume the allowance for finding current memories.

## Acceptance

- C1: Scan at most 1024 current, nondeleted namespace memories plus one sentinel,
  ordered by ID using the existing `capture_current_memories` partial index.
  History/tombstones never consume this allowance. Projection-rejected current
  rows still do. No unbounded scan or missing-index fallback; no new migration.
- C2: Score at most 1024 bodies; sentinel is not scored. Retain all existing
  projection validation, real canonical references, namespace isolation,
  bounded pagination, model budgets and authoritative final validation.
- C3: Bump the private candidate policy binding so old policy cursors cannot
  silently resume under new semantics. Public map/classify and scoring are
  unchanged. A sentinel still reports incomplete coverage with no fake cursor.
- C4: Actual SQLite tests cover 1023/1024/1025 current rows with preceding and
  interleaved historical/deleted records, and current target recall after many
  retired records. Assert scoring counts, sentinel and source receipts.
- C5: Verify namespace-constrained query plan uses the partial index without a
  temporary sort, including reopen and supported migration. Missing index must
  fail closed. Preserve mutation/revision and projection-availability tests.
- C6: Document the changed allowance, retained limitations and separate cost of
  projection/placement lookups. Do not rewrite v1 evidence as v2 evidence or claim
  model-quality/latency improvements from offline index tests.
- C7: Run contributor generic, core, store/MOC/recall/continuation demos on Node
  22.16 and 24, plus offline installed-artifact tests and independent Standards
  and Spec review of one fixed final commit. No paid calls, merge or deployment.

Still out of scope: targets beyond 1024 current rows, semantic/CJK routing,
automatic state-update quality, decision-premise validity, or release readiness.
