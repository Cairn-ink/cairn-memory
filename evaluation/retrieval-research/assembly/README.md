# HR-2 offline assembly harness

Implements the frozen [HR-2 v1.1 protocol](../../../docs/plans/budgeted-assembly-hr2.md), frozen at `c863e9d674f23ccebffaf3ad96ab1c4b34eabc82`. Research only; no models, network, adapters or product changes. Node **22.16.0** is the reference runtime; touched tests also run on **24.15.0**.

## Coordinator commands

Run from the repository root. Install from the existing npm cache only:

```sh
npm install --offline --ignore-scripts --save-exact --prefix evaluation/retrieval-research tiktoken@1.0.22
~/.local/bin/cairn-heavy node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs
~/.local/bin/cairn-heavy ~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs
```

Check that `node --version` is `v22.16.0`. Do not remove or replace an existing `node_modules` symlink. If the cache metadata is unavailable, the worker report records the offline installation recovery used here; the checked-in lockfile pins the registry tarball and integrity.

After review and acceptance, the **coordinator only** executes the frozen test grid. The following output directories must be absent or empty. `--rankings` accepts an extracted archive root or its `with-foreign` directory, not a compressed archive filename.

```sh
mkdir -p evaluation/retrieval-research/results/hr2-final/inputs
sha256sum evaluation/retrieval-research/results/test-final/rankings.tar.xz
tar -xJf evaluation/retrieval-research/results/test-final/rankings.tar.xz -C evaluation/retrieval-research/results/hr2-final/inputs
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/run.mjs --fixture-dir evaluation/retrieval-research/fixtures --rankings evaluation/retrieval-research/results/hr2-final/inputs --split test --scale S1000 --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail --rankings-select A1,A3--bge-m3,F-RRF10--openai-3-small --budgets 128,192,256,384,512,768,1024,1536 --overheads 0,8 --out evaluation/retrieval-research/results/hr2-final/cells
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/score.mjs --fixture-dir evaluation/retrieval-research/fixtures --cells evaluation/retrieval-research/results/hr2-final/cells --out evaluation/retrieval-research/results/hr2-final/scores.json
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/report.mjs --scores evaluation/retrieval-research/results/hr2-final/scores.json --out evaluation/retrieval-research/results/hr2-final/report.json --markdown evaluation/retrieval-research/results/hr2-final/report.md
```

Compare the printed archive SHA-256 with [INPUTS.md](INPUTS.md). All 240 cells (5 arms × 3 rankings × 2 overheads × 8 budgets) contain per-query ranked IDs, admitted unit IDs, base token counts, charged costs and used totals. Metadata records the implementation HEAD, frozen protocol commit, all seven fixture hashes, counter ID, source ranking path/hash/run metadata and CPU/RAM/OS. Before writing any cell, `run.mjs` authenticates every selected input. For test, it also pins each selected member's exact bytes to INPUTS.md. The scorer reauthenticates fixtures, source ranking bytes and metadata, ranked IDs and costs, then replays the declared arm and requires exact admission order and totals. Keep source ranking files at their recorded absolute paths until scoring finishes.

For a dev smoke run, substitute `--rankings evaluation/retrieval-research/results/dev --split dev` and choose fresh output paths in an owned `createTestWorkspace`. Worker smoke runs are restricted to dev; see WORKER-REPORT.md for commands actually completed. Dev reports have no confirmatory comparison or decision. Tests use tiny authored dev fixtures; the statistics adapter uses synthetic rows to verify the primary designation without running test assembly.

`run.mjs` defaults to all five arms, all three rankings, all eight frozen budgets and both overheads if those four options are omitted. Fixture directory, ranking directory, split, scale and output are required. Invalid options or inputs fail explicitly with exit 1. `score.mjs` and `report.mjs` accept the exact options illustrated above. Report JSON retains all scored query admissions and strata; Markdown includes cell metrics, category means/deltas, strata counts, provenance, bootstrap counts/status and McNemar discordants. An inconclusive statistical outcome is a valid report, not a process error.

## Worker-declared decisions

- The protocol is v1.1 (the frozen v1 rules with editorial corrections); record that version and its full freeze commit separately from implementation HEAD. The coordinator commits the implementation; uncommitted changes retain the preceding HEAD and are identified by the source hash and dirty flag.
- Body unit IDs are `<memory>#body`; span IDs are preserved verbatim. An s1 arm selects array index zero, regardless of ID suffix. Admission arrays retain visit order; context is their set. No text normalization, truncation, concatenation or tokenization of metadata occurs. Unit cost is the separate text count plus O.
- The counter memoizes counts by exact text within a process so scoring the grid does not repeatedly tokenize the same frozen units. This does not change counts or admission.
- Authenticate the full HR-1 split query set, including C8 and FOREIGN diagnostic rows, and inspect their final rankings too. Only C1–C7 produce assembly/scoring rows. Queries and split metadata determine this set; label bytes are hashed but are not parsed by assembly or its authentication. Frozen audit actions do not drop or recategorize queries. Labels are parsed only by the scorer.
- Dev uses the same configuration, eligibility and seven-hash checks, with `run.split=dev`; it has no frozen test-member digest requirement. Test accepts only the three with-foreign member digests in INPUTS.md. The archive digest is provenance; extraction consumers authenticate member bytes directly. No archive is required beside an extraction.
- Assembly's only prepared inputs are item/unit IDs, original text, integer token costs, ranked IDs, B and O. Preparation discards `expresses`, fact IDs and all other metadata. Assembly receives no labels, query text, intent, category, family or fidelity.
- Unmentioned CLI defaults are the frozen grid. Restrict budgets and overheads to that grid, reject duplicate selections, and require an empty output directory to prevent mixing partial or stale runs. `--rankings` means an extracted directory, as specified by its `<dir>` argument.
- Full cell metrics require all seven categories for a macro; otherwise return null. Strata average only represented categories, omit queries with no matching groups, and retain query/group counts, represented categories and per-query rows. Group fidelity is recomputed over eligible target members at S1000; alternative valid members count once per group. A named required span is covered if any listed supporting span is admitted whole.
- Token-use p50/p95 use the shared statistics module's linearly interpolated percentile at `(n−1)p`; the dev probe used a different order-statistic convention. No protocol rule fixes token-use interpolation, so use the existing library consistently.
- The ceiling always admits every body and every span of the full frozen ranking, including for s1 arms. It is independent of arm, budget and overhead. Loss is ceiling minus coverage.
- Report every supplied non-P-top arm against the matching P-top cell, using the frozen bootstrap configuration for each. Only test/S1000/A3--bge-m3/O0/B512/P-cover versus P-top is confirmatory. A missing baseline, bad row, incomplete pair or fewer than ten families in any category makes that comparison inconclusive. A missing primary pair makes the decision inconclusive. Other valid cells can still be reported.
- McNemar delegates the smallest-ID selection to the existing library. Dev output renames its selection description to say dev, preserving the same algorithm. The library's `exploratory:true` chooses 95% endpoints even for the designated confirmatory contrast; it does not determine HR-2's designation.
- Optional length stress is skipped under §6.1. No protocol rule was changed. No output interpretation is performed by this worker.

## Fix-round provenance and reporting

Each stage records an implementation identity: Git commit, deterministic SHA-256 of a sorted list of relative `.mjs` paths and their byte hashes under `assembly/`, source paths, Git dirty state and whether HEAD is detached. This includes nested source modules; documentation and reserved `.hr2-*` owned scratch directories are excluded from the source hash. Dirty state covers the working tree except those scratch directories. Assembly identity is in each cell; scoring preserves it and records its own identity; reports preserve both and record the report identity. Comparisons require identical assembly identities. Old cells without these records must be regenerated; no compatibility fallback is used.

Scorer/report identities are captured at module load; assembly identity is captured when assembly starts. Git uses explicit file descriptors and `createTestWorkspace` with an assembly-directory parent, so neither subprocess pipes nor writable `/tmp` are required. For light fix-round tests, use the owned runner one file at a time without the heavy queue; set `TMPDIR`, `TMP` and `TEMP` to an owned workspace inside the worktree when `/tmp` is read-only. The runner's `--script <test-file>` mode exposes per-case TAP counts when sandbox IPC leaves normal mode with file-level counts only.

Before any bootstrap, reporting validates every scored cell's format, complete status, frozen protocol version/commit/counter, source ranking configuration and hash, seven fixture hashes, query set and stage identities. Test hashes must match INPUTS.md; dev hashes must have valid SHA-256 shape and agree with recorded source metadata. Invalid provenance, pair metadata or assembly identities yields `invalid_inputs`, no comparisons, and no confirmatory designation. Dirty or detached trees are recorded explicitly and are not silently treated as clean.

Markdown records shared provenance once, then compact cell, comparison, category and fidelity/language tables keyed by cell number. JSON retains exhaustive provenance, per-query data and unrounded metrics. `run.mjs` returns the configured `grid`, its mechanically computed `expectedCells`, and the actual `cells` count; the default is 240.
