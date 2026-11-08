# Default recall recency scan

Implemented on `feat/recall-recency-keyset`, based on `56968dca`. Local commit
only; no push. All data and model ports used below are synthetic and offline.

## Behaviour and layout check

Every recall mode uses `namespace_memories` in `updated_at DESC, id ASC` order.
The scan visits at least 1,024 physical nondeleted rows, then applies
`QUERY_SCAN_BUDGET_MS = 400` from `core/query-candidates.mjs`, with a 20,000-row
cap. Historical, awaiting and projection-rejected rows consume the allowance.
The existing overlap/ID comparator retains the best 1,024; recency only orders
the scan. Body-only scoring reads zero receipts; source modes retain four.
The old constructor policy and ID-prefix branch are removed.

Schema-source review covered the base creation/v1 migration, subsequent plain
layouts, existing-store validation, safety layout resolution, product index
attestation and Card-lineage base declarations. All retain the exact index:
`owner_id, scope, project_id, deleted, updated_at DESC, id`, nonunique,
nonpartial, with BINARY collation. No schema, index or migration is added.
Both Nodes pass 25 executable layout cells: all 21 serving versions plus four
Card-lineage/event-time combinations. First, continuation and interrupted-prefix
query plans use this index without a temporary B-tree.

Deferred scan and placement pages release SHARED between pages and check
256-row/25-ms holds between rows. One observed epoch change abandons the pass
and restarts with its floor and the original clock. On a second change,
discovery stops; only the prefix bounded by the interrupted pass's last key
and row count is revalidated under the new epochs. This reconciliation, like
cursor replay, ignores the time budget but never extends past that prefix.
Further movement fails the existing final freshness check. This interpretation
keeps partial delivery safe and its cursor reproducible.

Signed cursor anchors bind rows visited, the last key and stop cause under
`literal-recency-keyset-overlap-v3`. Continuations replay exactly that boundary
without the time budget and reject stale epochs. Budget/cap exhaustion,
interruption and top-K pruning set `scanExhausted:false`; private pages use
`exhausted:false` and existing recall coverage values. No public response field,
retry status, partial reason or error enum is added for budget exhaustion.

## Verification

Each file ran separately through the shared slots 2–3 runner, under its own
900-second foreground timeout with `nice -n 19 ionice -c3`. The table contains
actual process exit codes, without output pipelines.

| Test file (`core/test/`) | Node 22.16.0 | Node 24.22.1 |
| --- | ---: | ---: |
| `recall-recency-scan.test.mjs` | 0 | 0 |
| `recall-recency-layout.test.mjs` | 0 | 0 |
| `query-candidates.test.mjs` | 0 | 0 |
| `bounded-keyset-candidates.test.mjs` | 0 | 0 |
| `recall-excerpt-cursors.test.mjs` | 0 | 0 |
| `recall-read-transaction.test.mjs` | 0 | 0 |
| `recall-discovery-statement-reuse.test.mjs` | 0 | 0 |
| `assets-context-options.test.mjs` | 0 | 0 |
| `confirmation-state.test.mjs` | 0 | 0 |
| `content-safety-s2h-split.test.mjs` | 0 | 0 |
| `content-safety-s2h-write-acknowledgements.test.mjs` | 0 | 0 |
| `receipt-event-time-static-gate.test.mjs` | 0 | 0 |
| `recall-budget.test.mjs` | 0 | 0 |
| `recall-diagnostics.test.mjs` | 0 | 0 |
| `no-raw-db-fd.test.mjs` | 0 | 0 |

The new scan suite covers the requested small-store parity, fresh notes,
monotonic budget/floor, cold signed-cursor continuation, overlap ranking,
20,000-row cap, residual filters, foreign rows, DELETE-journal writer progress,
restart, two-change partial reconciliation, a forgotten last key, suppression
and public delivery. Its base helper freezes the `56968dca` candidate algorithm
and literal scorer. The only skipped cases are the existing statement-close
API checks where the Node SQLite binding exposes neither close nor dispose.

The split audit, write-field census and receipt-event-time static gates are
included above, all exit 0 on both Nodes. The census changes only the private
last-position `id` count from five to six; the writer acknowledgement guard is
unchanged. `scripts/validate-json.mjs` exits 0 on Node 22.

| Script | Node 22.16.0 | Node 24.22.1 |
| --- | ---: | ---: |
| `examples/local-store.mjs` | 0 | 0 |
| `examples/moc-placement.mjs` | 0 | 0 |
| `examples/recall.mjs` | 0 | 0 |
| `examples/recall-continuation.mjs` | 0 | 0 |
| `packages/setup/build-runtime.mjs --check` | 0 | 0 |

Bundle regeneration exits 0 on Node 22. The generated archive and manifest
inventory match independently: **386 entries**, no differences.

An initial scan-test run exited 1 because its scripted selector exceeded the
per-namespace reference cap and its frame collector confused fetch and map
responses. Those harness errors were fixed; subsequent runs pass. The diagnostics
suite also initially exited 1 on its old zero-clock-read pin;
that pin now accounts for the scanner clocks and both Nodes pass. The final
prefix fix was followed by targeted reruns on both Nodes.

## Synthetic fresh-note reachability

Each namespace has 150–600-character bodies and 50 latest writes. New hits use
actual default-limit core recall with visible-input-only scripted ports. Base
hits use the frozen candidate helper; a distinctive literal match in its prefix
ranks first. These are mechanical reachability checks, not semantic accuracy.
Both Nodes produced the same counts.

| Current memories | Base hits / 50 | New hits / 50 | Expected base prefix fraction |
| ---: | ---: | ---: | ---: |
| 1,025 | 50/50 (100%) | 50/50 (100%) | 99.90% |
| 2,049 | 27/50 (54%) | 50/50 (100%) | 49.98% |
| 6,500 | 7/50 (14%) | 50/50 (100%) | 15.75% |

## Resource helper

`npm run measure:recall-recency -- N` runs one synthetic cell with a 60-second
child watchdog. Only N=1,000 and N=6,500 were measured here, on Node 22.16.0,
through the shared slots runner; each command exits 0. “Cold” means the first
recall on a reopened core; OS caches are not cleared. Scan timing runs from
physical-statement preparation through the first map envelope and includes
placement/fences. Holds are measured from BEGIN through COMMIT during this
phase. Every seeded physical row is eligible, so the signed boundary determines
scan exhaustion including top-K pruning.

| N | Run | Rows scanned | scanExhausted | Scan ms | Total recall ms | Longest page hold ms |
| ---: | --- | ---: | --- | ---: | ---: | ---: |
| 1,000 | cold | 1,000 | true | 25.660 | 34.516 | 5.432 |
| 1,000 | warm | 1,000 | true | 23.669 | 26.745 | 3.886 |
| 6,500 | cold | 6,500 | false | 77.784 | 86.935 | 4.288 |
| 6,500 | warm | 6,500 | false | 75.485 | 78.385 | 3.925 |

These shared-machine observations are not a latency SLA. The latency owner
will run larger quiet-machine cells and set the final constant separately.

## Pin and file inventories

Three grep passes were independently recorded:

| Search | Matching lines | Files |
| --- | ---: | ---: |
| Policy names and values, including 1024/1,024 | 627 | 216 |
| Names of changed files in tests/fixtures | 442 | 248 |
| Base whole-file hashes of changed files in tests/fixtures | 3 | 3 |

The hash matches are frozen historical archive manifests and remain unchanged.
Current constructor, default-limit, source-policy, cursor-anchor, recency-plan,
transaction-mode, statement-count and diagnostic-clock pins were updated in the
changed tests.
Unrelated token, asset and other limits are unchanged. Broad path matches are
reach inventory, not a request to rerun every importing suite.

The changed-file list was derived from `git diff --name-only` plus untracked
files, then independently from filesystem blob hashes/modes against the base
Git tree. Both routes agree:
**44 files**, no differences. This includes scripts, docs, config and
the generated bundle.

```text
CHANGELOG.md
REPORT.md
core/contract.mjs
core/moc-storage.mjs
core/query-candidates.mjs
core/test/assets-context-options.test.mjs
core/test/bounded-keyset-candidates.test.mjs
core/test/confirmation-state.test.mjs
core/test/content-safety-s2h-write-acknowledgements.test.mjs
core/test/fixtures/content-safety-write-fields.json
core/test/query-candidates.test.mjs
core/test/recall-diagnostics.test.mjs
core/test/recall-discovery-statement-reuse.test.mjs
core/test/recall-excerpt-cursors.test.mjs
core/test/recall-read-transaction.test.mjs
core/test/recall-recency-layout.test.mjs
core/test/recall-recency-scan.test.mjs
core/testing/recall-recency-fixture.mjs
core/testing/recall-scan-clock.mjs
docs/automatic-rationale-loop.md
docs/defaults.md
docs/evidence/long-history-live-pilot.md
docs/evidence/qualification-official-pilot.md
docs/evidence/qualification-official-v3.md
docs/evidence/query-candidates.md
docs/fetch-recall.md
docs/limitations.md
docs/plans/automatic-rationale-loop.md
docs/plans/bounded-keyset-source-candidates.md
docs/plans/comparative-reliability-milestones.md
docs/plans/context-read-b3s-safety-layout.md
docs/plans/current-candidate-allowance.md
docs/plans/long-history-live-pilot.md
docs/plans/long-history-stage-gate.md
docs/plans/mixed-comparison-runner.md
docs/plans/query-candidates.md
docs/plans/source-aware-candidates.md
docs/protocol.md
docs/recall-continuation.md
docs/source-evidence-context.md
package.json
packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz
packages/setup/runtime/engine/manifest.json
scripts/measure-recall-recency.mjs
```

## Deferred

- Larger resource cells and final budget tuning belong to the latency owner.
- Broad CI-covered suites were left to CI under the shared rules.
- The shared rules prohibit editing `evaluation/`. Legacy callers in
  `evaluation/long-history/gate.mjs`,
  `evaluation/longmemeval/mixed-generation.mjs`, and
  `evaluation/architecture/bounded-keyset-measure.mjs` still pass the removed
  constructor option and will need a separate update before those helpers can
  run against this core. The current resource command uses the new helper.

No push, release, provider call or user-data operation was performed.
