# A-4 implementation recheck repair

All three recheck findings are implemented. **Full ordered verification passes: 21/21 commands, root exit 0; harness 291/291.** No paid readiness is claimed. Primary freeze and a passing non-author review remain required; no attestation is generated.

## P1: journal rollback

`ledger.mjs:8` defines the durable checkpoint; `ledger.mjs:35` latches rejection; `ledger.mjs:42` verifies presence, nonempty content, exact pinned configuration, valid chain, checkpoint and accepted prefix. `ledger.mjs:82` persists a checkpoint only after journal fsync. Memory retains the last accepted count, byte position and hash head. A separate atomically replaced/fsynced `ledger.jsonl.head.json` binds those values and the configuration digest. Journal loss or valid-prefix rollback alone cannot rewind it. A detected rejection is sticky, including a durable blocked reason when a trusted checkpoint is available.

New writer version is hr3-ledger-a4-v2. Historical journals are not reinitialized, upgraded or changed. New journals require both configuration and checkpoint; a complete append left ahead of its checkpoint by a crash requires reconciliation rather than replay. The transport checks again immediately after reservation (`transport.mjs:28`). Run manifests include the checkpoint (`runner.mjs:54`), and reports verify it against the final journal (`bounds.mjs:173`). The artifact manifest version is hr3-artifacts-a4-recheck-v3.

Critical exact regression names:

- recheck ledger deleted stops before reservation and dispatch
- recheck ledger empty stops before reservation and dispatch
- recheck ledger valid-prefix stops before reservation and dispatch
- recheck ledger configuration-replaced stops before reservation and dispatch
- recheck ledger configuration-missing stops before reservation and dispatch
- recheck ledger durable head rejects a valid-prefix rollback after restart

Additional exact regression names:

- recheck ledger head-missing cannot clear an accepted stop
- recheck ledger head-stale cannot clear an accepted stop
- recheck ledger restored-after-rejection cannot clear an accepted stop
- recheck ledger valid forward progress survives restart with the same durable head
- recheck ledger carried exposure cannot disappear with the journal
- recheck ledger memory anchor rejects rewinding both files within the process
- recheck ledger uncheckpointed complete append stops instead of replaying after restart

All 22 new names appear in reports/recheck-regressions.json.

The first six tests failed **0 pass / 6 fail, exit 1** before the fix. reports/recheck-ledger-baseline.json proves that the tested ledger bytes were identical to feb05af6 (SHA-256 c1bb83ff0189c9818d5eb2f384ef4afae57d082a34ec934c004a07ed28f1aa7a). The deletion/prefix/configuration cases use a guarded local stub, require zero dispatches and verify that no reservation was appended to the damaged journal. These are behavioral failures, not missing-helper imports. An additional independent old/current replay uses valid local stub replies and the real carried accounting snapshot: `node evaluation/hr3/harness/test/probe-ledger-recheck.mjs`, **exit 0**. In all three critical cases the old implementation dispatches once; the fixed implementation dispatches zero times and leaves damaged journal evidence unchanged. All values below are nanodollars; null after-exposure for the fixed version means accounting is refused, never reset to zero.

| Mutation | Old exposure before | Old exposure after | Old dispatches | Fixed dispatches |
|---|---:|---:|---:|---:|
| Deleted journal | 2,150,310,240 | 2,000 | 1 | 0 |
| Valid-prefix truncation | 2,150,310,240 | 2,136,863,040 | 1 | 0 |
| Replaced configuration | 2,150,310,240 | 13,451,200 | 1 | 0 |

See reports/recheck-ledger-replay.json; this replay is separate from the 291-test suite and uses no paid transport.

## P2: context embedding measurements

`embedding-measurement-a4.mjs:5` is the shared provider-body construction/validation and per-input/request unit/byte/hash measurement. Both reference and context embedders use it. `context-certification.mjs:13` records research and product requests for every adopted, unresolved and shared-turn context/language case. `request-certification.mjs:101` runs context conformance and merges its measurements before `summarizeEmbeddings` computes maxima, totals, largest-family bounds and conservative cumulative projections.

Exact regression names:

- recheck context embeddings: all nine cases measure and validate both channels
- recheck context embeddings: context samples participate in every maximum and cumulative projection
- recheck embedding certificate: context requests are merged before maxima and cumulative projections

The pinned feb05af6 context producer executes all cases but fails the first regression on absent embedding measurements: **0 pass / 1 fail, exit 1**. A deliberately larger context sample independently proves that maxima and cumulative projections change; oversized requests are rejected. This is not a source-order-only assertion.

## P2: execution dependency configuration

`dependencies.mjs:11` rejects alternate installations and symlink aliases before resolver registration or package import. Omitted CLI options now select the exact approved MCP/tokenizer roots. Resolution hooks also reject node_modules targets outside those bound installations. `dependencies.mjs:34` verifies actual package resolution; `runner.mjs:39` calls it before output directory or journal creation. The run records the same normalized dependency configuration. `runtime-closure.mjs:4` derives its external inventories from that verified configuration, and `paid-preflight.mjs:48` requires the frozen configuration to match execution.

Approved roots remain adapters/mcp/node_modules and adapters/openai/node_modules. No real-CLI change is needed: cli-real.mjs already calls useInstalledDependencies before importing the runtime or constructing the key-reading transport. evaluation/hr3/runner/ is unchanged.

Exact regression names:

- recheck dependencies: unapproved mcp installation is rejected before import or journal
- recheck dependencies: unapproved tokenizer installation is rejected before import or journal
- recheck dependencies: runner rejects a foreign resolver before creating its output directory
- recheck dependencies: execution and closure use the same approved configuration

Fake unapproved packages have observable import markers. The pinned feb05af6 resolver imports them and fails both regressions: **0 pass / 2 fail, exit 1**. The new implementation rejects before either marker or journal is created. A foreign-resolver test independently exercises the runner entry check with zero dispatches and no output directory.

## Direct original/current freeze-output regression

Exact name: recheck freeze output: original producer omits runtime members while current output hashes their actual bytes.

The test executes the actual pinned dd01b643 freeze producer and current freeze producer with identical isolated read-only inputs and an in-memory output sink. It verifies emitted hashes, not just a helper's membership list. The original output omits scorer slots/contract, generator slots, real runner, pinned product/MCP and installed WASM members; the current output hashes every runtime/dependency byte. reports/recheck-freeze-output.json records producer source hashes, omitted members and output counts. The isolated two-file authoring fixture produces 2 hashes under the old algorithm and 1,481 under the new algorithm, including all 1,480 actual runtime/dependency files. These are test-fixture output counts, not a production freeze inventory. No freeze file is written by this test. The primary still runs the real freeze.

Historical producer snapshots are hash-pinned in fixtures; the independent ledger replay separately pins the exact feb05af6 ledger digest. The initial dependency baseline attempt encountered sandbox EPERM launching git, and the initial context replay had an unresolved relative dynamic import. Those setup failures are retained and are not counted as behavioral red evidence; pinned snapshots and explicit in-memory import rebasing resolved them. An initial freeze replay fixture incorrectly masked a report file; the corrected replay verifies its actual bytes. Final regression evidence uses the corrected runs.

## Verification and delivery

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0**, PASS_OFFLINE_PENDING_PRIMARY_FREEZE. [Ordered record](reports/a4-verification.json); artifact directory `evaluation/hr3/harness/artifacts/a4-verification-kQQNtI`. All 21 child exits were read back from their separate .exit files; all log digests and eight certificates' source/closure bindings match current bytes. [Postflight](reports/recheck-postflight.json).

| Suite | Pass | Fail | Exit |
|---|---:|---:|---:|
| Generator | 43 | 0 | 0 |
| Scorer | 52 | 0 | 0 |
| Integration | 20 | 0 | 0 |
| Harness | 291 | 0 | 0 |

The full fake pilot completed **240 extractions / 480 answers**, 120 valid per arm, no stop. Complete leak scan **exit 0**: **240 extraction bodies / 480 reader bodies / 1,747 P payloads**, zero missing, zero hits, returned P blocks unchanged. Bound report **exit 0**, no intervals or inference. The actual run dependency configuration equals the independently derived closure configuration. Its completed manifest binds all **2,227 files**, including the durable ledger checkpoint; checkpoint count/head/byte position match the final journal.

Embedding certificate: **138 context requests (84 research / 54 P), all nine cases**, merged into **11,174** total measured requests before all maxima/projections. Max input **1,220/8,192 units**, max request **3,379/300,000 units**, max body **3,798/2,097,152 bytes**. Cumulative research **62,757,367/64M**, P **23,605,774/64M**. Largest measured family totals remain **29,998 research / 12,574 P units**; the new cases do not increase those existing maxima. Complete-request headroom remains ≥5%; output headroom remains ≥10%. Cumulative pilot bound remains **$30.232574300 ≤ $50** with the complete verified carry. Historical accounting inputs, journals and carry manifests remain byte-identical.

Runtime closure: **195 modules / 1,480 bound files / 1,240 installed dependency files**, cross-checked through loader/static graph traversal and independent external inventories. Fixed counts now describe the exact configuration accepted at execution. No unapproved override is accepted.

Focused safety matrix: **19 pass / 0 fail, exit 0**. Earlier focused module run: **17 pass / 0 fail, exit 0**, before adding five more cases; all 22 are included in the final 291-test suite. The independent old/new ledger replay exits **0**. All **17** changed JavaScript modules pass `node --check`, each exit **0**. Portable diagnostic normalization, certificate rebinding, source/log/checkpoint readback and `git diff --check` exit **0**. Only six newly generated diagnostic logs were normalized; scientific artifacts are unchanged.

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
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/inputs --out evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/pilot evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/inputs --out evaluation/hr3/harness/artifacts/a4-verification-kQQNtI/bounds.json` |
| certification-bundle | 0 | `node evaluation/hr3/harness/certification-bundle-a4.mjs` |


[Changed-file manifest](reports/recheck-changes.json) is derived against the task-entry content snapshot, using Git tracked differences plus all untracked paths (including ignored) and an independent recursive content-hash inventory. **2381 changed/new files: 80 Git-visible and 2301 ignored retained artifacts; 26 source/document/test/fixture files.** Exact set equality, exit **0**; all **57069** pre-existing artifact files are byte-identical. Every manifest file hash was read back independently (the manifest's own hash is excluded to avoid a circular binding). All repository writes are confined to harness; evaluation/hr3/runner/, generator/scorer gold/tests and product modules are unchanged. The primary's real freeze file remains unchanged. No caps, models, prices, retry limits, sampling rules, gold or scientific thresholds changed. Source edits are confined to harness. No network, key, paid call or commit.
