# HR-2b §8 tooling worker report

Implemented against `c546bfc170afb7e5a24cf8797914c8279431ec58`; uncommitted for coordinator review. No `-o` value was supplied or received; this report uses the permitted assembly directory.

Changed-file lists were independently derived using (A) Git diff plus untracked enumeration and (B) HEAD blob SHA-1 comparison plus a filesystem walk for new source files. Sorted lists were diffed: **exit 0, 33 files**. Paths below are relative to `evaluation/retrieval-research/`:

```text
assembly/INPUTS.md
assembly/README.md
assembly/WORKER-REPORT-hr2b-tools.md
assembly/arms.mjs
assembly/calibrate-host-v2.mjs
assembly/hr2b-profile.mjs
assembly/hr2b-provenance.mjs
assembly/hr2b-report.mjs
assembly/hr2b-run.mjs
assembly/identity.mjs
assembly/output-paths.mjs
assembly/provenance.mjs
assembly/report.mjs
assembly/representation-v2.mjs
assembly/run.mjs
assembly/score.mjs
lib/fixture.mjs
lib/hr2b-configuration.mjs
lib/hr2b-world.mjs
lib/placement.mjs
run.mjs
test/arms-hr2b.test.mjs
test/assembly-host-v2-regression.test.mjs
test/assembly-hr2b.test.mjs
test/fixtures-tooling/hr2b.mjs
test/tooling-hr2b.test.mjs
tools/apply-audit.mjs
tools/facts-view.mjs
tools/freeze-hr2b.mjs
tools/hr2b-configuration.mjs
tools/labels.mjs
tools/split.mjs
tools/validate.mjs
```

Final targeted tests ran sequentially. The owned runner's `--script` mode exposes individual case counts. Every command below returned **actual exit 0**, with zero failures/skips:

```sh
node tools/testing/run.mjs --script evaluation/retrieval-research/test/tooling-hr2b.test.mjs
node tools/testing/run.mjs --script evaluation/retrieval-research/test/arms-hr2b.test.mjs
node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-hr2b.test.mjs
node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-host-v2-regression.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/retrieval-research/test/tooling-hr2b.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/retrieval-research/test/arms-hr2b.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-hr2b.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-host-v2-regression.test.mjs
```

| Test | Node 22.16.0 pass/fail | Node 24.15.0 pass/fail |
| --- | --- | --- |
| tooling-hr2b | 20/0 | 20/0 |
| arms-hr2b | 3/0 | 3/0 |
| assembly-hr2b | 6/0 | 6/0 |
| legacy regression | 1/0 | 1/0 |
| host-v2 regression | 1/0 | 1/0 |
| Total | **31/0** | **31/0** |

Both runtimes: **240/240 legacy cells** and **120/120 host-v2 cells** byte-identical after removing only current scorer identity. Regenerated reports equal archived content except current report identity. Archives remained read-only. HR-1 regenerated facts view, split and audited labels match committed bytes; validation matches frozen-source output.

Earlier attempts: one normal tooling run was interrupted while diagnosing slow validation (**exit 130**); an initial script run had **16 pass / 1 fail, exit 1**, caused by toy receipt-band allocation per memory instead of per receipt. Corrected the toy and optimized repeated normalization; final tests pass. Normal owned-runner invocations also passed before final additions. **Sandbox EROFS/EPERM failures: none.**

Worker decisions and §8 ambiguities:

- Retain `hr1-*.json` filenames; authenticate version-bearing roots. HR-2b split emits its version and uses `hr2b-split-v1`; HR-1 bytes/seed remain unchanged.
- Reuse HR-1's “about” convention: counts ±10%; distribution bins ±5 points; token-band upper boundaries exclusive except final endpoint. Preserve schema UTF-16 caps 4000/800 alongside token bands. These conventions are documented for W1.
- Define filler disclosure as sentence banks plus exact UTF-16 unit ranges, with a per-fact forbidden lexicon. Scan normalized disclosed sentences globally; W3 owns semantic entailment. Body-supported facts may also have explicit receipt support; body expressions never implicitly confer receipt support in HR-2b.
- Freeze guard-category union across splits; recompute placement and quotas after audit. Add scalar pressure diagnostics only when requested by HR-2b; legacy scalar output remains exact.
- Preserve existing equal A3 weights `[0.45,0.45]`. Add fixed configuration and version metadata without changing ranking algorithms, indexing, scale or namespaces. No further ranking-harness change was needed.
- Read fixture/ranking FROZEN tables at runtime; require configuration, calibration and both ranking members per split. Existing HR-2 authentication/constants remain untouched. Protect HR-2b roots once present; coordinator stages assembly in scratch and promotes the completed directory.
- No committed validation-result file exists: compare against the validator/lib/tools at the frozen commit in scratch instead. README/INPUTS contain coordinator steps 3–5 and freeze commands with independently reconciled file lists.

Verification: tracked and untracked whitespace passed; protected paths (protocols, core, adapters, packaging, fixtures, results, auth, grid, overhead JSON) have no diff, **exit 0**. No commits, fixture authoring, real ranking inference, new test-split execution, network, private-data reads or broad suites occurred. Non-author exact-commit reviews and coordinator acceptance remain external and were not performed here.

## Fix 1

Reproduced all 19 functional regressions before editing (five files, each exit 1), plus the sandbox listener failure.

- `run.mjs:106` restores selection/configuration gates before fixture reads. `run.mjs:23` adds explicit HR-2b selection, authenticated after loading; legacy error classes remain unchanged.
- `lib/fixture.mjs:49` restores versionless legacy projections and hash-only views, fixing isolation/runner CLI and security's missing artifact.
- `assembly/hr2b-profile.mjs:44` accepts versionless legacy corpora, restoring both scratch/safe-symlink pipelines. Output-path guard unchanged this round.

Regressions: `test/arms-hr2b.test.mjs:59`, `test/tooling-hr2b.test.mjs:225`. Coordinator flags updated: `assembly/README.md:248`, `assembly/INPUTS.md:56`.

All 28 files ran sequentially with `<node> tools/testing/run.mjs --script evaluation/retrieval-research/test/<file>`. Executables: `~/.nvm/versions/node/v22.16.0/bin/node`, `~/.nvm/versions/node/v24.15.0/bin/node`. Table entries: **pass/fail/skip;actual-exit-code**.

|File|22.16.0|24.15.0|
|---|---|---|
|arms-a0.test.mjs|8/0/0;0|8/0/0;0|
|arms-contracts.test.mjs|21/0/0;0|21/0/0;0|
|arms-fusion.test.mjs|7/0/0;0|7/0/0;0|
|arms-hr2b.test.mjs|4/0/0;0|4/0/0;0|
|arms-isolation.test.mjs|7/0/0;0|7/0/0;0|
|arms-lexical.test.mjs|7/0/0;0|7/0/0;0|
|arms-local.test.mjs|3/0/0;0|3/0/0;0|
|arms-model-smoke.test.mjs|0/0/1;0|0/0/1;0|
|arms-openai.test.mjs|2/14/0;1|2/14/0;1|
|arms-runner.test.mjs|9/1/0;1|9/1/0;1|
|arms-security.test.mjs|7/0/0;0|7/0/0;0|
|assembly-arms.test.mjs|49/0/0;0|49/0/0;0|
|assembly-auth.test.mjs|39/0/0;0|39/0/0;0|
|assembly-counter.test.mjs|2/0/0;0|2/0/0;0|
|assembly-host-v2-regression.test.mjs|1/0/0;0|1/0/0;0|
|assembly-host-v2.test.mjs|55/0/0;0|55/0/0;0|
|assembly-hr2b.test.mjs|6/0/0;0|6/0/0;0|
|assembly-identity.test.mjs|2/0/0;0|2/0/0;0|
|assembly-legacy-regression.test.mjs|1/0/0;0|1/0/0;0|
|assembly-output-paths.test.mjs|33/0/0;0|33/0/0;0|
|assembly-report.test.mjs|30/0/0;0|30/0/0;0|
|assembly-scoring.test.mjs|5/0/0;0|5/0/0;0|
|metrics-report.test.mjs|14/0/0;0|14/0/0;0|
|metrics-review.test.mjs|5/0/0;0|5/0/0;0|
|metrics-scoring.test.mjs|9/0/0;0|9/0/0;0|
|metrics-stats.test.mjs|5/0/0;0|5/0/0;0|
|tooling-fixture.test.mjs|19/0/0;0|19/0/0;0|
|tooling-hr2b.test.mjs|21/0/0;0|21/0/0;0|

Each runtime: **371 pass, 15 sandbox failures, 1 skip**. `arms-openai` (14) and `arms-runner` (1) fail solely with `listen EPERM: operation not permitted 127.0.0.1`. No EROFS. Real-model smoke explicitly disabled (`HR1_MODEL_SMOKE=0`, `HR1_MODEL_SMOKE_DOWNLOAD=0`); no inference/downloads. Both regressions remain **240/240;120/120**, reports equal under prescribed identity exclusions.

Inventory re-derived: Git diff+untracked versus HEAD blob hashing+filesystem walk; **33 files**, identical to the list above; diff exit **0**. Test inventory: rg versus find, **28**, diff exit **0**. Protected bytes/whitespace: exit **0**. Uncommitted; coordinator must rerun listener cases outside the sandbox.
