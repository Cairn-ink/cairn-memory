# HR-2 offline assembly harness

Implements the frozen [HR-2 v1.1 protocol](../../../docs/plans/budgeted-assembly-hr2.md), frozen at `c863e9d674f23ccebffaf3ad96ab1c4b34eabc82`. Research only; no models, network, adapters or product changes. Node **22.16.0** is the reference runtime; touched tests also run on **24.15.0**.

## Coordinator commands

Run from the repository root with the existing offline dependencies. Do not
install or replace them in the worker sandbox; report a missing dependency.

```sh
~/.local/bin/cairn-heavy node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs
~/.local/bin/cairn-heavy ~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-*.test.mjs
```

Check that `node --version` is `v22.16.0`. Do not remove or replace an existing `node_modules` symlink. The checked-in lockfile pins the counter to `tiktoken@1.0.22`.

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

## host-v2 extension (§11 v1.2.1)

The extension is frozen at `4fb90832`, separately from the unchanged v1.1
protocol identity. Select it with `--overhead-model host-v2`; this is mutually
exclusive with `--overheads`. Omitting both selects the legacy numeric grid.
The host grid is five arms × three rankings × eight budgets = **120 cells**.
File names contain `--Ohost-v2@42627f60--`. Assembly authenticates the constants
before checking inputs or creating output. Scoring and reporting independently
authenticate the model and replay its admissions. Scored cells record
`run.overheadModelDigest`, and comparison identity includes that digest.

This is an exploratory fixed additive default-Memory calibration, not measured
shipped-host token counts. It does not faithfully model UUID/text tokenization
variation, later completeness transitions, cross-item backward `sameAs`
deduplication, non-default metadata or sourceAccess, or Cards. These limitations
are included in host cells, scores, report JSON and Markdown.

### Legacy regression before the coordinator run

Run these files individually (workers do not use the heavy queue):

```sh
node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-host-v2.test.mjs
node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-host-v2.test.mjs
~/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/retrieval-research/test/assembly-legacy-regression.test.mjs
```

The legacy test extracts `cells.tar.xz`, `scores.json.xz` and `report.json.xz`
from `results/hr2-final/` into a `createTestWorkspace` scratch directory. It
authenticates the seven fixture hashes, re-scores all **240** archived cells,
removes **only** `run.implementation.scorer` from both sides and compares the
serialized JSON bytes of each cell, including admission order, costs, totals,
metrics, summaries and strata. It regenerates the report from the archived
scores and compares **all content except the top-level report stage identity**
byte for byte, including every statistic and the confirmatory outcome. It
records real current scorer/report identities separately in scratch and prints
them with the regression result; it never substitutes archived identities into
new outputs. The archives and repository results remain untouched. Missing
archives are the only skip condition, with an explicit printed reason.

Normal owned-runner mode can expose only one file-level TAP result in this
sandbox. The same one-file command with `--script` immediately after `run.mjs`
exposes per-case counts, regression progress and stage identities. Check the
actual process exit code in both modes; do not infer success from a log tail.
The host test also performs a **dev-only** three-cell CLI pipeline against
`results/dev/`, exclusively in owned scratch. It does not run test assembly.

### Exact coordinator commands for the host-v2 test grid

Only the coordinator executes this section, after the two non-author reviews
and owned-runner acceptance on both Node versions. Use a clean checkout of the
reviewed implementation commit, with the offline dependencies already present.
The original `hr2-final/` artifacts are regression inputs, never output paths.
Run the following in zsh from the repository root. The stage function records
the exact command, output and **actual exit code**, retains failures, and stops
at the first failure. Preflight captures checkout state in memory **before any
output exists**; implementation identities are independently recorded by each
stage. Keep the coordinator session supervised until it finishes.

```zsh
set -e
set -o pipefail
hr2_out=evaluation/retrieval-research/results/hr2-host-v2
[[ ! -e "$hr2_out" ]]
hr2_checkout_status="$(git --no-optional-locks status --porcelain --untracked-files=all)"
[[ -z "$hr2_checkout_status" ]]
hr2_checkout_commit="$(git rev-parse HEAD)"
[[ "$(node --version)" == v22.16.0 ]]
[[ -d evaluation/retrieval-research/node_modules/tiktoken ]]
mkdir -p "$hr2_out/inputs"
{
  print -r -- "checkoutCommit=$hr2_checkout_commit"
  print -r -- "checkoutStatus=$hr2_checkout_status"
  print -r -- 'protocolCommit=c863e9d674f23ccebffaf3ad96ab1c4b34eabc82'
  print -r -- 'extensionCommit=4fb90832'
  node --version
  sha256sum evaluation/retrieval-research/assembly/overhead-host-v2.json
  sha256sum evaluation/retrieval-research/results/test-final/rankings.tar.xz
} > "$hr2_out/preflight.log" 2>&1

hr2_stage() {
  local hr2_stage_name="$1"
  shift
  print -r -- "${(q)@}" > "$hr2_out/$hr2_stage_name.command"
  local hr2_stage_rc=0
  "$@" > "$hr2_out/$hr2_stage_name.log" 2>&1 || hr2_stage_rc=$?
  print -r -- "$hr2_stage_rc" > "$hr2_out/$hr2_stage_name.exit"
  cat "$hr2_out/$hr2_stage_name.log"
  return "$hr2_stage_rc"
}

hr2_stage extract tar -xJf evaluation/retrieval-research/results/test-final/rankings.tar.xz -C "$hr2_out/inputs"
hr2_stage run ~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/run.mjs --fixture-dir evaluation/retrieval-research/fixtures --rankings "$hr2_out/inputs" --split test --scale S1000 --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail --rankings-select A1,A3--bge-m3,F-RRF10--openai-3-small --budgets 128,192,256,384,512,768,1024,1536 --overhead-model host-v2 --out "$hr2_out/cells"
hr2_stage score ~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/score.mjs --fixture-dir evaluation/retrieval-research/fixtures --cells "$hr2_out/cells" --out "$hr2_out/scores.json"
hr2_stage report ~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/report.mjs --scores "$hr2_out/scores.json" --out "$hr2_out/report.json" --markdown "$hr2_out/report.md"
hr2_stage hashes zsh -c 'cd "$1"; sha256sum cells/*.json scores.json report.json report.md > SHA256SUMS.uncompressed' hr2-hashes "$hr2_out"
hr2_stage archive-cells tar -cJf "$hr2_out/cells.tar.xz" -C "$hr2_out" cells
hr2_stage archive-scores xz -k "$hr2_out/scores.json"
hr2_stage archive-report xz -k "$hr2_out/report.json"
hr2_stage archive-hashes zsh -c 'cd "$1"; sha256sum cells.tar.xz scores.json.xz report.json.xz > archive.sha256' hr2-archive-hashes "$hr2_out"
```

Compare the preflight digests with INPUTS.md. The harness independently refuses
wrong constants and wrong extracted member bytes before producing cells. The
run summary must say `cells:120` and `expectedCells:120`. The report must have
48 exploratory comparisons; it retains the unchanged bootstrap seed,
10,000 resamples, ten-family minimum and 95% endpoints, labelled pointwise and
unadjusted. `hostV2.macroCoverage` is the ranking/arm × budget table;
`hostV2.saturation` and `hostV2.cells` hold the ceiling and rejected-unit/alias
diagnostics. The coordinator places the host table beside the frozen O=0 rows
in the results document and restates the archived confirmatory outcome without
changing it. A host-only report has `primary_cell_absent`; it cannot establish
a new confirmatory outcome. Supplying numeric cells alongside host cells
includes numeric O=0 rows in the macro table and keeps each comparison within
its authenticated model. Never reinterpret a cross-model difference as a
paired contrast.

### Worker-declared decisions (host-v2)

- `assemble` accepts a stateless `cost` object with `initial` and
  `unit(unit, item, isBody, committedBodyCount)`. `scalarCost(O)` starts at zero;
  the existing `overhead:O` option delegates to it and retains the exact legacy
  return shape. `hostV2Cost(model)` starts at E and returns additional host-only
  query diagnostics. A bundle calculates all costs without mutation, then
  commits all units together. No body trial, receipt trial or failed bundle
  changes the committed-body count.
- Body equality means exact original string equality, with no normalization,
  concatenation or truncation. A concrete span costs `C-bodyTokens+tokens` and
  an equal span costs A. No receipt needs an extra rank or completeness charge.
- §11 does not specify whether the body-equal count is scheduled or admitted.
  `bodyEqualSpanCount` counts **admitted aliases**, summed over queries in a
  cell. `rankedBodyEqualSpanCount` additionally counts **all span occurrences
  in those queries' rankings**, including unscheduled/rejected spans, so the
  fixture's expected lack of body-equal spans remains inspectable. These are
  occurrences, not distinct fixture spans, and the two counts are not summed.
- `budgetRejected` is a per-query boolean. It becomes true on any budget-failed
  scheduled unit or atomic bundle, including a failed bundle whose body later
  fits in the tail. Detached spans and the unscheduled remainder of an s1 arm
  do not count as budget rejection. `budgetRejectedQueryCount` is the count of
  true booleans per cell; no ambiguous count of rejected bundle members is used.
- Host scores retain `assemblyItems`: only evaluator-free prepared IDs, texts
  and token counts for the union of their ranked items. These come from the
  authenticated fixture at scoring. Report provenance checks token counts and
  IDs and replays every query and diagnostic with these inputs and the pinned
  model. Numeric scores gain no fields. The scored digest is
  `run.overheadModelDigest`; an inconsistent digest or model payload refuses.
- Host contrasts are exactly P-cover − P-top and P-top-s1 − P-top. The other
  two arms still appear in metrics and saturation. Numeric reports retain all
  four legacy contrasts and the exact numeric `overhead === 0` primary selector.
- Saturation tests loss **per query**, at each candidate budget and every
  larger tested budget; it never uses a macro tolerance or assumes monotonicity.
  Partial CLI grids remain permitted for smoke testing, but saturation is
  labelled `incomplete grid` unless all five arms and all eight frozen budgets
  are present for that ranking/split/digest. Complete grids with no qualifying
  budget say exactly `not reached through 1,536`. Ceiling attainment and budget
  rejection are reported separately.
- The frozen budget whitelist remains in force. A requested nonnegative
  integer below E refuses `context_item_too_large` before fixture reads or
  output creation; other off-grid budgets refuse `invalid_budgets`. Unknown
  model names, numeric cells carrying host metadata, and host cells missing
  host metadata refuse explicitly. The §5 ranking/fixture authentication is
  unchanged. No new dependency, model, network call or API key is used.
