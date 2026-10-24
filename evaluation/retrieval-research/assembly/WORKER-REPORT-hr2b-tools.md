# HR-2b v1.1 tooling amendment worker report

Implemented on frozen `d3a6e24f15cda63504135cfa55dded02f41a9760`;
no commit. No `-o` path was supplied, so this report uses the established
`assembly/WORKER-REPORT-hr2b-tools.md` destination. Earlier reports remain in HEAD.
Concurrent work advanced HEAD to `dc888266` during verification. Its committed
lib/assembly/test trees equal the freeze (scoped Git diff exit 0). Node-22
regression identities record `d3a6e24f`, Node-24 records `dc888266`; all four
record the same tested source hash. The protocol pin remains `d3a6e24f`.

Changed files were derived independently by (A) scoped Git diff plus untracked
enumeration and (B) HEAD blob SHA-1 comparison plus a filesystem walk. Sorted
lists were diffed: **13 files, actual exit 0**. Both methods inspect worker-owned
lib/assembly/test directories only; W1's concurrent fixture is excluded.
Paths are relative to `evaluation/retrieval-research/`:

```text
assembly/INPUTS.md
assembly/README.md
assembly/WORKER-REPORT-hr2b-tools.md
assembly/calibrate-host-v2.mjs
assembly/hr2b-profile.mjs
assembly/hr2b-provenance.mjs
assembly/hr2b-report.mjs
lib/fixture-profiles.mjs
lib/placement.mjs
lib/pooled-coverage.mjs
test/assembly-hr2b.test.mjs
test/fixtures-tooling/hr2b.mjs
test/tooling-hr2b.test.mjs
```

The `hr2b-fixture-v1` profile now has four histogram bins and maxSpans=4.
Placement quotas require test ≥30 groups / ≥12 families and dev ≥4 families
per first/later stratum, with no dev group or per-category minimum. Counts
and frozen guard categories remain available for description.

`lib/pooled-coverage.mjs:30` computes pooled guard coverage, ceiling and delta,
then resamples N contributing families N times uniformly with replacement,
retaining all paired rows with multiplicity and recomputing denominators.
It uses 10,000 draws, `hr2b-bootstrap-v1`, N≥10, interpolated 2.5/97.5
percentiles and no category redraw. Invalid inputs/draws cannot yield `ok`.
Reports identify `pooled-group-coverage-v1`, show pooled absolute coverage,
ceiling and counts, and include descriptive per-category point/groups/families
without intervals or decisions. The decision uses the pooled CI/ceiling;
+3/−5 thresholds and other gates remain unchanged. Primary/other-stratum macro
statistics and legacy stats/scoring implementations remain unchanged.

Arithmetic-only hand example: C1 has 2 groups, baseline 2 covered, candidate
0; C3 has 6 groups, baseline 1, candidate 4. Pooled delta is
`100 × (4 − 3) / 8 = +12.5 pp`; absolute coverage is 3/8 versus 4/8.
With ceiling-covered counts 2 and 5, pooled ceiling is 7/8. Descriptive C1
and C3 deltas are −100 and +50 pp; their category macro would be −25 pp.
The two-family example correctly has no CI (`too_few_families`).

Tests ran individually, sequentially, on both executables:
`~/.nvm/versions/node/v22.16.0/bin/node` and
`~/.nvm/versions/node/v24.15.0/bin/node`, with these commands for each table file:

```sh
<node> tools/testing/run.mjs evaluation/retrieval-research/test/<file>
<node> tools/testing/run.mjs --script evaluation/retrieval-research/test/<file>
```

Normal mode reports file-level results; script mode exposes case counts.
Table entries are **script pass/fail; actual normal/script exits**.

|File|Node 22.16.0|Node 24.15.0|
|---|---|---|
|tooling-hr2b.test.mjs|28/0;0/0|28/0;0/0|
|assembly-hr2b.test.mjs|19/0;0/0|19/0;0/0|
|assembly-legacy-regression.test.mjs|1/0;0/0|1/0;0/0|
|assembly-host-v2-regression.test.mjs|1/0;0/0|1/0;0/0|

Each runtime: **49 pass / 0 fail / 0 skip**, plus four passing normal-mode
file invocations; every actual exit **0**. Initial Node-22 assembly checks
also exited 0. Sandbox EROFS/EPERM failures: **none**.
Both runtimes: **240/240 legacy cells;120/120 host-v2 cells** byte-identical
with only current scorer identity stripped; reports equal except current
report identity. Regression files unchanged. HR-1 facts/split/labels/validation
byte identity passes. Logs: `/tmp/hr2b-v11-tests-r770cql5/`.

Declared choices: preserve zero-count descriptive rows for categories in the
frozen union but absent from a split (point null, groups/families zero);
authenticate actual split membership without implying a category floor.
Recover integer ceiling numerators from existing ratios only after checking
they represent whole groups (1e-9 floating-point tolerance), preserving scorer
bytes. Calibration caps/probes follow the four-receipt profile; pinned overhead
constants remain unchanged. No unresolved §4/§7/§8 ambiguity remains.

Tracked/untracked whitespace and protected-path checks (excluding W1's concurrent
fixture) pass, actual exits 0.
No HR-2b fixture content was read/authored, no real ranking or assembly was run,
no inference/network/new dependency/private-data access occurred. W1's fixture
was not inspected or modified. External non-author reviews and coordinator
acceptance cannot be performed by this implementation worker and remain pending.
