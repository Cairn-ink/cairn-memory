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

### Historical v1.1 run — do not re-run

**Historical, do not re-run:** the following commands record the frozen v1.1
run. Their `results/hr2-final/` destinations are now protected regression
inputs. Use the [current host-v2 commands](#exact-coordinator-commands-for-the-host-v2-test-grid)
with `results/hr2-host-v2/` destinations, or fresh owned scratch for dev runs.
`--rankings` accepts an extracted archive root or its `with-foreign` directory,
not a compressed archive filename.

```text
mkdir -p evaluation/retrieval-research/results/hr2-final/inputs
sha256sum evaluation/retrieval-research/results/test-final/rankings.tar.xz
tar -xJf evaluation/retrieval-research/results/test-final/rankings.tar.xz -C evaluation/retrieval-research/results/hr2-final/inputs
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/run.mjs --fixture-dir evaluation/retrieval-research/fixtures --rankings evaluation/retrieval-research/results/hr2-final/inputs --split test --scale S1000 --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail --rankings-select A1,A3--bge-m3,F-RRF10--openai-3-small --budgets 128,192,256,384,512,768,1024,1536 --overheads 0,8 --out evaluation/retrieval-research/results/hr2-final/cells
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/score.mjs --fixture-dir evaluation/retrieval-research/fixtures --cells evaluation/retrieval-research/results/hr2-final/cells --out evaluation/retrieval-research/results/hr2-final/scores.json
~/.local/bin/cairn-heavy node evaluation/retrieval-research/assembly/report.mjs --scores evaluation/retrieval-research/results/hr2-final/scores.json --out evaluation/retrieval-research/results/hr2-final/report.json --markdown evaluation/retrieval-research/results/hr2-final/report.md
```

Compare the printed archive SHA-256 with [INPUTS.md](INPUTS.md). All 240 cells (5 arms × 3 rankings × 2 overheads × 8 budgets) contain per-query ranked IDs, admitted unit IDs, base token counts, charged costs and used totals. Metadata records the implementation HEAD, frozen protocol commit, all seven fixture hashes, counter ID, source ranking path/hash/run metadata and CPU/RAM/OS. Before writing any cell, `run.mjs` authenticates every selected input. For test, it also pins each selected member's exact bytes to INPUTS.md. The scorer reauthenticates fixtures, source ranking bytes and metadata, ranked IDs and costs, then replays the declared arm and requires exact admission order and totals. Keep source ranking files at their recorded absolute paths until scoring finishes.

For a current dev smoke run, use the host-v2 command with `--rankings evaluation/retrieval-research/results/dev --split dev` and fresh output paths in an owned `createTestWorkspace`. Worker smoke runs are restricted to dev; see WORKER-REPORT-host-v2.md for commands actually completed. Dev reports have no confirmatory comparison or decision. Tests use tiny authored dev fixtures; the statistics adapter uses synthetic rows to verify the primary designation without running test assembly.

All three stages refuse protected destinations with `protected_output_path`
before creating output or provenance scratch. The shared guard resolves the
deepest existing ancestor with `realpathSync`, follows symlinks, and appends
missing components. Protected paths are fixed relative to the repository:
`assembly/overhead-host-v2.json`, everything in `results/hr2-final/`,
`results/test-final/` and `fixtures/`, and any existing regular output file.
Score and report require fresh, distinct file destinations; run accepts a
fresh directory or an existing empty directory and keeps its non-empty-directory
refusal. Writers revalidate physical paths and create files exclusively, so
existing files are never overwritten, including files created earlier by the
same stage.

`run.mjs` defaults to all five arms, all three rankings, all eight frozen budgets and both overheads if those four options are omitted. Fixture directory, ranking directory, split, scale and output are required. Invalid options or inputs fail explicitly with exit 1. Use the current host-v2 section for executable score/report commands with fresh destinations. Report JSON retains all scored query admissions and strata; Markdown includes cell metrics, category means/deltas, strata counts, provenance, bootstrap counts/status and McNemar discordants. An inconclusive statistical outcome is a valid report, not a process error.

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

Scorer/report identities are captured at module load for imports; direct CLI runs capture them after all output destinations pass preflight. Assembly identity is captured when assembly starts, after destination preflight. Git uses explicit file descriptors and `createTestWorkspace` with an assembly-directory parent, so neither subprocess pipes nor writable `/tmp` are required. For light fix-round tests, use the owned runner one file at a time without the heavy queue; set `TMPDIR`, `TMP` and `TEMP` to an owned workspace inside the worktree when `/tmp` is read-only. The runner's `--script <test-file>` mode exposes per-case TAP counts when sandbox IPC leaves normal mode with file-level counts only.

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

## HR-2b v1 (freeze `c546bfc1`)

HR-2b selects a separate protocol profile from `hr2b-fixture-v1`. HR-2's
identities, fixed hashes, ranking paths, eight budgets, bootstrap seed, numeric
O=0 primary selector and saturation grid retain their original branch.
HR-2b test ranking runs explicitly select `--fixture-version hr2b-fixture-v1`
before any fixture read; the loaded version must match. Legacy ranking callers
retain their selection gate before fixture loading. HR-2b uses S1000, the existing target/foreign namespaces, body-only A1 and
bge-m3+A3 rankings, budgets 1000/1500/2000/4000 and seed
`hr2b-bootstrap-v1`. Default HR-2b assembly writes both O=0 and host-v2 (80
cells); `--overheads 0` or `--overhead-model host-v2` restricts the model.
Only test/A3--bge-m3/host-v2/B1500/P-top-s1 versus P-top is confirmatory.
Later-receipt is the guard; quota failure, either invalid/underpopulated
bootstrap, or zero guard ranking ceiling makes the decision Inconclusive.

The field-schema filenames retain `hr1-*.json` in the new fixture directory.
All version-bearing roots must agree, including optional audit versions. The HR-2b split CLI adds its authenticated
version and defaults to seed `hr2b-split-v1`; HR-1 bytes/seed are preserved.
The facts view remains text-free about memories and never includes placement
or receipt positions. HR-2b body expressions contribute body support only,
even when their legacy `span` field names a receipt; use `span:null` for
body-only expressions and explicit span expressions for receipt evidence.
Placement is recomputed after every audit from eligible members: any body,
then any first receipt, then later only. Labels record `placement` per group
and top-level `placement:{ok,errors,guardCategories,splits}`. The represented
guard categories are the union across both splits, and are checked in both
splits without trimming. Dropped queries do not count toward quotas.

Structural conventions where §3 leaves encoding/tolerances unspecified:

- Counts allow ±10% around 160/320/60, as the HR-1 “about” convention.
  Length and receipt-count distribution shares allow ±5 percentage points.
  Length bands are lower-inclusive, upper-exclusive except the last upper
  endpoint (400/200), which is inclusive. Means are matched within 15%.
  The reused field schema retains its 4000/800 UTF-16 body/receipt caps;
  W1 must meet token bands and these caps together. Body sentence counts use `. ! ? 。！？` terminators and one or two paragraphs.
  Target families have exactly seven rendered facts plus one absent fact.
- `facts.forbiddenLexicon` maps every canonical fact id, including absent facts, to a nonempty array of
  forbidden terms. W1 supplies entity/alias/translation/numeric/date and
  distinctive forms; tools cannot infer semantic completeness of that list.
  `corpus.filler.sentences` holds `{id,text}` sentence-bank entries;
  `corpus.filler.ranges` holds `{sentence,memory,where,span,start,end}`.
  Offsets are UTF-16 `[start,end)` in the named unit (`span:null` for body),
  equal the sentence text, and are nonoverlapping in unit order. Every target
  and distractor unit discloses filler. Every bank sentence is scanned
  against every fact's NFKC/lowercase/whitespace-normalized lexicon terms.
  W3 separately audits semantic entailment; mechanical acceptance never
  claims that semantic audit passed.
- Equal fusion weights retain the existing A3 constants `[0.45,0.45]`;
  no score, indexing, tokenizer, horizon or fusion algorithm is changed.
  `configuration.json` freezes these exact constants and fixture hashes.
- Fixture FROZEN.md lists at least the seven schema files and may list builder,
  lexicon and bank files too; every listed member is authenticated. Rankings
  FROZEN.md lists configuration, calibration and both arms for each split:
  `dev/A1.json`, `dev/A3--bge-m3.json`, `test/A1.json`,
  `test/A3--bge-m3.json`. Use the same two-column backtick table as HR-1.
- Existing `fixtures-hr2b/`, `results/hr2b-rankings/` and
  `results/hr2b-final/` are protected assembly destinations. Stage assembly,
  scores and report in fresh scratch, then promote the completed directory.
  Calibration/configuration/ranking authoring tools create new files before
  their freeze; they never overwrite an existing configuration or calibration.
  Output guards resolve physical ancestors/symlinks on every check.

The dependency-free research serializer transcribes the payload rules at
`b18dabe0`, including defaults, metadata ordering, sourcesComplete,
sameAsBody and backward sameAs. Calibration serializes 120/220/400-token
bodies, 40/120/200-token receipts, 1–6 receipts, 1/2 items, all delivered
prefix lengths and both completeness states. Probe strings are deterministic,
synthetic and fact-free; errors are modelled minus measured o200k tokens.
The pinned overhead JSON is read and authenticated, never retuned.

The new host-v2 archive regression replays 120 cells in scratch, removing only
current scorer identity, then compares regenerated report content except its
current report identity. The unchanged legacy regression does the same for
240 cells. HR-1 tooling regression compares regenerated facts view, split and
audited labels to committed files. No validation-result file exists in
`fixtures/`; it compares current validation bytes to the validator and its
lib/tools at `c546bfc1`, reconstructed in owned scratch.

### Coordinator steps 3–5 (never worker commands)

Run from a clean reviewed checkout, offline, on Node 22.16.0. W1/W2/W3 remain
separate authors; stop on any failure and retain candidate-seed diagnostics.
The following zsh helper logs the exact command and actual exit code. Keep the
coordinator session supervised; these commands do not establish a monitor.

```zsh
set -e
set -o pipefail
hr2b_root=evaluation/retrieval-research
hr2b_fixture="$hr2b_root/fixtures-hr2b"
hr2b_rankings="$hr2b_root/results/hr2b-rankings"
hr2b_final="$hr2b_root/results/hr2b-final"
hr2b_checkout="$(git --no-optional-locks status --porcelain --untracked-files=all)"
[[ -z "$hr2b_checkout" ]]
hr2b_commit="$(git rev-parse HEAD)"
[[ "$(node --version)" == v22.16.0 ]]
hr2b_stage_root="$(mktemp -d "$hr2b_root/assembly/.hr2-hr2b-coordinator-XXXXXX")"
print -r -- "checkoutCommit=$hr2b_commit" "checkoutStatus=$hr2b_checkout" 'protocolCommit=c546bfc1' > "$hr2b_stage_root/preflight.log"
hr2b_stage() {
  local hr2b_name="$1"
  shift
  print -r -- "${(q)@}" > "$hr2b_stage_root/$hr2b_name.command"
  local hr2b_rc=0
  "$@" > "$hr2b_stage_root/$hr2b_name.log" 2>&1 || hr2b_rc=$?
  print -r -- "$hr2b_rc" > "$hr2b_stage_root/$hr2b_name.exit"
  cat "$hr2b_stage_root/$hr2b_name.log"
  return "$hr2b_rc"
}

# Step 3: after W1 authors facts, corpus, filler and its frozen builder/checker.
hr2b_stage world node "$hr2b_fixture/build/check-world.mjs"
hr2b_stage facts node "$hr2b_root/tools/facts-view.mjs" --fixture "$hr2b_fixture"
# W2 authors hr1-queries.json from hr1-facts-view.json only.
hr2b_stage split node "$hr2b_root/tools/split.mjs" --fixture "$hr2b_fixture" --seed hr2b-split-v1
hr2b_stage labels node "$hr2b_root/tools/labels.mjs" --fixture "$hr2b_fixture"
hr2b_stage init-audit node --input-type=module -e 'import {writeFile} from "node:fs/promises"; await writeFile(process.argv[1],JSON.stringify({version:"hr2b-fixture-v1",overrides:[]},null,2)+"\n",{flag:"wx"})' "$hr2b_fixture/hr1-label-audit.json"
hr2b_stage validate-before-audit node "$hr2b_root/tools/validate.mjs" --fixture "$hr2b_fixture"
# W3 replaces the empty audit with overrides and a semantic filler audit record.
hr2b_stage audit node "$hr2b_root/tools/apply-audit.mjs" --fixture "$hr2b_fixture"
hr2b_stage validate node "$hr2b_root/tools/validate.mjs" --fixture "$hr2b_fixture"
hr2b_stage freeze-fixture node "$hr2b_root/tools/freeze-hr2b.mjs" --dir "$hr2b_fixture"
# The freezer reconciles a filesystem walk against git cached+untracked names,
# prints the count and actual git exit code, then writes hashes exclusively.
# Coordinator commits fixture freeze before executing step 4.

# Step 4: configuration precedes calibration, which precedes any ranking.
[[ ! -e "$hr2b_rankings" ]]
hr2b_stage configuration node "$hr2b_root/tools/hr2b-configuration.mjs" --fixture "$hr2b_fixture" --out "$hr2b_stage_root/configuration.json"
hr2b_stage calibration node "$hr2b_root/assembly/calibrate-host-v2.mjs" --out "$hr2b_stage_root/host-v2-calibration.json"
mkdir -p "$hr2b_rankings"
cp "$hr2b_stage_root/configuration.json" "$hr2b_stage_root/host-v2-calibration.json" "$hr2b_rankings/"
hr2b_stage rank-dev ~/.local/bin/cairn-heavy node "$hr2b_root/run.mjs" --fixture-dir "$hr2b_fixture" --fixture-version hr2b-fixture-v1 --split dev --scale S1000 --arms A1,A3 --models bge-m3 --isolation-variant with-foreign --out "$hr2b_rankings/dev"
hr2b_stage rank-test ~/.local/bin/cairn-heavy node "$hr2b_root/run.mjs" --fixture-dir "$hr2b_fixture" --fixture-version hr2b-fixture-v1 --split test --scale S1000 --arms A1,A3 --models bge-m3 --isolation-variant with-foreign --out "$hr2b_rankings/test"
# Retain ledger (no hosted dispatches), truncation metadata and all logs.
hr2b_stage freeze-rankings node "$hr2b_root/tools/freeze-hr2b.mjs" --dir "$hr2b_rankings"
# Coordinator commits ranking freeze before executing the optional dev check.
# One optional dev assembly/score/report uses the next three commands with
# --split dev and separate fresh paths; record it in protocol §9. Never repeat.

# Step 5: exactly one test assembly after reviews and owned-runner acceptance.
[[ ! -e "$hr2b_final" ]]
hr2b_test_checkout="$(git --no-optional-locks status --porcelain --untracked-files=all -- . ':(exclude,glob)evaluation/retrieval-research/assembly/.hr2-*/**')"
[[ -z "$hr2b_test_checkout" ]]
{
  print -r -- "checkoutCommit=$(git rev-parse HEAD)" "checkoutStatus=$hr2b_test_checkout" 'protocolCommit=c546bfc1'
  node --version
  sha256sum "$hr2b_fixture/FROZEN.md" "$hr2b_rankings/FROZEN.md" "$hr2b_root/assembly/overhead-host-v2.json"
} > "$hr2b_stage_root/test-preflight.log" 2>&1
hr2b_stage run ~/.local/bin/cairn-heavy node "$hr2b_root/assembly/run.mjs" --fixture-dir "$hr2b_fixture" --rankings "$hr2b_rankings" --split test --scale S1000 --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail --rankings-select A1,A3--bge-m3 --budgets 1000,1500,2000,4000 --out "$hr2b_stage_root/cells"
hr2b_stage score ~/.local/bin/cairn-heavy node "$hr2b_root/assembly/score.mjs" --fixture-dir "$hr2b_fixture" --cells "$hr2b_stage_root/cells" --out "$hr2b_stage_root/scores.json"
hr2b_stage report ~/.local/bin/cairn-heavy node "$hr2b_root/assembly/report.mjs" --scores "$hr2b_stage_root/scores.json" --out "$hr2b_stage_root/report.json" --markdown "$hr2b_stage_root/report.md"
hr2b_stage hashes zsh -c 'cd "$1"; sha256sum cells/*.json scores.json report.json report.md > SHA256SUMS.uncompressed' hr2b-hashes "$hr2b_stage_root"
hr2b_stage archive-cells tar -cJf "$hr2b_stage_root/cells.tar.xz" -C "$hr2b_stage_root" cells
hr2b_stage archive-scores xz -k "$hr2b_stage_root/scores.json"
hr2b_stage archive-report xz -k "$hr2b_stage_root/report.json"
hr2b_stage archive-hashes zsh -c 'cd "$1"; sha256sum cells.tar.xz scores.json.xz report.json.xz > archive.sha256' hr2b-archive-hashes "$hr2b_stage_root"
mv "$hr2b_stage_root" "$hr2b_final"
# Require cells=expectedCells=80. Retain failed stages, commands, actual exits,
# provenance and archives. Force-add .log artifacts when the coordinator commits.
```


### HR-2b audit and provenance checks

HR-2b authentication and scoring use the active, audited query identities and
categories. Original query records stay intact; dropped queries do not enter
rankings or scoring. Paired recategorizations retain W3's checked categories.
Placement rows, required-group denominators and metrics are re-derived from
frozen labels and admissions at report validation. Every scored item's text
and token counts must equal the authenticated corpus projection, for both
scalar and host-v2 cells.

The generation checker scans lexicons for every canonical fact, including C8's
absent facts. First-receipt-only support cannot also occur in a later receipt;
post-audit group classification separately retains body → first → later
precedence. Receipt order compares parsed instants, then ids; offset and
fractional-second spellings are accepted when chronologically ordered.
`lib/fixture-profiles.mjs` owns fixture counts, receipt limits/distributions and
placement quotas. Authoritative constants are deeply frozen; returned
configuration and protocol profiles are independent snapshots.
