# Context-read qualification inputs: preparation handoff

**Qualification remains blocked by the F/A rehearsal. Do not start either long
segment.** The authorized harness fixes and product registration are implemented.
The tiny real session leaves all four first-eligible Memory/Card intent targets
unobserved under same-projection capture/review writes. An earlier session with
the adapter quantum also exported a failed pump with `index_unavailable`. Other cell kinds complete their functional
checks. No engine runtime change, qualification timing run, network access,
package installation or commit was made.

## Remaining blocker and evidence

The real session runs the public `renewContextMaintenancePump`, an independent
fresh writer, a session child and fresh reader lanes. The writer exports actual
eligible native commits for Memory history/current and Card history/current.
With the adapter quantum the pump reported
`{state:"failed",error:"index_unavailable"}`; with the larger session rehearsal
quantum it did not export that failure, but all four targets still remained
unobserved. Both rehearsals failed their functional target checks. A separate public reader/maintainer inspection of the failed
world returned `lexical.state:"stale", reason:"fence_changed"`; fresh explicit
refreshes returned `rebuilding` after the writer stopped.

The likely connection is the engine's `context-product-sidecar.mjs` refresh
refusal on an in-flight fence change and `context-product-pump.mjs` stopping on
any unsuccessful refresh. This is an inference from the observed public results
and existing source, not an assertion that an internal exception reason was
exported: the pump exports the error code only. Resolving that behavior needs
engine-owner review. Restarting failed pumps, slowing the registered ordinary
writer, dropping first-eligible revisions or manufacturing observations would
hide this failure; none is used to clear the package.

The harness now retains failed pump completions and renewal exceptions as
failures through cleanup. A failed pump cannot silently supply a successful
functional session. The final rehearsal report has `status:"failed"`,
`functionalPassed:false`, `qualifying:false`, `timingClaims:false` and confirmed
workspace cleanup. CLI exit **1** is expected for every non-passing status;
the final flags distinguish a successful non-qualifying rehearsal from failure.

## Package contents

- `corpus.mjs`, `generate-child.mjs`, `generate.mjs`, `manifest.json`: seeded,
  synthetic zh/ja/en data; six physical layouts, 1,112/3,336 Memories at v18/v23/
  v33. Physical v18 has zero Cards; v23/v33 have 111/333 Cards. SQLite creates,
  inspects, compacts and seals canonical content/schema. Only a separate
  SQLite-free child hashes/copies database bytes after the generator exits.
  All six snapshots were rebuilt and matched their frozen seals on Node v24.22.1.
- `labels.json`, `queries.json`: exact relevant identities, stable ranking,
  recall@5/@12 labels, empty control and the single-Han `中` versus `中文` miss.
  Launch selects personal plus three projects; overflow selects 32 of 33
  namespaces and reports the omission. Other-owner writes use a separate owner.
- `adapter.mjs`, `schemas.mjs`: closed DTOs for all ten method profiles, exact
  readSet/deadline, ordered evidence/revisions and independently prepared
  snapshots/fences. Contractual not-ready/busy error DTOs are validated without granting a
  successful sample; normal read timeouts/cancellation remain functional failures.
  Status includes the engine's actual absent/ready/stale/unavailable/building/
  catching_up states.
- `counter.mjs`: exactly `tiktoken` **1.0.22**, `tiktoken/lite` `Tiktoken`, with
  `js-tiktoken` **1.0.21** `o200k_base` ranks; `encode(text,[],[])`, no multiplier,
  ID **`o200k_base-v1`**. Both packages are available offline. A registration
  input `counterConfiguration.dependencyRoot` selects their existing dependency
  root. Versions are checked; missing/wrong packages fail explicitly. Package
  metadata, lite code, WASM and ranks are included in registration input hashes.
- `registration.engine.template.json`, `registration.mjs`: frozen product facts,
  twelve F/A schedules, independent type/intent targets, state probes/deadlines,
  two complete segments, host filling and both harness validators. Product-fact
  overrides and unresolved `PLACEHOLDER` values are rejected. The writer file is
  required as an explicit registration input and retains its original provenance.

## Authorized harness changes

`postCatchupHasRef` converts personal SQLite `project_id:''` to public
`projectId:null`, preserving project IDs. Its regression performs a real SQLite
seed/build/read, obtains the returned Memory's canonical row, and tests that row.
The regression exited **1** against the original comparison and **0** after the
fix, including wrong-owner/project rejection controls.

The namespace audit searched all harness storage-column uses and all namespace/
ref construction/comparisons. Other relevant sites already normalize correctly:
`context-read-source-work.mjs` converts public namespaces to storage keys;
`p2e-canonical.mjs` converts storage personal IDs to null; the qualification
adapter normalizes row refs; writer/session comparisons use public namespaces
on both sides. The adapter now spells the personal conversion explicitly too.
No other storage/public mismatch was found.

Functional capability tests now expect `blocked:null` for genuine owner-wide
and WAL probes. A separate injected public capability probe still proves
`blocked_dependency` when the readSet maximum is actually insufficient. WAL
probes use a real WAL world. Harness `configure` now supplies the public `wal`
option whenever the cell registers WAL; the old harness omitted that opt-in.

Further real rehearsals exposed and fixed test-tool issues: status subprobes
were overwriting their deadline with `undefined`; backup verification still used
format-1 sidecar identity columns instead of format-2 storage/document/term IDs;
request and maintenance hosts shared one authority domain and interfered during
normal disposal. Maintenance now uses a distinct service-only trusted host;
request quarantine tests remain unchanged. Segment estimates now calculate the
selected segment rather than printing the whole profile for both invocations.

Every measured attempt now records its method and whether the actual read
exceeded 1,000 ms. An opening failure records null (no read); rejected reads
retain elapsed read time. State subprobes do the same. The summarizer reports
`adapterReadCutoffs` by cell/method with read, exceedance and no-read counts.
This observation is never a gate and never changes the 5,000-ms deadline.

## Product facts and sources

The registration's `productInputs` labels every supplied value:

| Input | Value | Source |
| --- | --- | --- |
| Exact run Node | v24.22.1 | production |
| Counter | o200k_base-v1; pinned libraries/ranks above; multiplier 1 | adapter |
| Measured request/read deadline | 5,000 ms; agreed with product | adapter request window |
| Separately reported per-read default | 1,000 ms; unvalidated; never gated | adapter |
| Hook | 3,000 ms; registration metadata only | proposed |
| Quantum | 128 items / 1,000 ms | adapter |
| Per-tick budget | 1,024 items / 8,000 ms | adapter |
| Poll / renewal / cron | 25 ms / 10,000 ms / 60,000 ms | adapter |
| Maintainer open | 5,000 ms | adapter |
| Reader open and state deadlines | 5,000 ms | engine default |
| Sidecar journal | each cell's frozen protocol choice | adapter setting mapped per protocol |
| Telemetry capacities and drain schedule | unchanged engine/harness defaults | engine default |
| Writer capture / review | 25,000 ms / 5,000 ms | production; supplied profile provenance |

No product-value placeholders remain. Host/volume identity and attestations,
reservation owner, actual dependency root, input-file locations and final commit
IDs remain operator inputs. The validation host/volume used here is explicitly
preparation-only, not a reserved qualification host. The primary must commit the
reviewed source first and fill a new registration against that frozen checkout.
No absolute operator paths or private product identities are committed.

## Rehearsal contract

`--profile engine --rehearse` requires Node v24.22.1 and the registration/writer
inputs. It runs the real request warmup/main/cold/initialized-reference paths,
O overflow, one W reader/baseline pair, four WM references, a shared F/A session,
B backup/restore/format-2 verification, and T post-catch-up status/candidates/
fetch/assembly. All ten W method profiles must actually be attempted. Earlier
exploratory rehearsals also exercised all absent/exhaustion/abort/crash manifests.

These are functional checks only: one sample per series, 5-second W members,
a 6-second F/A session, two probe lanes and one availability lane, one target per
type, 32 Memories/four Cards normally and four Memories/one Card in F/A.
The header explicitly records a **test-only** pump allowance (100,000 items /
60,000 ms, poll 250 ms; session quantum 1,024/1,000 ms) so short functional windows
can exercise maintenance beyond the product tick allowance. Qualification keeps
all registered product settings. The ordinary writer still uses its real
20-ms cadence and real capture/review operations. These shortened inputs grant
no claim about the product's minute budget, freshness, availability or latency.

Reports retain functional outcomes, identities, native-commit associations,
coverage and actual child exits, while stripping durations, timestamps, loops,
percentiles and gate decisions. The only successful mode result is
`inconclusive` with `functionalPassed:true`; it can never return `passed`.
Rehearsal registrations/checkpoints cannot be admitted to qualification or merge.
The unobserved-target F/A failure is retained even with the larger test allowance.

## Segment partition and planning estimates

The 728 cells are partitioned into **364 + 364**, without duplicates/omissions;
each segment owns six complete physical F/A sessions. The estimator counts each
session once and splits the existing 3,600-second failure allowance equally.

| Segment | Cells | Planning estimate |
| --- | ---: | ---: |
| segment-1 | 364 | 23,313.7 s = 6 h 28 m 33.7 s |
| segment-2 | 364 | 23,313.7 s = 6 h 28 m 33.7 s |
| Total | 728 | 46,627.4 s |

Both fit the 6 h 45 min planning limit. These are arithmetic allowances, not
measurements, deadlines or guaranteed completion times. The full registration
retains the protocol's 47,700-second reservation/observation ceiling.

## Exact preparation and run commands

**Do not execute either run command until the F/A blocker is resolved and a full
rehearsal succeeds.** No particular date or start time is reserved by this doc.
All preparation precedes the later supervised quiet windows.

From the frozen repository checkout, set `RUN_VOLUME` to a new owned directory
on the real run volume, `HOST_INPUT` to the primary's host JSON, and
`WRITER_PROFILE` to the supplied production writer-profile file. The host JSON
contains `host:{id,cpu,ramBytes,os,owner}`, `volume:{id,mount,filesystem,production}`,
`volumeRoot`, truthful `platformRole` and platform attestations, optional frozen
`profileCommit`/`protocolCommit`, and
`counterConfiguration:{dependencyRoot:OPERATOR_DEPENDENCY_ROOT}`. Its Node, counter,
deadlines or pump overrides must exactly match the frozen product facts.
`production-linux-ext4`, `wsl2-ext4` and `apfs` remain distinct roles.

```sh
. "$NVM_DIR/nvm.sh"
nvm use 24.22.1
test "$(node --version)" = v24.22.1

node evaluation/context-read-qualification/generate.mjs --volume-root "$RUN_VOLUME"
node evaluation/context-read-qualification/registration.mjs \
  --host "$HOST_INPUT" --writer-profile "$WRITER_PROFILE" \
  --out "$RUN_VOLUME/registration.engine.json"
node evaluation/context-read-qualification/registration.mjs \
  --validate "$RUN_VOLUME/registration.engine.json"
node tools/testing/measure-context-read-product.mjs --profile engine --rehearse \
  --registration "$RUN_VOLUME/registration.engine.json" \
  --writer-profile "$WRITER_PROFILE" --report "$RUN_VOLUME/rehearsal.jsonl"
rehearsal_rc=$?
test "$rehearsal_rc" -eq 1
node -e 'const f=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").trim().split("\n").at(-1)); if(f.status!=="inconclusive"||f.functionalPassed!==true||f.cleanup!==true||f.qualifying!==false||f.timingClaims!==false)process.exit(1)' "$RUN_VOLUME/rehearsal.jsonl"

node tools/testing/measure-context-read-product.mjs --profile engine --estimate \
  --registration "$RUN_VOLUME/registration.engine.json" --segment segment-1
node tools/testing/measure-context-read-product.mjs --profile engine --estimate \
  --registration "$RUN_VOLUME/registration.engine.json" --segment segment-2
```

Check each actual exit before continuing. A successful rehearsal intentionally
exits 1; the following JSON assertion must exit 0. A failed rehearsal's exit 1
alone must never be treated as success. Preparation refuses existing snapshots,
registrations and reports; use fresh destinations after a changed preparation.

In the first later supervised quiet window:

```sh
test "$(node --version)" = v24.22.1
node tools/testing/measure-context-read-product.mjs --profile engine \
  --segment segment-1 --registration "$RUN_VOLUME/registration.engine.json" \
  --writer-profile "$WRITER_PROFILE" --report "$RUN_VOLUME/segment-1.jsonl"
segment_1_rc=$?
node tools/testing/summarize-context-read-product.mjs "$RUN_VOLUME/segment-1.jsonl"
printf 'segment-1 actual exit: %s\n' "$segment_1_rc"
```

Preparation for the second later window reuses the **same** frozen source,
registration, snapshots, writer profile, dependency bytes, Node, host and volume:

```sh
. "$NVM_DIR/nvm.sh"
nvm use 24.22.1
test "$(node --version)" = v24.22.1
node evaluation/context-read-qualification/registration.mjs \
  --validate "$RUN_VOLUME/registration.engine.json"
node tools/testing/measure-context-read-product.mjs --profile engine --estimate \
  --registration "$RUN_VOLUME/registration.engine.json" --segment segment-2
node tools/testing/measure-context-read-product.mjs --profile engine \
  --segment segment-2 --resume "$RUN_VOLUME/segment-1.jsonl" \
  --registration "$RUN_VOLUME/registration.engine.json" \
  --writer-profile "$WRITER_PROFILE" --report "$RUN_VOLUME/segment-2.jsonl"
segment_2_rc=$?
node tools/testing/summarize-context-read-product.mjs "$RUN_VOLUME/segment-2.jsonl"
printf 'segment-2 actual exit: %s\n' "$segment_2_rc"
node tools/testing/measure-context-read-product.mjs --profile engine \
  --merge "$RUN_VOLUME/segment-1.jsonl" --merge "$RUN_VOLUME/segment-2.jsonl" \
  --report "$RUN_VOLUME/combined.jsonl"
```

A partial profile remains inconclusive. Preserve reports/journals even on failure;
resume/merge retains failures and only accepts complete cells. Use a dedicated
primary-owned session and actively observe progress, logs, child state and actual
exits. This preparation establishes no unattended monitor or notification service
and promises no continued supervision after handoff.

## Verification and actual exit codes

Every table entry is an actual child exit code. The seven harness suites ran
with `node --experimental-vm-modules --test PATH`; the functional suite, guards
and package tests ran with `node --test PATH`. Offline package tests set
`QUAL_COUNTER_ROOT` to the existing dependency root and `QUAL_VERIFY_VOLUME` to
the prepared snapshot directory. No dependency installation was used.

| Test command path | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | ---: | ---: | ---: |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 | 0 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/harness-fixes.test.mjs` | 0 | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/inputs.test.mjs` | 0 | 0 | 0 |

Both the first 36-command matrix (manifest case deferred) and the final
36-command matrix (all eight input cases, including all six sealed snapshots)
exited **0 for every command**. After tightening timeout handling, both package
test files were rerun on all three versions: **0 / 0 / 0** each. An extra full regression rerun exited **1 / 1 / 1** at the structural sidecar
fixture's 1,000-ms preparation budget (`build_failed`, `read_timeout`); the filter
assertions passed. That fixture now uses the supported 5,000-ms preparation
budget, with no performance assertion and no change to registered product
quanta. Its final full rerun exited **0 / 0 / 0**. The filter regression proves
that functional `items`/`operations` survive while timing fields are removed.

Other actual exits on Node v24.22.1:

| Check | Actual exit(s) |
| --- | --- |
| Original personal-row regression, before normalization | **1**, at the expected ref comparison |
| Selected capability/personal-row regressions during WAL wiring, then corrected | **1, 1, 0** |
| Full functional suite during development | **0** |
| Five-case registration/counter/real-read development subset | **0** |
| Raw-file guard while adding reviewed exact metadata sites, then corrected | **1, 1, 0** |
| Changed window module syntax check | **0** |
| Six-snapshot generation against frozen manifest | **0** |
| Registration filling, initial and final | **0, 0** |
| Filled registration validation, initial and final | **0, 0** |
| Segment-1 CLI estimate, initial and final | **0, 0** |
| Segment-2 CLI estimate, initial and final | **0, 0** |
| First rehearsal (module-cycle defect, subsequently fixed) | **13** |
| Exploratory rehearsals 2–6 | **1, 1, 1, 1, 1**; failed functional checks retained |
| Final and reviewed full rehearsals | **1, 1**; F/A fails, other kinds succeed; cleanup confirmed |

The counter's first direct loading check exited **1** for an incorrect CJS ranks
`.default` assumption; the corrected factory check exited **0**, followed by the
three-runtime exact-library tests above. No tokenizer substitution was made.
A first evidence-audit script exited **1** because its pattern mistook the
metadata name `timingClaims` for a timing field; after excluding that explicit
false flag the audit exited **0**. It checked six rehearsal cells, five functional
successes, one retained failure, non-qualifying metadata, cleanup, and no timing
observation keys in the report or numeric journal.

## Changed files, cross-checked two ways

The seven harness test paths were independently enumerated by filesystem glob
and `rg --files`; their sets agreed (**7 paths**). Changed paths were derived
from `git diff --name-only` plus Git's untracked inventory, then independently
re-derived by hashing all **2,461 HEAD blobs/modes** against disk and discovering
new files with `rg --files --hidden`. The sets agreed at **33 paths**; the
comparison exited **0**. The set contains **zero database files** and **zero
engine runtime files**. Operator-path/private-name scans and `git diff --check`
exited **0** with no findings. All started preparation, rehearsal and test processes have exited; no unattended work is handed off.

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `core/test/no-raw-db-fd.test.mjs`
- `docs/plans/context-read-qualification-inputs.md`
- `evaluation/context-read-qualification/adapter.mjs`
- `evaluation/context-read-qualification/corpus.mjs`
- `evaluation/context-read-qualification/counter.mjs`
- `evaluation/context-read-qualification/generate-child.mjs`
- `evaluation/context-read-qualification/generate.mjs`
- `evaluation/context-read-qualification/labels.json`
- `evaluation/context-read-qualification/manifest.json`
- `evaluation/context-read-qualification/queries.json`
- `evaluation/context-read-qualification/registration.engine.template.json`
- `evaluation/context-read-qualification/registration.mjs`
- `evaluation/context-read-qualification/schemas.mjs`
- `evaluation/context-read-qualification/test/harness-fixes.test.mjs`
- `evaluation/context-read-qualification/test/inputs.test.mjs`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/functional-check.mjs`
- `tools/testing/fixtures/context-product/rehearsal-checks.mjs`
- `tools/testing/fixtures/context-product/report.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/service-host.mjs`
- `tools/testing/fixtures/context-product/storage-child.mjs`
- `tools/testing/fixtures/context-product/v4-checkpoints.mjs`
- `tools/testing/fixtures/context-product/v4-plan.mjs`
- `tools/testing/fixtures/context-product/v4-rehearsal.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session-pump.mjs`
- `tools/testing/fixtures/context-product/v4-session-work.mjs`
- `tools/testing/fixtures/context-product/v4-state.mjs`
- `tools/testing/fixtures/context-product/v4-windows.mjs`
- `tools/testing/measure-context-read-product.mjs`
- `tools/testing/summarize-context-read-product.mjs`
