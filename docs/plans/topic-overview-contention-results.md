# E1-C: topic overview reads under concurrent writes (measurement results)

Status: phase 1, measurement only; production behaviour is unchanged. Product issue: E1-C (`storage_busy` on `readTopicOverview` while the same store takes public writes).

## Method

The opt-in harness is `npm run measure:topic-overview-contention` (`tools/testing/measure-topic-overview-contention.mjs`). It ran on Node 22.16.0 under the machine-wide queue.

- **Stores.** Synthetic stores with 1,112 Memories, 4 namespaces and 71 MOCs, on schema 29 (current) and schema 18 (the product's production layout).
- **Trials.** 190 trials of 30 seconds each, 5 alternating repetitions. Every trial uses a fresh store clone and fresh reader/writer Workers.
- **Writers.** None; public Memory writes for the same owner; public Memory writes for another owner; Raw capture (schema 29 only, because enabling Raw on schema 18 would migrate the store).
- **Readers.**
  - **as-is:** the current reader, with `busy_timeout=0` (`core/read-database.mjs:26`);
  - **bounded:** a candidate that waits at most 250 ms for locks inside the existing deadline, measured only on a private patched copy;
  - **no-reader:** a writer-only baseline.
- **Pre-registered thresholds (unchanged).** For the bounded candidate under DELETE: zero `storage_busy`, reader p95 ≤ 250 ms, writer throughput ≥ 90% of the no-reader baseline, and writer p95 ≤ 250 ms.
- **Raw report.** SHA-256 prefix `0107ae04358b24a6`, kept with the dispatch record.

## Results (5 repetitions per cell)

| Schema | Journal | Writer | Reader | `storage_busy` % mean [min, max] | Reps failing gate | Reader p95 median (ms) | Writer commits/s | Writer p95 median (ms) | Writer rate vs no-reader, mean [min] |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 18 | DELETE | other-owner | as-is | 81.08 [62.85,94.20] | 0 | 2.0 | 16.6 | 37.2 | 1.01 [0.44] |
| 18 | DELETE | other-owner | bounded | 0.55 [0.00,2.11] | 3 | 36.5 | 18.0 | 36.9 | 1.13 [0.73] |
| 18 | DELETE | other-owner | no-reader | - | 0 | - | 17.5 | 39.1 | 1.00 [1.00] |
| 18 | WAL | other-owner | as-is | 0.00 [0.00,0.00] | 0 | 2.5 | 35.0 | 11.8 | 1.04 [0.99] |
| 18 | WAL | other-owner | bounded | 0.00 [0.00,0.00] | 0 | 2.6 | 32.1 | 16.5 | 0.96 [0.75] |
| 18 | WAL | other-owner | no-reader | - | 0 | - | 33.8 | 11.5 | 1.00 [1.00] |
| 18 | DELETE | same-owner | as-is | 82.81 [75.24,95.17] | 0 | 3.3 | 18.9 | 35.4 | 1.24 [0.98] |
| 18 | DELETE | same-owner | bounded | 0.94 [0.00,1.45] | 4 | 109.6 | 13.9 | 95.8 | 1.12 [0.52] |
| 18 | DELETE | same-owner | no-reader | - | 0 | - | 15.8 | 39.4 | 1.00 [1.00] |
| 18 | WAL | same-owner | as-is | 0.00 [0.00,0.00] | 0 | 4.7 | 30.9 | 20.3 | 1.24 [0.99] |
| 18 | WAL | same-owner | bounded | 0.00 [0.00,0.00] | 0 | 5.2 | 33.1 | 11.4 | 1.33 [0.98] |
| 18 | WAL | same-owner | no-reader | - | 0 | - | 25.1 | 39.8 | 1.00 [1.00] |
| 29 | DELETE | other-owner | as-is | 84.70 [69.42,93.61] | 0 | 1.8 | 13.8 | 116.4 | 0.96 [0.70] |
| 29 | DELETE | other-owner | bounded | 5.88 [0.00,21.70] | 3 | 81.2 | 13.3 | 107.6 | 0.92 [0.42] |
| 29 | DELETE | other-owner | no-reader | - | 0 | - | 14.0 | 107.1 | 1.00 [1.00] |
| 29 | WAL | other-owner | as-is | 0.00 [0.00,0.00] | 0 | 2.4 | 32.2 | 11.5 | 2.55 [0.88] |
| 29 | WAL | other-owner | bounded | 0.00 [0.00,0.00] | 0 | 2.6 | 31.9 | 11.1 | 2.57 [0.76] |
| 29 | WAL | other-owner | no-reader | - | 0 | - | 21.4 | 41.3 | 1.00 [1.00] |
| 29 | DELETE | raw | as-is | 88.19 [83.81,94.50] | 0 | 2.3 | 70.0 | 187.4 | 1.14 [0.60] |
| 29 | DELETE | raw | bounded | 1.79 [0.00,7.18] | 0 | 105.5 | 73.2 | 190.3 | 1.26 [0.43] |
| 29 | DELETE | raw | no-reader | - | 0 | - | 68.4 | 186.4 | 1.00 [1.00] |
| 29 | WAL | raw | as-is | 0.00 [0.00,0.00] | 0 | 3.2 | 164.3 | 83.7 | 1.11 [0.98] |
| 29 | WAL | raw | bounded | 0.00 [0.00,0.00] | 0 | 3.5 | 154.8 | 84.3 | 1.08 [0.56] |
| 29 | WAL | raw | no-reader | - | 0 | - | 155.0 | 80.5 | 1.00 [1.00] |
| 29 | DELETE | same-owner | as-is | 81.18 [70.75,92.20] | 0 | 3.4 | 19.8 | 36.2 | 0.97 [0.42] |
| 29 | DELETE | same-owner | bounded | 1.30 [0.00,5.15] | 4 | 56.4 | 17.8 | 58.8 | 0.87 [0.43] |
| 29 | DELETE | same-owner | no-reader | - | 0 | - | 21.4 | 34.2 | 1.00 [1.00] |
| 29 | WAL | same-owner | as-is | 0.00 [0.00,0.00] | 0 | 4.7 | 31.8 | 19.3 | 1.16 [0.99] |
| 29 | WAL | same-owner | bounded | 0.00 [0.00,0.00] | 0 | 5.4 | 34.7 | 16.4 | 1.30 [0.88] |
| 29 | WAL | same-owner | no-reader | - | 0 | - | 28.2 | 37.0 | 1.00 [1.00] |

## Findings

1. **The report is reproduced.** Under rollback journal (DELETE), the current reader fails with `storage_busy` on **81–88%** of reads during continuous writes, for the same owner, another owner and Raw capture, on both schema 18 and schema 29. The cause is `busy_timeout=0`: a reader fails immediately whenever a writer holds the commit lock.
2. **A bounded lock wait is not a reliable fix under DELETE.** It cuts `storage_busy` to a mean of 0.5–5.9%, but it misses the zero-busy gate in 3–4 of 5 repetitions per write scenario, with a worst repetition of 21.7%. Waiting readers also delay writer commits: the worst repetitions fall to **42–73%** of baseline writer throughput. The candidate therefore fails its pre-registered thresholds and is not adopted.
3. **WAL removes the problem.** Every WAL cell shows **0%** `storage_busy`, a reader p95 of 2–5 ms, and writer throughput at or above the DELETE baseline. This matches the product's own observation ("WAL passed").

## Conclusion and next step

- **For the product's memory-world reads,** the engine recommends running the store in **WAL**. `readTopicOverview` and the E1-M `readTopicMembers` are already exercised on WAL stores (`core/test/topic-overview-raw29.test.mjs`, E1M-08).
- **Under DELETE,** `storage_busy` remains the documented "temporarily unavailable, retryable" outcome. It never means empty.
- **No default changes.** The engine does not change any store's journal mode and does not change the reader's default wait.
- **Switching a production store to WAL** is the product owner's decision. It needs a separately approved plan covering backup/restore (copy the DB and WAL together, or use the online backup), the `-wal`/`-shm` companion files, logical-deletion and erasure limits (WAL frames can retain deleted bytes until checkpoint), and network-filesystem exclusion.
- **Several newer opt-in engine features still require rollback journal and refuse WAL stores today:** private-Card terminal review fences, the context-read sidecar and read-only context readers, and method-package review. Making them WAL-aware is separate engine work, to be planned when the product adopts those features on a WAL store.
