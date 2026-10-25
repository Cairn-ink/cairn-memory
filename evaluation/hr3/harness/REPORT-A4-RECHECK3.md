# A-4 third-recheck accounting contention repair

The accounting path now waits asynchronously for transient lock contention instead of losing a received provider reply. The wait is bounded at 15 seconds per accounting operation, with 5 ms initial backoff doubling to 100 ms; configuration cannot exceed 30 seconds. The five-minute progress deadline, transport retry allowance, models, token/byte limits, budget caps and scoring rules remain unchanged. No paid readiness, review, supervision attestation or real freeze is produced.

## Fix

`GuardedTransport.accounting()` retries only a synchronous accounting operation that returned ledger_locked. Reserve, settlement, failure recording, stops, authoritative progress checks and runner snapshots all use it. It never invokes the provider. The existing attempt identity and full reservation survive the wait. Only a genuine TransportError permits the existing single provider retry, and only after its failure record has been accounted for.

`Ledger.writerPriority()` creates a distinct intent for each pending accounting operation. Read-only observations check intents before and after taking their short critical section, and yield while a writer waits. Intents stay registered across asynchronous backoff and are removed in finally. Multiple writers cannot remove each other's intent. Watchdogs report busy without retrying reads, changing the checkpoint, resetting progress or poisoning a healthy writer. Abandoned intents require operator cleanup and do not prevent writers from acquiring the accounting lock.

Each received JSON reply is written in full to a mode-0600, independently fsynced response record before post-reply accounting. The record binds attempt ID, logical ID, operation and request-body hash. Successful settlement removes and fsyncs it. Any accounting failure leaves the reply available. If contention exceeds the bound, a separately fsynced accounting-stop sidecar records the operation and response reference. It never replaces a checkpoint or releases any reservation. A fresh ledger sees the stop and denies new reservations/dispatch. Reconciliation is explicit: there is no automatic settlement, charge release or provider replay.

The harness runner awaits these accounting operations, including authorization/embedding stops, and includes retained response and stop files in its explicit artifact manifest. Failure reports can use an explicitly marked last coherent accounting snapshot if the lock is still unavailable; they do not call the same failing immediate snapshot again and hide the original stop. Artifact references are relative. Journal/checkpoint formats and configuration hashes remain compatible; run artifacts advance to hr3-run-a4-recheck-v4. evaluation/hr3/runner/ remains untouched.

## Regression evidence against 2221f923

The fixture sources are exact committed bytes, independently copied from Git and compared with the task-entry workspace:

- ledger.mjs: f67e392aa9c95db171f5c9ff33806771ddeb4f6941d6baff33098af017a4a396
- transport.mjs: 2d9ecd49ae1607711248bba55390d7801e6eb9bfa9b85feeb3e61e1d8ddd93be

The tests execute those actual classes in a VM with real local files and controlled competing locks. They do not replace the accounting algorithm or rely on a missing import/helper to make the old code fail. Every provider response is a local stub.

`HR3_CONTENTION_BASELINE=1 node --test --experimental-test-isolation=none --test-name-pattern='recheck3 contention:' evaluation/hr3/harness/test/ledger-contention-a4.test.mjs` — **0 pass / 3 fail, exit 1**. Each named regression fails with ledger_locked on 2221f923. See [red TAP](reports/recheck3-red-final.tap) and the source hashes in [baseline](reports/recheck3-baseline.json).

| Regression | 2221f923 | Repaired behavior |
|---|---|---|
| recheck3 contention: monitoring lock at reply settles once after release with one dispatch | Reply rejected with ledger_locked; no settlement | Exact reply returned, one dispatch and one settlement |
| recheck3 contention: exhausted reply wait stops durably with reservation and response retained and no redispatch | Immediate ledger_locked; reply absent; next attempt fails request_already_reserved | Bounded stop, full outstanding reservation and exact reply retained; same guard and fresh ledger both deny redispatch |
| recheck3 contention: busy watchdog yields to pending writer without starvation | Immediate ledger_locked during the monitoring overlap | Both watchdog and independent observer yield; writer settles once and remains healthy |

Independent readback evidence: reports/recheck3-{reply,exhausted,watchdog}-{baseline,current}.json. The exhaustion test reads the response from disk, checks its exact contents and mode, instantiates a fresh ledger and guard, and verifies no journal/checkpoint change or extra dispatch. Earlier rollback, checkpoint-race, conditional-rejection, supervision and financial-cap tests remain in the ordered suite.

Additional regressions cover transient contention in reserve, settle, failure and stop; exhausted pre-dispatch, settlement and failure recording; multiple independent writer intents; runner-style snapshots; and rejecting a contention ceiling that could approach the five-minute stall limit.

The final durability pass fsyncs the response directory's parent and tracks explicit watchdog-stop accounting until the runner drains it before failure/artifact publication. `recheck3 accounting: watchdog stop drains bounded recording before artifact reporting` tests the held-lock stop, immediate abort, eventual single stop record, retained reservation and cleared writer intent. The earlier busy-watchdog regression keeps every assertion and now awaits supervision shutdown after releasing its test lock, reflecting the awaited accounting lifecycle. Focused four-file verification passes **59/59, exit 0**; the three required old-source regressions still fail independently (**0/3, exit 1**).

`recheck3 accounting: settlement backoff cannot reset an elapsed five-minute deadline` independently reproduces a reply arriving just before the deadline and a lock wait crossing it. The pre-guard repair returned the reply and reset progress: **0 pass / 1 fail, exit 1** (reports/recheck3-deadline-red.tap). Every settlement retry now rechecks the supervision stop and elapsed deadline before changing usage. The repaired case persists the five-minute stop, retains the reply/full reservation and never redispatches. The final focused suite passes **60/60, exit 0**.

## Locations

| Fix | File:line |
|---|---|
| Bounded accounting-only retry | `transport.mjs:17` |
| Durable stop on exhausted contention | `transport.mjs:28` |
| Full reply persistence and directory durability | `transport.mjs:55` |
| No provider redispatch for accounting | `transport.mjs:95` |
| Deadline/stop check on every settlement retry | `transport.mjs:118` |
| Writer intents and reader yielding | `ledger.mjs:103` |
| Reader checks before and after lock acquisition | `ledger.mjs:112` |
| Resumed ledger denies reservations after the independent stop | `ledger.mjs:144` |
| Await stop recording before failure/artifact publication | `runner.mjs:96` |
| Authorization stop awaits accounting | `product.mjs:182` |

## Final verification

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0; all 21 ordered commands exited 0**, PASS_OFFLINE_PENDING_PRIMARY_FREEZE. Final artifacts: `evaluation/hr3/harness/artifacts/a4-verification-DwUbeD`. [Ordered result](reports/a4-verification.json); [independent postflight](reports/recheck3-postflight.json). The two preceding complete verification passes also exited 0 (313 and 314 harness tests respectively); their retained records distinguish those earlier runtime bytes from the final pass.

| Suite | Pass | Fail | Exit |
|---|---:|---:|---:|
| Generator | 43 | 0 | 0 |
| Harness | 315 | 0 | 0 |
| Integration | 20 | 0 | 0 |
| Scorer | 52 | 0 | 0 |

All **15 new tests**, every earlier ledger regression and all independent missing/stale paid-preflight tests pass. The focused four-file run passes **60/60, exit 0**. Required 2221f923 regressions fail **0/3, exit 1**, each with ledger_locked; the additional deadline-edge red case fails **0/1, exit 1** before its guard. All **seven changed JavaScript files** pass node --check, each exit 0. Git diff --check, diagnostic portability normalization, certificate rebinding and independent postflight each exited 0. Only **three newly generated diagnostic files** had workspace prefixes removed; scientific artifacts and actual exit codes were unchanged.

The final full fake pilot completed **240 extractions / 480 answers**, 120 valid per arm, with no stop. The leak scan passed: **240 extraction requests / 480 reader requests / 1747 P payloads**, zero missing/hits and unchanged returned P blocks. The bound-report command exited 0 and remains descriptive, without confidence intervals, bootstrap estimates or uncertainty contrasts. All **eight certificates** bind the current source and runtime bytes; all log digests and all 2,227 pilot manifest entries were independently read back. The completed journal has **5325 records** and its checkpoint/count/head/bytes match exactly. No response or writer intent remains pending in the completed pilot.

Complete reader-request certification remains:

| Arm | Maximum reservation | Ceiling | Headroom |
|---|---:|---:|---:|
| O | 28022 | 32768 | 14.48% |
| P | 35132 | 40960 | 14.23% |
| T | 29343 | 40960 | 28.36% |
| U | 30167 | 40960 | 26.35% |

All complete requests pass the ≥5% gate; all maximal outputs pass ≥10% (worst reader 1,774/2,176; extraction 2,241/4,352). Embedding coverage retains **138 context requests / nine cases**, included before maxima/projections. Research projects **62,757,367 units**, P **23,605,774**, each below 64M. Runtime closure agrees by loader/parser and both external-file routes: **195 modules / 1,480 files**, including 1,240 installed dependency files.

The complete cumulative pilot bound stays **US$30.232574300 ≤ US$50**, including the verified accounting chain; the carry manifest, accounting input, historical fixtures and real freeze remain unchanged. No paid-preflight or primary review/supervision attestation was authored. No network, key reads, paid calls or commit. Primary freeze and non-author review remain external gates.

| Ordered gate | Exit | Command |
|---|---:|---|
| strict-schema | 0 | `node evaluation/hr3/harness/strict-schema.mjs` |
| published-schemas | 0 | `node evaluation/hr3/harness/schemas-a4.mjs` |
| private-field-inventory | 0 | `node evaluation/hr3/harness/private-field-inventory.mjs` |
| inspected-references | 0 | `node evaluation/hr3/harness/inspected-references.mjs` |
| runtime-closure | 0 | `node evaluation/hr3/harness/runtime-closure.mjs` |
| context-certificate | 0 | `node evaluation/hr3/harness/context-certification.mjs` |
| cap-certificate | 0 | `node evaluation/hr3/harness/cap-certification.mjs` |
| request-certificate | 0 | `node evaluation/hr3/harness/request-certification.mjs` |
| accounting | 0 | `node evaluation/hr3/harness/accounting-a4.mjs` |
| projection-schema | 0 | `node evaluation/hr3/harness/projection-schema.mjs` |
| budget | 0 | `node evaluation/hr3/harness/budget-a4.mjs` |
| continuation-projection | 0 | `node evaluation/hr3/harness/continuation-a4.mjs` |
| generator-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` |
| scorer-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/scorer/test/canonical.test.mjs evaluation/hr3/scorer/test/citations.test.mjs evaluation/hr3/scorer/test/contract.test.mjs evaluation/hr3/scorer/test/schema-cli.test.mjs evaluation/hr3/scorer/test/scorer.test.mjs` |
| integration-tests | 0 | `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` |
| harness-tests | 0 | `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/inputs --out evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/pilot evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/inputs --out evaluation/hr3/harness/artifacts/a4-verification-DwUbeD/bounds.json` |
| certification-bundle | 0 | `node evaluation/hr3/harness/certification-bundle-a4.mjs` |

## Changed files

[Complete manifest](reports/recheck3-changes.json): **6980 changed/new files**, comprising **77 Git-visible files and 6903 retained ignored artifacts**. Two independent routes agree exactly: Git tracked differences plus all untracked paths (including ignored), filtered against task-entry content hashes; and a recursive filesystem/Node SHA-256 inventory against that same clean 2221f923 baseline. **12 source/document/test/fixture files** are listed below. All **66271 pre-existing artifact files** are byte-identical. Every listed file hash is read back; the manifest lists itself without a self-hash to avoid circular binding. All repository changes are confined to harness.

- [PAID-PREFLIGHT-A4.md](PAID-PREFLIGHT-A4.md)
- [README.md](README.md)
- [REPORT-A4-RECHECK3.md](REPORT-A4-RECHECK3.md)
- [ledger.mjs](ledger.mjs)
- [product.mjs](product.mjs)
- [runner.mjs](runner.mjs)
- [test.mjs](test.mjs)
- [test/fixtures/ledger-2221f923.mjs.txt](test/fixtures/ledger-2221f923.mjs.txt)
- [test/fixtures/transport-2221f923.mjs.txt](test/fixtures/transport-2221f923.mjs.txt)
- [test/ledger-contention-a4.test.mjs](test/ledger-contention-a4.test.mjs)
- [test/ledger-race-a4.test.mjs](test/ledger-race-a4.test.mjs)
- [transport.mjs](transport.mjs)
