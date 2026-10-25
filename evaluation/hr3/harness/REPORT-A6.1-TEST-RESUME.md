# A-6.1 authorized test continuation — source drift stops certification

Ran directly and **unlocked**, as authorized. The continuation resumed at the harness suite and retained the prior successful commands after checking their log hashes and unchanged dependencies. The failed historical attempt remains intact at `evaluation/hr3/harness/artifacts/a61-placeholder-verification-o3kJZH/verification.json`; its failed harness command is retained in the continuation record, not represented as a success.

## Exactly two authorized test updates

- `test/a4.test.mjs:95`: the actual accounting and run-gate source execute against three independent filesystem fixtures. Missing preparation must still throw exactly `a6_preparation_completeness_required` (`:123`). A stale carried attestation fails actual manifest/source reconciliation, and a test-only preparation record fails actual primary-record validation (`:124`). The real primary record is accepted (`:126`). Real accounting input and carry bytes are checked unchanged (`:129`); fixture writes cannot produce dispatch inputs.
- `test/a3-audit.test.mjs:116`: frozen A-4.1/A-4.2 authority is E=20,480, T/U/P=40,960, O=32,768. The preserved historical certificate and every row are checked against those historical numbers. A separate assertion at `:121` checks active A-6.1 certification: E=40,960, T/U/P=57,344, O=49,152, including every row. Historical evidence is not rewritten and active limits are not changed.

Before documentation updates, mechanical comparison against the preceding changed-file manifest found exactly these two authoring source files changed. No harness runtime or integration source was changed.

## Actual results and exits

| Suite / step | Passed | Failed | Exit | Execution |
| --- | ---: | ---: | ---: | --- |
| generator-tests | 62 | 0 | 0 | Retained unchanged-dependency result before protected drift |
| scorer-tests | 100 | 0 | 0 | Retained unchanged-dependency result before protected drift |
| integration-tests | 26 | 0 | 0 | Retained unchanged-dependency result before protected drift |
| harness-tests | 371 | 0 | 0 | Rerun before protected drift |
| pilot-inputs | — | — | 0 | Fresh pilot inputs in harness artifacts |
| standalone fake-pilot | 480 complete answers | 0 | 0 | FakeTransport only |
| continuation source check | — | 3 changed protected files | 1 | Stops immediately after fake-pilot |
| leak scan, bound report, reconciliation, certificate bundle | — | — | — | Not run after first failure |

Both authorized tests passed: TAP `ok 246` and `ok 264`. The full harness suite reports **371 tests, 371 passed, 0 failed, 0 skipped**, actual exit 0. The other three suites were not rerun: before the fake pilot, protected/runtime sources and their passing logs still matched the prior verification. Their retained counts are not certification of the now-changed scorer.

## Blocking protected-source drift

The checkpoint immediately before the standalone fake pilot matched all 139 protected source hashes. The checkpoint immediately after it detected concurrent edits to three protected scorer files. This continuation did not edit those files. Their independently observed hashes are:

| File | Entry SHA-256 | Observed SHA-256 |
| --- | --- | --- |
| `evaluation/hr3/scorer/support.mjs` | `f54506db79dca20133cb7c536b52e379b6d1bab5b28543c8137364ab046d9d73` | `8808162b41fc1d70088eddc9a16dde645e3ee32668ba424ab0ba31813a23e39c` |
| `evaluation/hr3/scorer/scorer.mjs` | `6625163a615fb01232077abe7045528e78ead8b73555d6d21ff7b431ef5a5a4b` | `316cb9ec6b3d9b46401a9f17d40ceea38ae74737d66fd92653c3e030c3e2c4d0` |
| `evaluation/hr3/scorer/cli.mjs` | `7fdc7f7d2ed1654d843a6ee6a59fe679cfcf3e9fb38c3216cddb93b97bce6f47` | `b67ffbecaddd81f6df8a4874a4d119f9ad8d7ec1d2298ac0d1520730926fe53a` |

Status: **FAIL_PROTECTED_INPUT_CHANGED**, blocking step `fake-pilot`; continuation exit **1**. No later gate ran, no certificates were rebound to the changed scorer, and no source/certificate/test correction was attempted after the stop. The source changes mean the retained scorer/integration suites and certificate source bindings cannot certify the current checkout. Runtime-loaded module bytes are not retrospectively inferred from mutable on-disk sources.

## Fake pilot and accounting

The standalone fake pilot completed **480/480** and exited **0**. `run.json` identifies `offline=true`, `FakeTransport`, and scorer `hr3-scorer-a6-v5`. Its ledger contains **2,661 simulated reservations and 2,661 simulated settlements**, all settlement request IDs prefixed `fake-`. These are local simulation records: **zero provider/network dispatches and zero new paid reservations**. The run is retained as interrupted certification evidence, not a passing current-source certificate.

The approved budget numbers remain unchanged: verified carried exposure **$4.145077720**, conservative increment **$38.342656**, cumulative bound **$42.487733720**. The real primary preparation record and carry manifest were not changed. No paid call, key access, network, freeze or commit.

## Evidence and manifest

The continuation reproduces the existing verifier's ordered commands from the harness suite onward via a temporary orchestration script. Exact child commands/exits/log hashes are in `reports/a6-verification.json`; the copied parent record and original failed logs remain intact. Artifacts: `evaluation/hr3/harness/artifacts/a61-test-resume-tsrf5m8k`. `reports/a61-test-resume-result.json` records the source drift and distinguishes retained suites, rerun harness tests and simulated calls. All command-log hashes were independently rechecked.

The cumulative `reports/a6-changes.json` is regenerated by Git inventory/Python SHA-256 and independent filesystem Dirent/Node crypto SHA-256 routes, then canonically diffed. Scope remains harness/integration; protected sibling changes are recorded as external drift and excluded from this authoring manifest. The primary owns stable-source reruns, non-author acceptance and freeze.

A later read-only reporting snapshot observed continued external scorer work: **eight protected paths differ from entry**, including the three runtime files that triggered the stop and five scorer test paths (`trivia-cli.test.mjs` newly present, plus `trivia-fixtures.mjs`, `trivia-regression.test.mjs`, `trivia-target.test.mjs`, `trivia.test.mjs`). Exact entry/observed digests are recorded in `reports/a61-test-resume-result.json`. The three-file stop checkpoint is preserved; subsequent changes do not authorize continuation or certify the current checkout.
