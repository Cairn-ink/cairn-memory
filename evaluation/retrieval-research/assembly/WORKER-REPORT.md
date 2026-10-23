# HR-2 harness worker report

Implemented the offline HR-2 v1.1 harness, pinned counter, authenticated input manifest, scorer, statistics adapter, Markdown report and five toy test files. No commit, test-split assembly, test coverage computation, network/model/API call or private-data read was performed. Implementation is ready for review; final runtime verification is incomplete.

Changed files: **17**, independently derived from `git status --porcelain --untracked-files=all` and three `find` traversals; sorted lists were diffed and match exactly. All paths are within the allowed scope.

- `evaluation/retrieval-research/assembly/INPUTS.md`
- `evaluation/retrieval-research/assembly/README.md`
- `evaluation/retrieval-research/assembly/WORKER-REPORT.md`
- `evaluation/retrieval-research/assembly/arms.mjs`
- `evaluation/retrieval-research/assembly/auth.mjs`
- `evaluation/retrieval-research/assembly/counter.mjs`
- `evaluation/retrieval-research/assembly/report.mjs`
- `evaluation/retrieval-research/assembly/run.mjs`
- `evaluation/retrieval-research/assembly/score.mjs`
- `evaluation/retrieval-research/assembly/units.mjs`
- `evaluation/retrieval-research/package-lock.json`
- `evaluation/retrieval-research/package.json`
- `evaluation/retrieval-research/test/assembly-arms.test.mjs`
- `evaluation/retrieval-research/test/assembly-auth.test.mjs`
- `evaluation/retrieval-research/test/assembly-counter.test.mjs`
- `evaluation/retrieval-research/test/assembly-report.test.mjs`
- `evaluation/retrieval-research/test/assembly-scoring.test.mjs`

Verification:

- Node 22.16.0: `node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs`, invoked through `cairn-heavy`, exited **1**. The reporter showed **5 files: 4 passed, 1 failed**, without individual-case totals. The authentication file failed; a separate probe reproduced blocked synchronous Git capture. Commit discovery now uses an owned workspace and explicit file descriptors; its separate metadata probe exited **0**. The final suite was not rerun successfully.
- Node 24.15.0: planned command `~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs` did **not start**; pass/fail counts are unavailable.
- A read-only opening of the same machine-wide queue lock was used after the normal wrapper failed. The shared lock remained occupied for about 30 minutes. Both queued verification tasks were cancelled before test execution, exit **130** each; no queued process remains. They would have run both versions, per-case diagnostics and the 480-cell dev smoke pipeline. **No real dev pipeline run occurred.** Toy tests use dev fixtures; their end-to-end success remains unverified.
- Syntax checks, tracked/untracked whitespace checks, changed-file cross-check and independent archive/member/FROZEN hash checks exited **0**. Tar extraction and Python tarfile/hashlib independently agreed on the archive, **3 members** and **7 fixture hashes**.

Sandbox-only failures, retained here separately:

- Git synchronous capture: `spawnSync git EPERM` (probe exit **1**); replaced with verified file-descriptor capture.
- Cached-tarball npm attempt: exit **226**, `EROFS: read-only file system, mkdtemp '/home/chichieh/.npm/_cacache/tmp/xVJXId'`.
- Normal queue wrapper: `Read-only file system`, then `flock: 9: Bad file descriptor`; it incorrectly continued without its lock. Subsequent attempts used read-only lock opening with fail-fast shell behavior.

The requested initial offline install exited **1**, `ENOTCACHED`. Recovery copied only the cached tiktoken metadata/tarball into an owned writable cache and installed with `--offline --ignore-scripts --save-exact --full-metadata`; exit **0**. Both manifests pin **1.0.22**.

Worker-declared decisions (fully enumerated in README): record v1.1/freeze commit separately from implementation HEAD; use `<memory>#body` and original span IDs; first span is array index zero; preserve visit order; memoize exact-text counts. Hash all seven files without parsing labels during assembly; authenticate the full split including diagnostics, assemble/score only C1–C7; test pins member bytes, dev validates metadata/hashes; archive digest records provenance. Pass only sanitized IDs/text/costs to assembly. Default/restrict selections to the frozen grid, reject duplicates and nonempty output directories. Whole-cell macros require seven categories; strata omit absent groups and average represented categories with counts; alternative supports count once. Token percentiles use shared linear interpolation. Every arm uses the same complete-ranking ceiling. Compare supplied variants against matching P-top; only the preregistered primary contrast is confirmatory. Invalid/incomplete pairs and fewer than ten families are inconclusive. McNemar uses smallest IDs and labels dev honestly. Skip length stress. No protocol rule changed. No `-o` path was visible, so this report is also saved inside assembly.

Could not complete: successful final touched-test runs on both Node versions, per-case pass/fail totals, and real dev smoke execution, because the required queue never became available. Broad acceptance and test-split execution remain coordinator-owned. No results were interpreted.
