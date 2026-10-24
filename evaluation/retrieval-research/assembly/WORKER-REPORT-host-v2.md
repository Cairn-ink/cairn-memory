HR-2 §11 host-v2 implementation worker report

Implemented the exploratory cost model, CLI selection and identities, strict scoring/provenance replay, 48-contrast reporting, macro coverage tables, saturation and rejection/alias diagnostics. No commit was made. README contains the exact coordinator commands and full worker-declared decisions; INPUTS records the pinned constants.

Changed-file list: **12 files**, relative to `evaluation/retrieval-research/`:

- `assembly/INPUTS.md`
- `assembly/README.md`
- `assembly/WORKER-REPORT-host-v2.md`
- `assembly/arms.mjs`
- `assembly/cost.mjs`
- `assembly/host-v2.mjs`
- `assembly/provenance.mjs`
- `assembly/report.mjs`
- `assembly/run.mjs`
- `assembly/score.mjs`
- `test/assembly-host-v2.test.mjs`
- `test/assembly-legacy-regression.test.mjs`

The list was derived using `git diff --name-only -z HEAD` plus `git ls-files --others --exclude-standard -z`, independently re-derived using `git status --porcelain=v1 --untracked-files=all -z`, and diffed: **exit 0, 12/12 identical**. All changes are within the permitted paths. A separate raw Git-blob check covered **1,142 protected tracked files**, including core, adapters, packaging, docs, fixtures, results and constants: **zero mismatches**. The constants SHA-256 remains `5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b`. Tracked and untracked whitespace checks: exit 0. Coordinator zsh syntax check: exit 0.

Tests ran individually, without the heavy queue. For `hr2_node=node` (v22.16.0) and `hr2_node=~/.nvm/versions/node/v24.15.0/bin/node` (v24.15.0), these exact commands were executed:

```sh
$hr2_node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-host-v2.test.mjs
$hr2_node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
$hr2_node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-host-v2.test.mjs
$hr2_node tools/testing/run.mjs --script evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
```

| Node | Host cases: pass/fail/skip; exit | Legacy: pass/fail/skip; exit |
| --- | --- | --- |
| 22.16.0 | 55/0/0; 0 | 1/0/0; 0 |
| 24.15.0 | 55/0/0; 0 | 1/0/0; 0 |

Normal runner mode reported one passing file, zero failures and exit 0 for each command/version; `--script` exposed the case counts above. Final-source diagnostic runs passed on both versions. An initial host attempt exited 1 (diagnostic counts: 50 passed, 1 failed): two test mutations reversed a shared array twice. Independent cloned test inputs fixed that test-isolation defect. No sandbox EROFS/EPERM failures occurred.

**Legacy regression: 240/240 byte-identical after stripping only `run.implementation.scorer`, on both Node versions. Legacy report statistics and confirmatory outcome exactly equal the archive.** The test compares all report JSON content except its top-level current-stage identity. Real scorer/report identities are separately recorded and printed, never copied from archived outputs. Final implementation source SHA-256: `fe63df20ca63998fe654111c5709effd2a866a0ee3f3c317069c86eb7558704e`; HEAD is `4fb908321f83f1b236c91ce4d1d59741fe8f8526`, dirty=true, detached=false.

The host test also ran `--split dev --overhead-model host-v2` against `results/dev/` for three A1/B128 cells in owned `createTestWorkspace` scratch. Assembly, scoring and reporting each exited 0 on both versions. No test-split grid was run or interpreted.

Worker-declared decisions and ambiguities:

- A stateless cost interface preserves the scalar return shape; host diagnostics are additional fields. Bundle trials commit atomically. Scalar rejected-bundle overflow behavior is preserved.
- Equality uses exact original strings without normalization. Every model constant, including unused probe constants, is authenticated.
- §11 leaves count scope unspecified: `bodyEqualSpanCount` counts admitted aliases; `rankedBodyEqualSpanCount` separately counts all ranked span occurrences across queries.
- A failed scheduled unit or bundle sets a query boolean; unscheduled spans do not. Cell rejection counts sum those booleans.
- Host scores retain evaluator-free prepared inputs for independent report replay and carry `run.overheadModelDigest`.
- Host contrasts are exactly the two requested candidates against P-top; the numeric primary selector and legacy contrasts remain unchanged.
- Partial smoke grids receive “incomplete grid” saturation; complete grids use exact per-query zero loss across the entire budget suffix.
- No `-o` path was supplied; this report uses the previously announced `assembly/WORKER-REPORT-host-v2.md` default.

No unresolved worker blockers. Non-author reviews, full acceptance and the 120 host-v2 test cells remain coordinator-owned outside this sandbox. No dependencies were installed; no network, model, API key or private research directory was used.

## Fix 1

P1 fixed against `5d0a344b`. All CLI destinations are checked before writes;
symlinks resolve through existing ancestors, protected roots are repository-relative,
and existing regular files cannot be overwritten. Non-empty-directory refusal remains.

Changes/inventory, relative to `evaluation/retrieval-research/`:

- `assembly/README.md:17` — historical commands; protected destinations documented.
- `assembly/WORKER-REPORT-host-v2.md:55` — this fix report.
- `assembly/output-paths.mjs:18` — shared physical-path guard and exclusive writers.
- `assembly/report.mjs:199` — both outputs preflighted together.
- `assembly/run.mjs:48` — directory/cell preflight before creation.
- `assembly/score.mjs:138` — output preflight before provenance scratch.
- `test/assembly-output-paths.test.mjs:64` — protected-byte, refusal and scratch tests.

Inventory derived from `git diff --name-only -z HEAD` plus untracked
`git ls-files`, independently from `git status --porcelain=v1 -z`, then diffed:
**7/7 identical; diff exit 0**. Whitespace, including untracked files: exit 0.

Commands (only the touched test file):

```sh
node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-output-paths.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-output-paths.test.mjs
```

Both were also executed with `--script` immediately after `run.mjs`.

| Node | Normal pass/fail; exit | Script pass/fail/skip; exit |
| --- | --- | --- |
| 22.16.0 | 1/0 file; 0 | 33/0/0; 0 |
| 24.15.0 | 1/0 file; 0 | 33/0/0; 0 |

Every refusal preserved protected hashes and created no outputs; host-v2/scalar
toy dev pipelines succeeded in fresh scratch. No sandbox EROFS/EPERM failures,
test-split run or commit. Earlier legacy results above were not rerun this round.
Protected Git blobs: 1,142 checked, zero mismatches.
