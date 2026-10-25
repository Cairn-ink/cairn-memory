# A-4 second-recheck ledger repair

The checkpoint race is repaired. Focused tests pass **45/45, exit 0**, including all earlier ledger regressions. **Full ordered verification passes: 21/21 commands, root exit 0; harness 300/300.** No paid readiness, review or supervision attestation is generated. Primary freeze remains pending.

## Fix and locations

- `ledger.mjs:56` makes read/snapshot observations acquire the same exclusive directory lock as writers. `ledger.mjs:64` captures the checkpoint and revalidates journal/configuration/history only after acquisition; an earlier cached head is never used in place of that fresh validation.
- `ledger.mjs:100` distinguishes authoritative writer transactions from read-only observation. `ledger.mjs:103` keeps private lock ownership and authority state and releases only a lock it acquired.
- `ledger.mjs:39` permits persistent rejection only with owned writer authority. `ledger.mjs:60` checks that checkpoint bytes are unchanged immediately before rejection; if changed, the operation reports ledger_checkpoint_changed without poisoning the checkpoint or latching a stale writer stop. Rejection preserves the newest validated cursor rather than overwriting it with an older acceptedHead.
- `ledger.mjs:109` also requires writer-lock ownership and the unchanged checkpoint check before appending. Direct unlocked mutation is rejected.
- `transport.mjs:12` uses authoritative locked validation for dispatch checks. Watchdog health reads remain read-only; `transport.mjs:28` reports a busy lock without writing blockedReason or poisoning healthy writer state. Existing five-minute stopping behavior remains enforced, including while another writer holds the lock.

No journal/checkpoint format, configuration version, cap, retry rule, model, sampling rule or scientific threshold changed. Existing healthy v2 journals resume with their settled/outstanding exposure, failure and embedding counters intact. No code in evaluation/hr3/runner/ was changed.

## Behavioral baseline and corrected interleaving

The fixture is the exact committed 3e49f0a4 ledger source, SHA-256 **5970aa55fef9e12ba470bc7efeb7b61c1cd4d68655fd3f42b8d4eecc7afdee6b**. reports/recheck2-baseline.json verifies that it matched workspace bytes before the fix. The regression executes that actual class source with a controlled filesystem hook: after the observer reads the two-record checkpoint, a second Ledger instance attempts to commit the third record. It is not a missing-helper import test.

`HR3_LEDGER_RACE_BASELINE=1 node --test --experimental-test-isolation=none evaluation/hr3/harness/test/ledger-race-a4.test.mjs` was run while the file contained the interleaving test: **0 pass / 1 fail, exit 1**. The final single-case replay with `--test-name-pattern='observer cannot replace'` also produced **0 pass / 1 fail, exit 1**; see reports/recheck2-race-red-final.tap. It selects the same pinned old implementation from the final nine-case test file. [Baseline evidence](reports/recheck2-race-baseline.json), [red TAP](reports/recheck2-race-red.tap).

| Observation | 3e49f0a4 | Repaired source |
|---|---|---|
| Third writer commit during observer read | Commits immediately | Reports ledger_locked; commits after observer releases |
| Journal records afterward | 3 | 3 |
| Checkpoint records afterward | 2 | 3 |
| blockedReason | ledger_head_mismatch | absent |
| Writer / fresh resume | Both fail ledger_head_mismatch | Both healthy |
| Checkpoint writes | One rejection without lock | Every write under lock |

[Corrected interleaving evidence](reports/recheck2-race-current.json). The same actual source replay is part of the full harness suite. All test journals are local temporary engineering fixtures and all returned bodies are local stubs; no paid transport or primary freeze runs.

## Regression names

- `recheck2 race: observer cannot replace a fully committed newer checkpoint`
- `recheck2 lock: observer revalidates forward progress after acquiring the lock`
- `recheck2 lock: writer revalidates forward progress after acquiring the lock`
- `recheck2 rollback: monitoring is read-only and a writer persists a genuine rollback under lock`
- `recheck2 rejection: stale observer cannot overwrite an intervening checkpoint`
- `recheck2 rejection: stale writer cannot overwrite an intervening checkpoint`
- `recheck2 mutation: direct rejection and append require writer lock ownership`
- `recheck2 monitoring: lock contention reports busy without poisoning the writer or checkpoint`
- `recheck2 monitoring: five-minute stall still aborts while another writer holds the lock`

The genuine-rollback test first truncates a valid journal while preserving its newer checkpoint. Repeated monitoring reads report the rollback and leave the checkpoint byte-identical. An active dispatch check then revalidates under its writer lock, persists the rejection at the newer cursor, dispatches zero requests and blocks fresh resume. Conditional-rejection tests deliberately bypass cooperative locking to advance the checkpoint after it was read; neither a stale observer nor a stale writer may overwrite that newer checkpoint. Both can revalidate healthy forward state afterward.

All previous regression names and assertions remain. The earlier restored-after-rejection setup now additionally verifies that its snapshot does not persist a blocked flag, then performs an authoritative reserve attempt before restoring the journal. This preserves the original test's persistent-writer-stop guarantee while testing the newly required read-only policy; no earlier assertion was removed.

## Ordered verification and delivery

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0**, PASS_OFFLINE_PENDING_PRIMARY_FREEZE. All **21 ordered child commands exited 0**; each separate .exit file and saved log digest has been read back. [Ordered record](reports/a4-verification.json); artifacts `evaluation/hr3/harness/artifacts/a4-verification-T9RSX9`.

| Suite | Pass | Fail | Exit |
|---|---:|---:|---:|
| Generator | 43 | 0 | 0 |
| Scorer | 52 | 0 | 0 |
| Integration | 20 | 0 | 0 |
| Harness | 300 | 0 | 0 |

All nine new tests and all 13 earlier rollback regressions pass. The full fake pilot completed **240 extractions / 480 answers**, 120 valid per arm, no stop. The leak scan exited **0**: **240 extraction requests / 480 reader requests / 1,747 P payloads**, **zero missing / zero hits**, returned P blocks unchanged. Bound report exited **0** and remains descriptive, without confidence intervals or inference. The final journal/checkpoint pair and all eight certificates' current source/runtime/log bindings verify successfully. [Postflight](reports/recheck2-postflight.json).

Context embedding coverage remains **138 requests / nine cases**, with cumulative projections **62,757,367 research / 23,605,774 P units**, both below 64M. Complete-request and output headroom gates remain ≥5% and ≥10%. The complete cumulative pilot bound remains **$30.232574300 ≤ $50**. No accounting inputs, historical fixtures, carry manifests or original freeze file were changed.

Additional commands: focused three-file tests **45 pass / 0 fail, exit 0**; prior financial rollback replay **exit 0** (old dispatches 1/1/1, fixed 0/0/0); all **five** changed JavaScript modules pass `node --check`, each **exit 0**. Portable diagnostic normalization, certificate rebinding, postflight source/log/checkpoint readback and `git diff --check` each exited **0**. Only two new diagnostic logs had workspace prefixes removed; scientific artifacts are unchanged.

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
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/inputs --out evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/pilot evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/inputs --out evaluation/hr3/harness/artifacts/a4-verification-T9RSX9/bounds.json` |
| certification-bundle | 0 | `node evaluation/hr3/harness/certification-bundle-a4.mjs` |


[Changed-file manifest](reports/recheck2-changes.json): **2350 changed/new files: 49 Git-visible and 2301 ignored retained artifacts; 10 source/document/test/fixture files.** Exact two-route set equality, exit **0**, against the task-entry snapshot. All **61670** pre-existing artifact files are byte-identical. Every listed content hash is read back; the manifest's own hash is excluded to avoid circular binding. Git tracked differences plus all untracked paths (including ignored) are compared with an independent recursive content-hash inventory. The manifest includes source, docs, tests, the pinned old-source fixture, regenerated certificates/reports and all retained ignored verification artifacts. All previous artifacts and the primary's real freeze remain byte-identical. Freeze remains primary-only. All repository writes are confined to harness; no network, key reads, paid calls or commit.
