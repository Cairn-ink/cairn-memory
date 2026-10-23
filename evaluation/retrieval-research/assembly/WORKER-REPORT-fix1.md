# HR-2 harness fix round 1

All eight findings are addressed. No commit, network/API call, test-split assembly or results interpretation. No visible -o destination was supplied, so the report is saved here.

Changed files: **14**. Independently derived from git status --porcelain --untracked-files=all and find traversals with current Git blob hashes compared against git ls-tree HEAD. Sorted-list diff is empty; all paths are within the authorized scope.

- evaluation/retrieval-research/assembly/README.md
- evaluation/retrieval-research/assembly/WORKER-REPORT-fix1.md
- evaluation/retrieval-research/assembly/WORKER-REPORT.md
- evaluation/retrieval-research/assembly/grid.mjs
- evaluation/retrieval-research/assembly/identity.mjs
- evaluation/retrieval-research/assembly/provenance.mjs
- evaluation/retrieval-research/assembly/report.mjs
- evaluation/retrieval-research/assembly/run.mjs
- evaluation/retrieval-research/assembly/score.mjs
- evaluation/retrieval-research/test/assembly-arms.test.mjs
- evaluation/retrieval-research/test/assembly-auth.test.mjs
- evaluation/retrieval-research/test/assembly-identity.test.mjs
- evaluation/retrieval-research/test/assembly-report.test.mjs
- evaluation/retrieval-research/test/assembly-scoring.test.mjs

Tests ran one file at a time through the owned runner, without cairn-heavy. For each row the exact command was:

<node> tools/testing/run.mjs --script evaluation/retrieval-research/test/<file>

Node paths were ~/.nvm/versions/node/v22.16.0/bin/node and ~/.nvm/versions/node/v24.15.0/bin/node. NODE_OPTIONS=--test-reporter=tap; TMPDIR/TMP/TEMP pointed to a createTestWorkspace directory explicitly created under assembly, cleaned after execution. Normal runner mode initially exposed only file-level totals (arms: exit 0, one file passed); --script exposed individual assertions.

| File | Node 22 exit; passed/failed | Node 24 exit; passed/failed |
| --- | --- | --- |
| assembly-arms.test.mjs | 0; 49/0 | 0; 49/0 |
| assembly-auth.test.mjs | 0; 39/0 | 0; 39/0 |
| assembly-identity.test.mjs | 0; 2/0 | 0; 2/0 |
| assembly-report.test.mjs | 0; 30/0 | 0; 30/0 |
| assembly-scoring.test.mjs | 0; 5/0 | 0; 5/0 |

Totals: **125 passed, 0 failed, 0 skipped per Node version**. Syntax and tracked/untracked whitespace checks exited 0. Sandbox-only failures: **none this round**; worktree scratch and explicit child file descriptors avoided /tmp and subprocess-pipe restrictions.

Fixes by finding:

1. P0: provenance.mjs validates every scored cell before bootstrap: format/status, frozen counter/protocol/commit, split/scale, ranking/member/configuration and fixture hashes, query set, and stage identities. report.mjs preflights all cells and pairs; invalid inputs yield inconclusive/invalid_inputs with no comparisons or confirmatory designation. Regression mutations cover each frozen field, failed statuses and misleading ok flags.
2. P1: score.mjs replays the declared arm using sanitized IDs/text/costs and requires exact admissions, order and used total. Negative tests cover empty/omitted/reordered admissions and swapped arms.
3. P1: identity.mjs records HEAD, deterministic recursive assembly-source SHA-256, source paths, dirty state and detached state. Assembly, scorer and report identities are recorded; pairs require identical assembly identities. Git uses owned worktree scratch and file descriptors. Identity and cross-stage integration regressions pass.
4. P2: arms tests hand-check all five arms with ranking [b,a,c] over items [a,b,c].
5. P2: arms tests assert base costs 12/14/10, O=8 charges 20/22/18, exact fits, all arms and the 59/60-token atomic bundle boundary.
6. P2: auth toy now has complete facts/corpus/query metadata, expresses, standard span IDs, generated facts-view and versioned labels/audit. C1/C2 checks pass; C8 has no supports; FOREIGN has only foreign supports. Zero-span/odd-ID cases remain focused boundary tests.
7. P2: Markdown uses shared provenance once and compact cell/comparison/category/stratum tables. Exhaustive unrounded JSON remains; a 240-cell rendering-size regression and JSON round-trip test pass.
8. P2: README and the original worker report now say 240. grid.mjs computes expectedCellCount from configured arrays; run.mjs emits grid, expectedCells and actual cells. Default-grid and selected-grid count tests pass.

Not run this round: the full real dev grid or coordinator acceptance. The toy dev CLI tests exercised run/score/report on both Node versions. Test-split execution remains coordinator-only. HR-1 code/inputs and protocol v1.1 remain unchanged.
