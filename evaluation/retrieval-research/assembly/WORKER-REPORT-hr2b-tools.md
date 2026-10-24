# HR-2b §8 tooling worker report

Earlier history is condensed here; `c7ee6f9e` preserves the original report.
Initial implementation started at `c546bfc1`. Independent Git/untracked and
HEAD-blob/filesystem inventories matched: **33 files, diff exit 0**:

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

Initial targeted tests, both runtimes: **31 pass, 0 fail; exits 0**.
Earlier diagnostic attempts: interruption **130**; toy-allocation failure **1**,
corrected before final tests. Regressions: **240/240;120/120**, reports equal.

Worker decisions: preserve HR-1 filenames/bytes/seed; counts ±10%, distributions
±5 points; exclusive upper token-band boundaries except final endpoint;
retain UTF-16 caps. Disclose sentence banks/ranges and canonical-fact lexicons;
W3 audits semantics. Freeze guard-category union after overrides. Preserve
A3 weights and ranking algorithms. Read manifests dynamically; protect existing
HR-2b roots. Compare validation with frozen-source output because no committed
validation-result file exists. README/INPUTS document coordinator commands.

## Fix 1

Reproduced 19 functional regressions. `run.mjs:106` restored selection gates
before fixture reads; `run.mjs:23` added explicit HR-2b selection.
`lib/fixture.mjs:49` restored legacy versionless/hash-only projections;
`assembly/hr2b-profile.mjs:44` restored versionless scratch/symlink pipelines.
Regression tests and coordinator flags were updated.

Entries throughout: **pass/fail/skip;actual exit**.

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

Fix 1 totals/runtime: **371/15/1**; failures were listener EPERM only.
Regressions **240/240;120/120**. Inventory **33**, test inventory **28**;
independent lists matched, diff exits **0**. Protected bytes/whitespace: **0**.

## Fix 2

Against `c7ee6f9e`; uncommitted. Root causes and changes
(paths relative to `evaluation/retrieval-research/`):

1. Original query selectors ignored W3. `lib/hr2b-queries.mjs:5` projects active,
   checked audited categories; `assembly/hr2b-profile.mjs:64` authenticates that
   projection; `assembly/score.mjs:39` scores it. Original records remain intact.
   Dev-only E2Es cover authoring→split→labels→audit→rankings→score→report.
2. Rendered-only filtering skipped absent facts. `lib/hr2b-world.mjs:93` now
   requires/scans every fact's lexicon; missing/contaminated absent lexicons fail.
3. First-position precedence hid duplicate later support.
   `lib/hr2b-world.mjs:75` rejects mixed first/later expressions before placement
   allocation. Both directions tested; audited precedence remains body→first→later.
4. Supplied strata were trusted. `assembly/hr2b-evidence.mjs:9` derives rows,
   required groups, metrics and summaries from authenticated labels/admissions;
   `assembly/hr2b-provenance.mjs:43` compares exactly. Tests remove/add queries
   and alter denominators/metrics in both models, including 12→10 families.
5. Host replay trusted supplied text. `assembly/hr2b-provenance.mjs:32` binds
   the ranked-item union to prepared authenticated corpus items. Body, receipt
   and token tampering fail even after recomputing admissions.
6. String sorting misordered offsets. `lib/hr2b-world.mjs:8` compares parsed
   instants then ids; line 53 refuses invalid times. Offset, precision and
   equal-instant tie cases pass/refuse as appropriate.
7. Shallow freezes shared nested constants. `lib/immutable.mjs:3` deep-freezes;
   `lib/hr2b-configuration.mjs:12`, `lib/fixture.mjs:18` and
   `assembly/hr2b-profile.mjs:40` return independent snapshots. Mutation tests
   verify later validation remains fixed.
8. Repeated literals could drift. `lib/fixture-profiles.mjs:7` owns versioned
   constraints; `lib/hr2b-world.mjs:4`, `lib/placement.mjs:17`,
   `tools/validate.mjs:62` and `assembly/hr2b-profile.mjs:17` consume them.
   Legacy metric functions moved unchanged to `assembly/scoring-metrics.mjs:6`.

All 28 files ran **one at a time**, using each executable
`~/.nvm/versions/node/v22.16.0/bin/node` and
`~/.nvm/versions/node/v24.15.0/bin/node`:

```sh
HR1_MODEL_SMOKE=0 HR1_MODEL_SMOKE_DOWNLOAD=0 <node> tools/testing/run.mjs --script evaluation/retrieval-research/test/<file>
```

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
|assembly-hr2b.test.mjs|13/0/0;0|13/0/0;0|
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
|tooling-hr2b.test.mjs|27/0/0;0|27/0/0;0|

Each runtime: **384 pass, 15 sandbox failures, 1 skip** (400 cases).
`arms-openai` (14) and `arms-runner` (1):
`listen EPERM: operation not permitted 127.0.0.1`; actual exits **1**.
No EROFS or other failures. Listener cases require coordinator execution outside
sandbox; model smoke remained disabled. Logs: `/tmp/hr2b-fix2-ouscBA/`.

Both runtimes: **240/240 legacy;120/120 host-v2**, byte identity with only
current scorer identity removed; reports equal except current report identity.
HR-1 byte-identity test passes. Frozen archives and legacy auth/grid unchanged.
After removing an EOF blank line, final source-identity reruns of
`assembly-hr2b` and both regressions passed on both runtimes: **all exits 0**.

Two-way inventory: Git diff/untracked versus HEAD blob SHA-1/filesystem walk;
**19 files, diff exit 0**:

```text
assembly/README.md
assembly/WORKER-REPORT-hr2b-tools.md
assembly/hr2b-evidence.mjs
assembly/hr2b-profile.mjs
assembly/hr2b-provenance.mjs
assembly/hr2b-report.mjs
assembly/score.mjs
assembly/scoring-metrics.mjs
lib/fixture-profiles.mjs
lib/fixture.mjs
lib/hr2b-configuration.mjs
lib/hr2b-queries.mjs
lib/hr2b-world.mjs
lib/immutable.mjs
lib/placement.mjs
test/assembly-hr2b.test.mjs
test/fixtures-tooling/hr2b.mjs
test/tooling-hr2b.test.mjs
tools/validate.mjs
```

Test inventory: rg versus find, **28**, diff **0**. Tracked/untracked whitespace
and protected-path byte checks: exits **0**. No new protocol ambiguity; parsed
instants accept valid offset/fraction spellings. No commits, network, new
inference or test-split execution. External reviews/acceptance remain coordinator work.
