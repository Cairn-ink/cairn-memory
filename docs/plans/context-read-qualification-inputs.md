# Context-read qualification inputs: preparation handoff

**Round 3c:** the native Linux run is an explicitly authorized full-scale
**diagnostic**, using the unchanged revision-1 engine definition and the existing
364 + 364 segments back to back. A `native-linux-ext4` registration sets
`qualifying:false`, `diagnostic:true` and an explicit revision-mismatch reason,
even if every gate passes. It grants no qualification or production acceptance.

Qualification remains blocked pending the required qualifying evidence. Earlier
F/A engine failures are retained below as historical evidence. Local main was
integrated through Fix A and P2e; no engine runtime code was authored in this
round. The current rehearsal and verification results are in "Fix round 3c".
No long timing run was performed here. No network access or commit was made.

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
  All six snapshots were rebuilt and sealed on Node v24.15.0, then independently
  inspected against their seals on all three required runtimes.
- `labels.json`, `queries.json`: exact relevant identities, stable ranking,
  recall@5/@12 labels, empty control and the single-Han `中` versus `中文` miss.
  Launch selects personal plus three projects; overflow selects 32 of 33
  namespaces and reports the omission. Other-owner writes use a separate owner.
- `adapter.mjs`, `schemas.mjs`: closed DTOs for all ten method profiles, exact
  readSet/deadline and ordered evidence/revisions from canonical SQL inputs.
  Preparation reads supply opaque snapshots/fences only and must match the
  independent evidence oracle before admission. Contractual not-ready/busy error DTOs are validated without granting a
  successful sample; normal read timeouts/cancellation remain functional failures.
  Status includes the engine's actual absent/ready/stale/unavailable/building/
  catching_up states.
- `counter.mjs`: exactly `tiktoken` **1.0.22**, `tiktoken/lite` `Tiktoken`, with
  `js-tiktoken` **1.0.21** `o200k_base` ranks; `encode(text,[],[])`, no multiplier,
  ID **`o200k_base-v1`**. Both packages are available offline. The default dependency
  root is the local `evaluation/context-read-qualification/counter-deps/`,
  with its pinned package/lock files. `QUAL_COUNTER_ROOT` or the registration
  input `counterConfiguration.dependencyRoot` can select another root with the
  same exact versions. Missing/wrong packages fail explicitly. A fresh isolated
  child mechanically discovers the executed dependency closure; all eight files,
  including `lite/tiktoken_bg.cjs`, WASM, ranks and metadata, are registered for
  hashing. The executable module itself is pinned to this package’s `counter.mjs`.
- `registration.engine.template.json`, `registration.mjs`: frozen product facts,
  twelve F/A schedules, independent type/intent targets, state probes/deadlines,
  two complete segments, host filling and both harness validators. Product-fact
  overrides outside the explicit host allowlist and all unresolved substitutions
  (`PLACEHOLDER` or `${…}`) are rejected. A committed deterministic builder and
  exact-byte regeneration test prevent template drift. The writer file is
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
| Quantum | 32 items / 1,000 ms | adapter; reviewed, pending merge |
| Per-owner 60 s window budget | 2,048 items / 60,000 ms | adapter; reviewed, pending merge |
| Poll / renewal / in-process tick | 25 ms / 60,000 ms / 20,000 ms | adapter; reviewed, pending merge |
| Maintainer open | 5,000 ms | adapter |
| Reader open and state deadlines | 5,000 ms | engine default |
| Sidecar journal | each cell's frozen protocol choice | adapter setting mapped per protocol |
| Telemetry capacities and drain schedule | unchanged engine/harness defaults | engine default |
| Writer capture / review | 25,000 ms / 5,000 ms | production; supplied profile provenance |

No product-value placeholders remain. Host/volume identity and attestations,
reservation owner, optional dependency-root override, input-file locations and final commit
IDs remain operator inputs. The validation host/volume used here is explicitly
preparation-only, not a reserved qualification host. The primary must commit the
reviewed source first and fill a new registration against that frozen checkout.
No absolute operator paths or private product identities are committed.

## Rehearsal contract

`--profile engine --rehearse` requires Node v24.22.1 and the registration/writer
inputs. It runs the real request warmup/main/cold/initialized-reference paths,
O overflow, one W reader/baseline pair, four WM references, a shared F/A session,
B backup/restore/sidecar verification, and T post-catch-up status/candidates/
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

**Qualification requires a successful rehearsal and the required acceptance.**
The owner separately authorized the native revision-1 diagnostic despite the
historical F/A blocker: run segment-1, then segment-2 with its resume input, on
the same dedicated host/volume and frozen registration. This exception permits
only a diagnostic, never qualification. The operator schedules the quiet window;
the template does not prescribe a local start time.

From the frozen repository checkout, set `RUN_VOLUME` to a new owned directory
on the real run volume, `HOST_INPUT` to the primary's host JSON, and
`WRITER_PROFILE` to the supplied production writer-profile file. The host JSON
contains `host:{id,cpu,ramBytes,os,owner}`, `volume:{id,mount,filesystem,production}`,
`volumeRoot`, truthful `platformRole` and platform attestations, optional frozen
`profileCommit`/`protocolCommit`, and
`counterConfiguration:{dependencyRoot:OPERATOR_DEPENDENCY_ROOT}` only when an
override is needed. The local pinned dependency root is the default. Node, counter,
deadline, pump and other frozen product-fact keys are forbidden in host overrides,
even when their values equal the template.
`production-linux-ext4`, `wsl2-ext4`, `apfs` and `native-linux-ext4` remain distinct
roles. For the authorized diagnostic, fill `native-linux-ext4`, an ext4 volume,
`volume.production:false`, and the exact Node patch. Native runtime/volume
eligibility is checked independently; the internal production flag remains false.
The native role is rejected for production and legacy-only profiles.

```sh
. "$NVM_DIR/nvm.sh"
nvm use 24.22.1
test "$(node --version)" = v24.22.1
npm ci --prefix evaluation/context-read-qualification/counter-deps --offline --ignore-scripts
npm run test:qualification-inputs:full

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
node -e 'const fs=require("node:fs"),reg=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=fs.readFileSync(process.argv[2],"utf8").trim().split("\n").map(JSON.parse),f=rows.at(-1),cells=rows.filter(r=>r.type==="cell"),bad=cells.filter(r=>r.decision.functionalPassed!==true); const knownFA=reg.platformRole==="native-linux-ext4"&&f.status==="failed"&&bad.length===1&&bad[0].cell.kind==="F/A session"&&bad[0].decision.errors.length>0&&bad[0].decision.errors.every(e=>e.startsWith("unobserved_target:")); if(cells.length!==6||f.cleanup!==true||f.qualifying!==false||f.timingClaims!==false||(!(f.status==="inconclusive"&&f.functionalPassed===true)&&!knownFA))process.exit(1); console.log(JSON.stringify({rehearsalStatus:f.status,functionalPassed:f.functionalPassed,knownFAAllowedForDiagnosticOnly:knownFA}));' "$RUN_VOLUME/registration.engine.json" "$RUN_VOLUME/rehearsal.jsonl"

node tools/testing/measure-context-read-product.mjs --profile engine --estimate \
  --registration "$RUN_VOLUME/registration.engine.json" --segment segment-1
node tools/testing/measure-context-read-product.mjs --profile engine --estimate \
  --registration "$RUN_VOLUME/registration.engine.json" --segment segment-2
```

Check each actual exit before continuing. A successful rehearsal intentionally
exits 1; the following JSON assertion must exit 0. For qualification it still
requires `inconclusive` with `functionalPassed:true`. Only the owner-authorized
native diagnostic may proceed with the known F/A `unobserved_target` errors,
confirmed cleanup and all other cell kinds successful. The assertion prints that
exception explicitly; it never changes the failed rehearsal status or grants a
qualification pass. A failed rehearsal's exit 1 alone is never success. Preparation refuses existing snapshots,
registrations and reports; use fresh destinations after a changed preparation.

For the first half of the authorized, actively supervised native diagnostic:

```sh
test "$(node --version)" = v24.22.1
node tools/testing/measure-context-read-product.mjs --profile engine \
  --segment segment-1 --registration "$RUN_VOLUME/registration.engine.json" \
  --writer-profile "$WRITER_PROFILE" --report "$RUN_VOLUME/segment-1.jsonl"
segment_1_rc=$?
node tools/testing/summarize-context-read-product.mjs "$RUN_VOLUME/segment-1.jsonl"
printf 'segment-1 actual exit: %s\n' "$segment_1_rc"
```

Run the second half immediately after the first report closes, using the
**same** frozen source, registration, snapshots, writer profile, dependency bytes,
Node, host and volume. Check the first report's `segmentComplete`, cleanup and
diagnostic flags before proceeding; an interrupted report needs an explicit
continuation decision. A completed first segment can normally exit 1 because
the other 364 cells are still absent. Preserve an observed failure if present:
resuming does not clear it.

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

For native revision 1, the segment headers, final rows and merged result retain
`qualifying:false`, `diagnostic:true` and the reason. Per-cell/per-gate decisions
remain visible and use the exact registered Node patch; a diagnostic `passed`
never constitutes qualification. WSL2/APFS engine and production behavior are
unchanged. A partial profile remains inconclusive unless it retains failure.
Preserve reports/journals even on failure;
resume/merge retains failures and only accepts complete cells. Use a dedicated
primary-owned session and actively observe progress, logs, child state and actual
exits. This preparation establishes no unattended monitor or notification service
and promises no continued supervision after handoff.

## Previous preparation verification (before 94edae6c)

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

## Fix round 1

Changes below are relative to `94edae6c`. Both non-author reviews were read in
full. `test/q1.test.mjs` contains seventeen original regressions for the twelve deduplicated
items, plus two CI coverage regressions added in the reduced-CI follow-up. Each numbered item has an observed red exit **1** against its pre-fix
behavior and a green exit **0** after the fix. No existing harness test was edited.
The pump regressions cover both qualification and rehearsal wrappers; lane/writer
exit regressions exercise both modes.

| Item | Fix | Regression; actual red → green |
| --- | --- | --- |
| 1 | Both pump wrappers record and latch completions through close, sample final status after close, retain close/rejected-completion failures, and export the journal even if supervisor close rejects before rethrowing. Close does not wait forever for an unrelated unresolved completion promise. Missing final status is a v4 failure. | `Q1-01`: failure during close, final failure after an earlier stopped completion, rejected close/completion and supervisor-close rejection; **1 → 0** |
| 2 | A nonzero/signalled lane exit or writer exit fails independently of cadence, scheduling and read results. Lane exit evidence survives teardown. | Both `Q1-02` cases: a result followed by exit 1, and writer exit 1, in both modes; **1 → 0** each |
| 3 | Functional reads require expected outcomes and fully successful initialization. WM requires a successful read and cannot count `index_unavailable`; the explicitly allowed unavailable path still requires `expected:true`. | `Q1-03`: failed initialization and unexpected unavailable rejected; **1 → 0** |
| 4 | SQL-only inspection produces canonical evidence with explicit DTO fields. Requested refs determine order; canonical rows determine bodies/revisions/provenance. Preparation fetches only provide opaque snapshot/fence material and are checked against that oracle. | `Q1-04`: even a self-consistent preparation read with reversed order, wrong body, wrong revision or an extra field is rejected; **1 → 0**. Real-reader negatives also cover all four mutations. |
| 5 | Host overrides have an explicit allowlist; frozen fields and executable-module overrides are rejected. Validation and execution load the pinned registered counter; the harness configuration boundary independently rejects a substituted module for its frozen ID. A SQLite-free child observes actual module loads/file reads to discover the complete executed dependency closure. | Both `Q1-05` cases: forbidden overrides/module substitution, and an independent actual-load/read trace requiring every executed asset to be hashed, including CJS glue and WASM; **1 → 0** each. Direct execution-boundary substitution also exits **1 → 0** |
| 6 | Filled validation rejects `${…}` anywhere as well as `PLACEHOLDER`. The positive validator test now actually substitutes both template roots. | `Q1-06`: unresolved volume/package substitutions rejected; **1 → 0** |
| 7 | Frozen zh, ja and mixed large Memory/Card text is selected by fetch/evidence and assembly rotations. Canonical stored text drives labels; independent BM25 arithmetic supplies rankings. All six manifests/seals were regenerated deterministically. | `Q1-07`: exact-limit recipes and original tiny F/A query preservation **1 → 0** each, plus real full/compact/snapshot fetches, both assembly budgets, closed-schema negatives and response-byte checks **0**. All-six seal/identity/bounds checks pass on all three runtimes. |
| 8 | Sidecar verification checks foreign keys and explicitly left-joins every posting against its document/statistics; absent/empty terms are rejected before manifest reconstruction. SQLite/byte-IO process separation is unchanged. | `Q1-08`: a real sidecar corrupted in a separate SQLite child, with missing document+term, missing statistics and empty term. Committed old verifier accepts the orphan (**1**, missing expected rejection); fixed verifier rejects it (**0**). |
| 9 | Each session attempt carries its own cell/method/intent population identities. Shared type probes name each actual population. The summarizer counts exceedances separately per identity; unmatched qualification identities fail session validation. | Both `Q1-09` cases: counts attributed to the actual A/F cells, including both target types and intents; summary regression **1 → 0**, identity mapping **0** |
| 10 | Generation owns an exclusive staging directory; after the generator exits, the existing SQLite-free exclusive-copy child publishes the destination. A racing destination is never adopted or overwritten. | `Q1-10`: inject a real concurrently created destination between admission and child generation; **1 → 0** |
| 11 | `build-template.mjs` rebuilds the template deterministically from committed constants, corpus fixtures and the v4 plan. | `Q1-11`: regenerate and compare exact bytes; missing builder **1**, implemented builder **0** |
| 12 | Default pinned local counter dependency root, package script and CI install/run steps in the existing workspace-lifecycle job. Pre-supplied package/lock bytes remain unchanged. | `Q1-12`: CI/script wiring and default counter loading **1 → 0**. Offline dependency installation exit **0**. |

The large cases use the actual admitted field limits: Memory content **4,000
UTF-16 units** (`core/validation.mjs`), Card title **200** and body **20,000 UTF-16
units** (`core/private-card-input.mjs`). Each language has an exact-bound case.
These are field-length limits, not invented UTF-8 limits. Contract §4.2/§5 and
C-1/C-2 additionally bound public response DTOs to **65,536 UTF-8 bytes**, IPC
frames to **262,144 bytes**, and snapshot tokens to **16,384 characters**.
The large Card titles and bodies retain their separately frozen language-bearing
leads; titles use literal padding and bodies use space padding; the Memory bodies retain their language-bearing lead and literal
padding. This keeps them admitted and token-metered under both assembly budgets.
Tests require both large item types to be selected, and check all six populations’
full response envelopes with conservative snapshot sizes. Card metadata is now
explicitly registered in the closed assembly schema; unknown metadata still
fails. The empty and single-Han controls remain frozen.

The `counter-deps/package.json` and `package-lock.json` supplied by the primary
were neither edited nor replaced. Their before/after SHA-256 comparison exits
**0**. Installation uses the offline cache and `--ignore-scripts`; it does not
require another checkout. `core/test/no-raw-db-fd.test.mjs` remains byte-identical
to HEAD. Its allowlist changes enumerate exact metadata/code-resolution sites;
no database-byte access was permitted in a process holding connections.

### Round-1 actual test exits

These records precede the reduced-CI follow-up. Current mode flags and package
script results are documented in “Full rebuild, CI and registration” below.

Commands used the requested exact nvm Node binaries. Each row represents an
actual process exit, never the last stage of a pipe. `q1.test.mjs` and the harness
suites use `--experimental-vm-modules --test`; the other input tests use `--test`.
`QUAL_COUNTER_ROOT` was unset to exercise the local default. The all-six manifest
test used `QUAL_VERIFY_VOLUME` to inspect the six freshly rebuilt snapshots on
each runtime; ordinary deterministic tiny regeneration still ran on each.

| Test file | 22.16.0 | 24.15.0 | 24.22.1 |
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
| `evaluation/context-read-qualification/test/inputs.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q1.test.mjs` | 0 | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 | 0 |

The first matrix observed `fix2` exits **1 / 1 / 0**, `v4fix1` exits
**1 / 1 / 0**, and `v4fix4` exits **1 / 0 / 0**; every other matrix command
exited **0 / 0 / 0**. The Node 24.15 pre-fix v4fix1 child was explicitly stopped
when its obsolete unresolved-completion double stalled; its supervising Node
test runner returned actual **1**. Corrections preserved final failure checks,
avoided waiting beyond close on that unresolved promise, retained cancellation
errors, and failed unmapped population identities at final validation. The three
affected harness suites were then rerun individually: **0 / 0 / 0** each.
The final rejected-completion regression and both guards were rerun on all three
versions: **0 / 0 / 0** each. After the Card-title and execution-boundary additions,
the complete thirteen-file matrix was rerun on all three versions; every actual
exit is **0**, as listed above. No tests belonging to another session were changed.

Development test exits are retained as well: the original `Q1-01/02/03` group
**1**, corrected **0**; an early shutdown trial with an unresolved completion was
explicitly stopped and its test runner returned **1** (cancellation), then the
corrected trial returned **0**; `Q1-05/06/10/11/12` group **1**, corrected **0**;
`Q1-04` VM setup trial **1**, valid red **1**, green **0**; large-recipe red
**1**, green **0**; the additional actual-language Card-title assertion red **1**,
then green **0** with real fetch/assembly; real large-read development trials **1 / 1 / 1 / 1 / 0**
(counter null configuration, canonical Card origin projection, then missing
closed Card metadata were corrected). Tiny all-profile development trial **1**
(undefined counter-root field), corrected **0**. The initial orphan/attribution
group exited **1** because attribution failed, then **0**; it is not the orphan
red proof. Orphan development trials **0** (insufficient corruption), **1**
(preparation timeout, not proof), then the valid committed-source counterfactual
**1** and fixed verifier **0**. Writer-exit red **1**, green **0**. Full sixteen
regressions exited **0**, including the final shutdown-focused development run
**0**. The extra supervisor-close rejection regression exited **1** before its journal
flush fix; the regression plus affected shutdown harness cases then exited
**0 / 0 / 0**. Direct execution-boundary counter substitution exited **1 → 0**.
The final-title full Q1 file exited **0 / 0 / 0**. The additional F/A query
preservation regression exited **1 → 0**. Large-world assembly queries include
language-bearing terms alongside their unique frozen probe; small F/A worlds
retain the exact original language queries. The follow-up five-file package/guard
process initially exited **1 / 0 / 0**, with Node 22 failing at its test-only
1,000-ms initialization budget. That ordinary functional setup now uses the
supported 5,000-ms bound; registered pump settings and all read assertions are
unchanged. The corrected Node 22 rerun exited **0**. The final package/guard
processes therefore exit **0 / 0 / 0**, with all 50 reported tests passing
on each runtime, including all seventeen Q1 regressions. A guard refresh check exited **0**. Invalid setup/timeout trials are never
claimed as red proofs of the findings.

### Full rebuild, CI and registration

The final plain full six-snapshot authoring run on Node **24.15.0** exited **0**
and took **543.659060 seconds**. The earlier completed body-case revision also
exited **0**, taking **477.677657 seconds**; the final run includes the additional
language-bearing Card titles. This was an observed preparation cost, with no test
threshold or timing gate. Its six outputs were checked against the new seals on
all three runtimes. The first generation attempt exited **1** (catalog extraction
used a non-existent Memory property; corrected to canonical SQL). An obsolete
intermediate generation was explicitly stopped at child exit **-15** when the
final independent assembly-query inputs changed; it produced no accepted seals.
Only the completed final generation supplies the committed seals.

CI now runs the explicit **reduced** mode through
`npm run test:qualification-inputs` in the existing `live-evidence-offline` job, after
installing pinned counter-deps. This builds **m1112-v18 and m1112-v23**, each
with 1,112 Memories (zero/111 Cards), **twice**. Both generations must match their
frozen content/schema seals and each other’s canonical catalogs and database
byte hashes. These two smallest layouts are fixed selections, independent of
observed speed. The other four physical rebuilds are explicitly reported as
**skipped by design** in the test output; their manifest entries and canonical
label/ref invariants remain checked.

Both modes run every regression in `q1.test.mjs`, `harness-fixes.test.mjs` and
`inputs.test.mjs`, including all three tiny-layout determinism checks, all six
manifest entries, all six canonical label/ref catalogs, all real-read/closed-shape
checks and the exact-byte template regeneration test. The all-six catalog checks
validate fixture identities/counts/layouts, seal syntax, canonical source text,
namespace/ref shape and revisions, frozen query rankings, known misses and
recall labels. Negative regressions corrupt entries in a layout excluded from
the reduced physical rebuilds and must still be rejected.

**`npm run test:qualification-inputs:full` is mandatory for primary acceptance
and before every qualification preparation.** It freshly rebuilds and verifies
all six layouts, including their canonical SQLite inventories and response-bound
checks. It also repeats the two smallest full layouts for determinism. The
preparation command block above includes this script before generating the
actual run-volume snapshots.

The package scripts explicitly set `QUAL_INPUT_MODE=reduced` and
`QUAL_INPUT_MODE=full`, respectively; either assignment overrides an inherited
value. Direct input-test invocations require one of those exact values and
reject missing/unknown modes. Full mode never selects fewer than six layouts.
Neither mode reuses an existing snapshot directory; the former
`QUAL_VERIFY_VOLUME` inspection shortcut cannot bypass any rebuild. No ordinary
test asserts a duration or uses the measured script wall time as a gate.

The reduced script’s one plain wall-time observation on Node **24.15.0** was
**192.357573 seconds (3 minutes 12.36 seconds)**, with actual exit **0**.
This is an observation, never a gate or a promised CI duration.

| Package script | Node | Actual exit | Reported tests |
| --- | --- | ---: | --- |
| `test:qualification-inputs` | 22.16.0 | 0 | 33 pass; four physical layouts skipped by design |
| `test:qualification-inputs` | 24.15.0 | 0 | 33 pass; four physical layouts skipped by design |
| `test:qualification-inputs` | 24.22.1 | 0 | 33 pass; four physical layouts skipped by design |
| `test:qualification-inputs:full` | 24.15.0 | 0 | 37 pass; zero skips |

The full script was run once on Node 24.15.0. Its output confirms six distinct
full-size layouts were freshly generated: two generations each for m1112-v18
and m1112-v23, and one each for the remaining four. All eight generated databases
passed their seals and required determinism checks; the extra generations do
not replace any of the six layouts. All 19 Q1 regressions, the four harness-fix
regressions, and all 14 input tests are discovered in both modes (only the four
explicit reduced-mode physical rebuild cases are skipped).

The mode/wiring and skipped-layout-invariant regressions exited **1** before
implementation and **0** after. Actual input-test entry points reject both an
unknown mode and a missing mode with exit **1** (expected). The raw-file and
SQLite-lock guards ran on **22.16.0 / 24.15.0 / 24.22.1**, each combined process
exiting **0 / 0 / 0**. The requested script runs deliberately inherit the opposite
mode and a nonexistent `QUAL_VERIFY_VOLUME`: the explicit package assignments
and fresh generation must prevail. Full acceptance is never satisfied by an
existing-volume inspection or a reduced-mode result.

Filled registration, explicit validation, segment-1 estimate and segment-2
estimate each exited **0** on Node 24.22.1, both before and after the final seal
rebuild. The final filled registration points to six existing sealed snapshots. Both segments still estimate
**364 cells / 23,313.7 seconds**, with six shared sessions each. Host identity,
production-volume attestations, reservation owner, final commit IDs and optional
dependency-root override remain operator inputs. Product values are filled.
The preparation registration is not a reservation or production-host attestation.

### Final round-1 rehearsal and retained trial

The initial full rehearsal trial exited **1** on Node **v24.22.1**, retaining
four unobserved F/A targets and a T preparation timeout. An input audit then
found that the large-body assembly query was also being selected for the tiny
F/A world. The adapter now selects that query only when large bodies are present.
Its protection regression exits **1 → 0**; a separate comparison proves the
four F/A seed Memories, seed Card and original language query definitions match
`94edae6c` exactly. The rehearsal and writer configuration files are also
byte-identical to that commit. No slower writer, pump restart or relaxed target
was introduced.

After the final checks finished, the full `--rehearse` command was run once on
the corrected inputs, on Node **v24.22.1**, with no other package test or generation
process running. Its actual exit was **1**. Final flags were:

```json
{"status":"failed","functionalPassed":false,"cleanup":true,"qualifying":false,"timingClaims":false}
```

Requests, O, W/WM, B and **all four T subprobes** returned functional success.
F/A retained all four errors: `unobserved_target:tiny-memory:current`,
`unobserved_target:tiny-memory:history`, `unobserved_target:tiny-card:current`
and `unobserved_target:tiny-card:history`. Qualification remains blocked by the
engine’s unobserved-target defect. The final report contains 199 journal records;
the initial trial’s separate report and 185 records remain intact.

The earlier **T preparation timeout** is retained as a real observed failure:
maintenance current quanta 0–7 returned rebuilding and quantum 8 completed;
history quanta 0–2 returned rebuilding and quantum 3 returned `read_timeout`.
The catch-up writer had already completed its real capture/review and exited 0.
The error occurred in `tools/testing/fixtures/context-product/series.mjs:24`
before any state subprobe was admitted. `core/context-product-reader.mjs:174`
uses the refresh budget’s `maxMs` as the operation deadline; that preparation
used the registered **1,000-ms** quantum. This evidence does not establish why
the engine missed that deadline. The final rehearsal’s registered preparation
quantum is unchanged; its four successful T probes do not erase or reinterpret
the earlier failure. Neither report records qualifying timing claims.

All started round-1 generation, rehearsal and test processes have exited.
There is no unattended task or promised background monitor.

## Fix round 2

The full spec re-review was read. These changes address its three findings
against `62d6e871`; the standards-approved inputs, registration, counter, CI
selection and F/A configuration are unchanged. The new `test/q2.test.mjs` is
included automatically by both existing qualification test scripts.

| Finding | Fix | Regression and baseline result |
| --- | --- | --- |
| 1 — durable pump/lane failures lost on replay | `journal-failures.mjs` is the SQLite-free failure classifier shared by the main and delegated journal writers and checkpoint replay. Both writers stamp a durable row-level failure bit; the delegated writer classifies before its rehearsal filtering. Replay also classifies legacy records without that bit. Failed pump states (including nested renewal status), renewal/close exceptions, unsuccessful maintenance initialization statuses, writer/sampler errors, nonzero or signaled lane/writer/child/locker/sampler exits, failed verdicts and the existing failure/supervision/capability records are retained. Existing contextual latency, overlap, percentile, freshness and registered T checks remain in force. Both pump wrappers now record renewal exceptions as failed completions. Cleanup journals lane exits once even on exceptional paths. | Two `Q2-01 durable …` tests use the actual **728-cell** engine inventory and both registered segment partitions. Each interrupts immediately after a durable pump/lane record, replays both marked and pre-marker records, then merges successful retries of all 728 cells: `knownFailure:true`, `complete:true`, `decision:"failed"`. Both writers, including rehearsal filtering, are covered. Two further `Q2-01` regressions cover the complete failure vocabulary (including the pre-throw maintenance status and explicit sampler failure), healthy/expected-error controls and actual renewal callbacks in both pump wrappers. Baseline exits **1** for each of the two primary record-kind tests. |
| 2 — Card oracle shares engine DTO construction | The oracle no longer imports or calls `createPrivateCardStorage` or `cardDetailInside`. It projects support, applicability review, canonical note/receipt source refs, bindings, attribution and empty trigger refs from SQL and fixed field lists. Source availability and content identities are checked independently. Raw bindings/current-dependency recipes are absent from this frozen corpus and are explicitly refused if introduced without an independent projection. Fetch preparation and its closed schema continue to use this independent evidence. | `Q2-02` injects `support.unregistered:true` into the formerly shared helper, uses that defective helper in the real engine evidence-storage path, and requires preparation to reject it. Correct authored-note and retained-receipt Card DTOs match independently; added support/binding/source fields and trigger refs fail validation. Baseline exit **1** (missing expected rejection). |
| 3 — initialization failure invents a measured read | Measured timestamps and the per-read cutoff result are produced only inside the branch that executes the measured call. Failed initialization retains null timestamps and a null cutoff result; its initialized error and failed expectation remain visible. The existing summarizer counts it as `noRead`. | `Q2-03` proves only the initialization call ran, asserts null measured timestamps/cutoff, and passes the real record to the summarizer: `reads:0`, `noRead:1`, `exceeded1000Ms:0`. A successful initialization still executes and accounts for a measured read. Baseline exit **1** (non-null measured-read start). |

The final six-test regression file was also copied into an exclusively owned,
detached `62d6e871` worktree and run on Node v24.15.0: **exit 1**, **six expected
assertion failures**. Both creation and removal of that temporary worktree exited
**0**. No runtime files in the baseline were changed. Individual primary-case
baseline processes exited **1 / 1 / 1 / 1** (pump, lane, Card, initialization).

### Round-2 verification

Each table entry is **initial / final actual process exit code**, captured directly from
`subprocess.run`, with the matching nvm Node binary and `PATH`. File commands
used `node --experimental-vm-modules --test PATH`; the package command used
`npm run test:qualification-inputs`. Counter resolution used the default pinned
root, with no counter/volume reuse override and npm offline mode enabled.

| Command / test file | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | --- | --- | --- |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `evaluation/context-read-qualification/test/q2.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 0 | 0 / 0 | 0 / 0 |
| `npm run test:qualification-inputs` | 0 / 0 | 0 / 0 | 0 / 0 |

The initial **36-command** matrix exited **0** throughout. The final **36-command**
matrix repeated every command after the maintenance/sampler failure audit,
again **0** throughout. All nine changed source modules stayed byte-identical
through that final matrix (SHA-256 comparison **0**).

All three reduced scripts report **43 tests, 39 passed, four skipped by design,
zero failed**. Both smallest layouts and their deterministic repeats pass; all
six catalogs/labels/refs and the template bytes are checked. All six Q2 tests
pass on all three Nodes, giving **1 → 0** for each primary regression and the
complete baseline file. Node 22's final strengthened standalone Q2 run was also
repeated after the legacy-record assertions were added: **exit 0**, six passed.
No ordinary test adds a timing gate.

The reduced/full selection, six-manifest checks, mandatory full acceptance and
preparation run, and exact preparation/segment commands in “Full rebuild, CI
and registration” remain unchanged.

`npm run test:qualification-inputs:full` ran **once** on Node **24.15.0** and
exited **0**: **43 passed, zero skipped, zero failed**. Generation-start records
independently confirm all six full-size layouts, plus a second v18/1,112 and
v23/1,112 build for determinism; content/schema seals, canonical inventories and
repeat file hashes agree with the frozen inputs.

Development process exits (Node 24.15.0) are retained separately: the first
four-case red run **1** included a JSON-loader test-fixture error; the corrected
Card negative probe exited **1** for the expected missing rejection. The first
four fixed cases exited **0**; the combined Q1/Q2/guards development run **0**;
the added real receipt-Card positive probe **0**. The renewal mock's first trial
exited **1** because its VM lacked `process`; after correcting that fixture,
**0**. The final maintenance/sampler failure-vocabulary audit was **1 → 0**.
The whole six-case baseline was run twice while extending the regressions:
**1 / 1**, each with six expected assertion failures; the last copy's SHA-256
matches the final regression file. Four individual primary
baseline processes were **1 / 1 / 1 / 1**. Every temporary baseline worktree
creation/removal exited **0**. These intentional red/development exits are not
qualification results.

### Round-2 rehearsal and remaining blocker

After the final matrix, the full `--profile engine --rehearse` path ran **once**
on Node **v24.22.1** with a fresh operator-filled registration and the supplied
writer-profile input. Registration fill and validation each exited **0**. The
rehearsal command exited **1**, with **229 real journal records** and final flags:

```json
{"status":"failed","functionalPassed":false,"cleanup":true,"qualifying":false,"timingClaims":false}
```

Requests, overflow/O, exposure/W plus WM, backup/B and all four post-catch-up T
subprobes passed their functional checks. F/A alone failed with exactly these
four errors:

- `unobserved_target:tiny-memory:current`
- `unobserved_target:tiny-memory:history`
- `unobserved_target:tiny-card:current`
- `unobserved_target:tiny-card:history`

The delegated journal durably marks `session-validation` as `failure:true`.
No target was fabricated or dropped. The F/A rehearsal and writer files match
`62d6e871` byte for byte: no slower writer, pump restart or relaxed target. This
remains the engine-owner blocker; neither long qualification segment was run.
All started generation, baseline, matrix and rehearsal processes have exited.

## Fix round 3

Both fresh review reports were read in full. The Card oracle, no-read accounting
and exactly-once lane-exit implementation are unchanged from `4baefc3b`.
No F/A settings, writer cadence, pump restart policy or target requirements change.

| Finding | Fix | Regression |
| --- | --- | --- |
| 1 — pump exceptions bypass the real coordinator and runner journal paths | Reports now create an independent `.failures.jsonl` journal, bound to the registration header hash. Only the SQLite-free IO child creates/appends/fsyncs it. This owner is independent of the session child's main-journal lease. Before propagating the retained-workspace error, the real coordinator automatically exports buffered pump records and its own failure through this channel. The runner cleanup-error branch writes a separate durable failure too. `pumpClosed` is not fabricated, the lease is not reclaimed, workspaces remain retained and the report still interrupts. New main headers require the matching failure journal; missing/corrupt ownership evidence refuses replay. Rehearsal forwards the same failure sink without changing its settings. | Four `Q3-01 real caller and runner …` cases inject renewal and close exceptions into the real pump wrapper, coordinator and runner in both modes. They never call `driver.report()` by hand. The resulting interrupted reports retain pump, coordinator and runner records; replay plus successful retries across the real 728-cell inventory yields `complete:true, decision:"failed"`. Additional tests check missing-journal refusal and preservation of cleanup guards on journal IO errors. |
| 2 — failures disappear across another interrupted resume | Every resume includes the inherited aggregate failure, complete cells, keys and decisions in its first durable registration frame, including zero-cell failures. A later `resumed-checkpoints` record mirrors it. Replay imports inherited cells idempotently, latches failure and still rejects duplicate new cell evidence. No ancestor report is needed after that durable copy. | Four `Q3-02` cases cover zero/one inherited complete cells and interruption immediately after header creation/before idle preparation. A failed A is resumed into interrupted B, then C, then D. Every link retains failure and complete cells; merging successful retries covers exactly 728 cells and stays failed. A separate case proves inherited mirrors are idempotent while duplicate new cells still refuse merge. |
| 3 — malformed or unknown records default to healthy | The shared classifier has explicit healthy shapes for all **62** registered series, including dynamic method profiles and writer labels. Unknown series/kinds, missing or malformed status/exit fields and explicit failure-only series fail closed. Replay classifies before percentile/freshness dereferences, including legacy rows without a failure marker. Completed-cell verdicts use the same status classifier. Registered retryable timeouts, availability controls and fence-change rebuilding/progress remain nonfailures. | `Q3-03` covers healthy and malformed records for every series, unknown nested statuses/exits, timeout/availability/progress controls, independent source-site discovery (**43 literal writer series**), replay of null payloads in every series and malformed completed-cell verdicts. A real tiny functional report is also checked for false failure markers. |

### Round-3 verification and fixture constraint

**Historical round-3 verification:** at that point the older harness suite still
needed four fixture/assertion updates, pending explicit permission under the
standing rule against editing another session's tests or fixtures. Round 3b below
records the subsequent owner approval and application. No classifier check was
relaxed to accept malformed controls.

Three exclusively owned detached `4baefc3b` baseline worktrees were created and
removed while expanding the regressions: **creation 0 / 0 / 0**, **removal
0 / 0 / 0**. Each pass ran the three primary regression groups separately on
Node 24.15.0: **1 / 1 / 1** each time. The final pass copied the exact final
`q3.test.mjs` (SHA-256 verified): four real-caller/runner cases, four resume cases,
and the missing-status/exit case all fail meaningfully on the committed code.
The fixed file passes **73 checks** on each required Node.

The initial resume-record solution also had a header-to-record interruption gap.
Two added after-header cases exposed it (**exit 1**). Moving inherited state into
the first durable registration frame and making the mirror idempotent fixed it:
the four resume cases plus the duplicate-new-cell guard exited **0** together.

Each table value below is an **actual final process exit code**. File commands
were `node --experimental-vm-modules --test PATH`, using the corresponding nvm
binary and PATH. npm runs used the offline environment, default local counter
root and no snapshot reuse override.

| Command / test file | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | --- | --- | --- |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 1 | 1 | 1 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 | 0 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q2.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q3.test.mjs` | 0 | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 | 0 |
| `npm run test:qualification-inputs` | 0 | 0 | 0 |

The red suite has exactly the same four assertion failures on every Node:

- `tools/testing/measure-context-read-product-v4fix1.test.mjs:118` expects zero
  inherited complete cells; the new contract correctly retains 727 and reruns
  only the incomplete T cell.
- Line 180 uses `blocked:true`; real capability probes use a dependency list.
- Line 251 supplies a failed read without an error code; the prepared patch uses
  the registered `read_timeout` outcome without changing any percentile checks.
- Line 268 supplies freshness targets without identity/revision; the prepared
  patch adds those fields and preserves both the 100- and 99-target assertions.

`git apply --check` for the prepared four-change patch exits **0**. The file
itself still matches `4baefc3b` byte for byte; no forbidden test edits were made.

All three **final reduced runs** exited **0**: **116 checks, 112 passed, four
intentional layout skips, zero failed**. The earlier Node-22 reduced trial exited
**1** because a real v23 fixture-preparation maintenance call returned
`read_timeout`. An unchanged focused v23 repeat exited **0**; the final whole
Node-22 repeat above also exited **0**. The 5,000-ms functional setup bounds and
all assertions are unchanged. That initial failure is retained, not erased.
The other initial matrix commands exited **0**.

`npm run test:qualification-inputs:full` on Node **24.15.0** exited **0** for the
final code: **116 passed, zero skipped, zero failed**. An earlier development
full run, before the extra header-boundary cases, also exited **0** (**113
passed**). The final-code full run rebuilt all six physical layouts and the two
small-layout determinism repeats; all frozen seals, catalogs and template bytes
matched. No timing gate or timing claim was added.

Other development process exits are retained: original seven-case red file
**1**; coordinator/runner durability group **0**; initial seven fixed cases **0**;
classifier registry/control group **0**; combined Q3/v4fix4/v4fix1 run **1** (only
the four old-fixture conflicts); expanded Q3 file **0**; real tiny functional
classifier test **0**. The first raw-file guard run exited **1** for the new IO
child sites; updating only their exact, justified allowlist entries made it
**0**. The guard test source itself remains unchanged. Subsequent guard exits
on every Node are the zeros in the table.

### Round-3 rehearsal, classifier audit and remaining work

Registration fill and validation on Node **v24.22.1** each exited **0**. After
final-code verification, the full `--profile engine --rehearse` command ran
**once** on that exact Node and exited **1**, with **197 real journal records**:

```json
{"status":"failed","functionalPassed":false,"cleanup":true,"qualifying":false,"timingClaims":false}
```

Requests, overflow/O, exposure/W plus WM, backup/B and all four post-catch-up T
subprobes passed. F/A alone retained the four expected engine failures:

- `unobserved_target:tiny-memory:current`
- `unobserved_target:tiny-memory:history`
- `unobserved_target:tiny-card:current`
- `unobserved_target:tiny-card:history`

The strict classifier was independently applied to every main/failure journal
record: audit **0**, **zero non-F/A failures**. Only F/A's `session-validation`
and `pump-drain` records classify as failures. No new non-F/A functional failure
was introduced. No records, observations or first-eligible targets were fabricated
or dropped. F/A settings match the baseline exactly.

Report archives/resumes must keep `.records.jsonl`, `.failures.jsonl` and
`.header.json` beside the completed report or its `.jsonl.partial` file.

At the end of round 3, remaining work was owner approval/application of the
four-change older-suite patch and its three-Node verification; round 3b below
supersedes that pending item. The separate engine-owned F/A blocker still
prevents either long qualification run.
All started commands have exited; no autonomous/background supervision is needed.
Work stopped before the requested 22:30 shared-machine cutoff. No commit, network,
keys, engine runtime edits or long timing runs were used.

## Fix round 3b

The test owner explicitly approved this one-off edit of an older session's test,
with approval conveyed by the primary in the round-3b instruction. Exactly the
four approved changes were applied to
`tools/testing/measure-context-read-product-v4fix1.test.mjs`; no other older-session
test was edited. Their original properties remain intact:

- The mid-T exception still leaves that T cell incomplete, reruns it exactly once,
  and retains failure. The assertion now also preserves the other 727 inherited
  complete cells instead of expecting replay to erase them.
- The absent-capability control uses the actual blocked dependency list shape;
  it still proves that a blocked, incomplete capability is rerunnable rather
  than a retained failure.
- The short population still contains only 49 successful samples. Its failed
  attempt now explicitly identifies the expected `read_timeout`
  control, so malformed failures cannot masquerade as healthy controls.
- The freshness percentile still fails for 100 targets at the same recorded
  times and remains incomplete at 99. Targets now have distinct IDs and revision
  1, satisfying the actual target record shape without changing the timing or
  sample-size assertions.

### Functional preparation hardening

`test-preparation.mjs` wraps the existing build loop with a test-only maintainer
runtime. Its isolated Worker freezes the monotonic operation and index clocks.
The public maintainer, worker implementation, authority, real refresh, telemetry
and cleanup paths still execute. A separate real-time **120,000 ms watchdog**
bounds each preparation operation. This is setup supervision, not a timing gate
or a registered product deadline. A failed quantum propagates immediately;
there is no retry. Normal partial/rebuilding progress follows the existing build
loop unchanged.

All test-only build callers in this package were audited: `inputs.test.mjs`
`world()`, the sidecar-verifier fixture helper in `harness-fixes.test.mjs`, both
Q1 orphan/large-evidence preparations, both functional-check build sites and the
`--functional-only` CLI build now use this helper. Even the functional-check's
smaller quantum uses the same setup policy. Measured reads still open separate
ordinary runtimes with real clocks. Qualification and rehearsal keep their
existing `series.build` calls and default configuration dependency; registered
read/open deadlines, product pump values, registration/template bytes and F/A
configuration were not changed. The shared build function only gains an optional
configuration dependency for test setup; its ordinary default is unchanged.

`preparation.test.mjs` deterministically models a successful quantum taking
6,001 ms, without sleeping or asserting a wall-time limit. The ordinary build
fails with `read_timeout`; controlled preparation completes exactly one quantum
for each intent. Separate controls prove immediate propagation/cleanup of a
failed quantum and that the Worker clock override cannot affect the parent
process. In an exclusively owned detached `4baefc3b` worktree, the new helper and
regression were exercised with the original unchanged build loop: **exit 1**,
with `read_timeout` in the slow-success case. After the fix: **exit 0**. Worktree
creation and removal each exited **0**. The initial complete functional-check
run on Node 24.22.1 also exited **0**.

### Shortened verification and acceptance handoff

The primary shortened this window's verification to touched tests and the
approved older suite on all three Nodes, plus the reduced script on Node
24.22.1. The full three-Node harness/guard matrix, full snapshot script and
rehearsal are deferred to the primary's acceptance after the work window. No
full script or rehearsal was run in round 3b. The prior round-3 results above
remain historical evidence, not a claim that those commands ran again.

Every table entry is an actual process exit code. File commands used the
corresponding nvm Node/PATH with `QUAL_INPUT_MODE=reduced node
--experimental-vm-modules --test PATH`. The reduced script used the default
offline counter root; no snapshot-reuse override or retry was used.

| Test file | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | --- | --- | --- |
| `evaluation/context-read-qualification/test/preparation.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/harness-fixes.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q1.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q3.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/inputs.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 | 0 | 0 |

`npm run test:qualification-inputs` on Node **24.22.1** exited **0**. Its
119 checks passed **115**, with the same **four layouts skipped by design**.
The two guards were additionally run on Node 24.22.1:
`core/test/no-raw-db-fd.test.mjs` **0** and
`core/test/sqlite-lock-safety.test.mjs` **0**. Thus all **24** final verification
processes exited **0**. The v4fix1 suite's prior round-3 exits were **1 / 1 / 1**;
after the approved fixture correction its exits are **0 / 0 / 0**, with all
**99** checks passing on each Node. The new preparation file has **three**
passing checks on each Node. The separate initial preparation regression and
functional-check processes also each exited **0** on Node 24.22.1.

No round-3b implementation work remains. The primary will run the full
three-Node harness/guard acceptance matrix, full snapshot script and rehearsal
after this work window. The engine-owned F/A qualification blocker remains.
All verification processes have exited; no background continuation is running.


## Fix round 3c

### Integration and retained guarantees

The primary explicitly supplied the already-fetched local `origin/main` at
`4fd18f1a`; no fetch or network access occurred. The required ancestor check
exited **0**. `git merge --no-commit --no-ff origin/main` exited **0**, with **zero
conflicts**. No generated file was hand-merged. The main-provided runtime bundles passed
`packages/setup/build-runtime.mjs --check` with exit **0** (32 client files,
330 engine files). The merge remains uncommitted;
upstream integration supplies Fix A and P2e (`1024ff21`). Engine runtime changes
in the delivery are exactly upstream changes, not authored fixes. The four
approved v4fix1 replacements, preparation clock, Card oracle, no-read handling,
exactly-one lane exit and healthy classifier controls are preserved.

### Findings and regressions

| Item | Change | Regression |
| --- | --- | --- |
| 1 — cross-segment resume | Carried cells retain `originSegmentId`. Replay separates current-origin complete cells from foreign carried evidence. Resume carries both, while merge counts only the current segment's cells. Inherited aggregate failures remain sticky, and new duplicate rows still reject. Legacy untagged cells use the registered partition to recover origin; undeclared cells still fail inventory validation. `segmentComplete` checks the selected segment's keys independently of carried cells. | `Q3c-01`: actual runner, reader and merger with the real 364 + 364 inventory: success, inherited failure and interrupted segment-2 continuation. The strengthened existing Q3 mirror control independently asserts foreign origin before exercising duplicate rejection. |
| 2 — append errors | Before delegation/start, the report owner durably writes a session-open marker in the main partial report. Only a durable successful-cleanup marker resolves it. Failure-journal append errors cannot erase the already durable unresolved state. The workspace/interrupt safety guards remain. | `Q3c-02`: real coordinator and runner; header-only failure journal, later EACCES appends, renewal/close exceptions in qualification and rehearsal modes. Replay plus 728 successful retries remains failed. |
| 3 — coverage sentinel | The exact emitted telemetry-only sentinel is a recognized incomplete-coverage shape and survives rehearsal filtering without timing fields. Coverage still invalidates the gate; malformed sentinel variants and observed failures remain failures. A separate baseline replay check records failed versus invalid directly. | `Q3c-03`: actual invalid WAL verdict plus sentinel, replay stays invalid. Wrong busy/protocol, missing records or extra fields fail closed. |
| 4 — UTF-8 transport | Storage stdout and both stdin collectors decode from concatenated Buffers. Functional-check stdout/stderr use `setEncoding('utf8')`. Existing 64 MiB stdout and 1 MiB runner-configuration bounds count bytes; overflow is rejected independently of a racing successful child exit. | `Q3c-04`: a real child splits a CJK character between writes; the parent acknowledges receipt before allowing the suffix. Exact text survives. |
| 6 — product pump | Template authoring uses the final reviewed in-process values, explicit provenance/date and representation limits. Builder regenerates JSON and a SHA-256 seal; filled registration checks and registers that seal. No fixed local start time is baked into the template. | `Q3c-06`: final exact values, byte regeneration, SHA-256 and explicit mapping limits; existing drift/frozen-input checks remain. |
| 7 — native diagnostic | Engine platform eligibility is separate from production admission. Native exact-patch engine cells score normally with internal production false. Revision-1 native headers/finals/merges, CLI output and summaries are diagnostic and non-qualifying with a reason. Production/legacy reject the role. | `Q3c-07`: admission, real runner config/final flags, actual requestSeries main/cold/reference gate verdicts with independent eligibility, production rejection and unchanged WSL eligibility. |

The source is **product PR #521 head 84f12e8d (scheduler values unchanged from
7b4ef2ab), reviewed, pending merge**, dated **2026-10-28**, labelled adapter.
The mapping uses merged Fix A's pump API: `cronMs:20000` is the in-process renewal
tick, renewal 60,000 ms, poll 25 ms, quantum 32 / 1,000 ms, per-owner window
2,048 / 60,000 ms, maintainer open 5,000 ms and two active intent selections.
Its actual admission bound reserves the extra quantum (`N*S+Q <= 5000`).
The 5,000 ms maintainer-open option is configured as registered; inside a pump,
the merged engine clamps opening/refresh to the remaining 1,000 ms quantum,
including dispatch/drain work. The product's exact-`1` flag parser and product
wiring are not executed by this harness; the selected profile invokes the engine
APIs explicitly.
The product's stated 4,000 ms sweep arithmetic and the API's conservative
3,000 ms two-selection bound both fit; neither is a measured timing claim.

The harness cannot reproduce UTC-minute alignment (it anchors monotonic windows
at pump start), the 3 s write nudge, four-owner resident admission, n>4
round-robin slots or indefinite residency across cells. It does not simulate
product refunds or pacing; engine accounting/pacing execute as merged. Protocol
cells also select DELETE/WAL independently of the product's DELETE setting.
These limits are recorded in `productInputs.pump.representationLimits` and
preclude an exact product-scheduler claim; no silent approximation is made.
F/A writer cadence, targets, probe lanes, window/sample counts and explicit tiny
rehearsal allowances were not tuned.

Two independent stream audits (ripgrep collector search and Python filesystem/
source traversal) checked both requested trees. All four unsafe implementation
collectors were fixed. Buffer forwarding, readline and spawnSync/execFile
complete UTF-8 decoding were checked as safe. Two remaining matches are older
sessions' test-only stdout/stderr collectors; they were left byte-exact under
the explicit instruction not to edit older tests. No engine oracle reads use
those test collectors.

### Verification and operator handoff

Three exclusively owned detached `8f336ea1` baseline worktrees were created and
removed, including a final-source rerun: creation **0 / 0 / 0**, removal **0 / 0 / 0**. Each of `Q3c-01`, `-02`, `-03`, `-04`, `-06`, `-07` and the strengthened
Q3 mirror process exited **1** in all three baseline passes. The fixed new file initially
passed all **11** checks with exit **0**. The Q1 integration file passed all
**19** checks with exit **0**. Initial development runs exposed a malformed test
storage mock (fixed without relaxing classification) and a test-child IPC close
issue (fixed in the new regression). Their red/debug processes exited **1**.
The initial combined integration process exited **1** solely for new exact
resource-access entries; its Q3 and functional cases passed. The standalone raw
file guard exited **1**, then **0** after exact template/seal entries were updated;
the guard source was not edited.

Every table entry is an **actual process exit code**. File runs used the
corresponding nvm Node/PATH with `node --experimental-vm-modules --test PATH`.
Package runs used offline npm and the local pinned counter root. After the
native-label regression was strengthened, the entire Q3c file and reduced script
were repeated on all three Nodes; those repeat exits are shown for those rows.
All **43 initial matrix processes** and **six final-source repeats** exited **0**.
Both guards were additionally repeated together on final source on every Node: **0 / 0 / 0**.

| File / command | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | ---: | ---: | ---: |
| `evaluation/context-read-qualification/test/q3c.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q3.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 | 0 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 | 0 |
| `npm run test:qualification-inputs` | 0 | 0 | 0 |
| `npm run test:workspace-lifecycle` | 0 | 0 | 0 |

`npm run test:qualification-inputs:full` ran **once** on Node **24.22.1**:
**exit 0**, all **130** tests passed, **zero skips**, all six snapshot entries
rebuilt/seal-checked. That physical rebuild preceded the final coverage-sentinel
filter repair; corpus, generation and storage-transport code were unchanged,
and the later reduced runs verify every regression after that repair.
Every final reduced run passed **126** with the same **four
intentional layout skips**. Each workspace-lifecycle run passed **241** tests.
The new Q3c file has **11** passing cases per Node. The focused native gate probe
and expanded native CLI/summary probe each also exited **0** on Node 24.22.1.

A fourth, isolated final-source sentinel worktree was created and removed
(**0 / 0**). Its actual replay produced `failed` instead of `invalid` on the
baseline (**exit 1**); fixed replay and rehearsal-filter probes each exited **0**.

Registration fill, validation and both segment estimates on Node 24.22.1 each
exited **0**. Estimates remain **364 / 364**, **23,313.7 s / 23,313.7 s**; no
measured timing claim was made. Template JSON and its SHA-256 seal were generated
by the deterministic builder (both authoring runs **exit 0**), and byte/seal drift
checks pass. Product values, mapping limits and pending-merge provenance are
frozen; host/volume identities, truthful platform role, operator reservation,
writer-profile registration input and final committed source IDs remain operator
inputs. The preparation-only registration is not a reserved run registration.

### Single engine rehearsal

The engine `--rehearse` command ran **once** on Node **24.22.1**, actual exit **1**. Its final recorded flags are:

```json
{"status":"failed","functionalPassed":false,"cleanup":true,"qualifying":false,"timingClaims":false}
```

The real record audit and cell outcomes are:

The audit inspected **193 real journal records**.

- `requests`: functionalPassed **true**.
- `overflow`: functionalPassed **true**.
- `exposure/W+WM`: functionalPassed **true**.
- `F/A session`: functionalPassed **false**; `unobserved_target:tiny-memory:current`, `unobserved_target:tiny-memory:history`, `unobserved_target:tiny-card:current`, `unobserved_target:tiny-card:history`.
- `backup/B`: functionalPassed **true**.
- `state/T/post-catch-up`: functionalPassed **true**.

Final classifier audit: **0 non-F/A failure records**; **0 non-F/A functional failures**. Coverage-only sentinels retain their known shape through rehearsal filtering; incomplete coverage is not fabricated into an observed failure.

No records, targets, writer pacing or pump-restart behavior were fabricated or
tuned to clear the rehearsal. Full-scale native execution remains an authorized
non-qualifying diagnostic. No long timing run, network access, key use or commit
occurred in this round. The pending merge and authored fixes are left for the
primary to review and commit. All started verification/rehearsal processes have
exited; this handoff establishes no background continuation or notification job.


## Fix round 3d

The native engine diagnostic now uses one shared, SQLite-free
`validateNativeVolume` rule in the harness protocol module. Before measurement,
`validateRegistration`, `enginePlatform` (also called by
`validateV4Registration`), `validateFilled` and `fillRegistration` require
`volume.filesystem:"ext4"`, `volume.nonWSL:true` and
`volume.production:false`. A present top-level `filesystem` must equal the
volume declaration. Contradictory mirrors and production-volume declarations
are rejected with `native_volume_declaration`, as is an explicit
`volume.productionEquivalent:true` claim required to be rejected by R3.6.
Runtime Linux/non-WSL/ext4 corroboration remains byte-exact; WSL2, APFS and production-role admission rules
are unchanged. A truthful native revision-1 registration still has
`qualifying:false`, `diagnostic:true` and its revision-mismatch reason.

The existing author's `q3c.test.mjs` now contains `Q3d native volume declarations
are checked at every admission point`: five positive controls and **30 rejection
controls** (all five admission functions × production true, nonWSL false,
nonWSL missing, non-ext4 filesystem, contradictory top-level mirror and the
R3.6 equivalence-claim control).
Additional controls exercise an absent optional mirror, diagnostic flags and
unchanged WSL2/APFS admission. No older-session test was edited.

Two exclusively owned detached `fad2c39d` worktrees received only the updated
test, first for the four requested violation types and then including the
explicit R3.6 equivalence claim. Creation exited **0 / 0**, their focused
regressions exited **1 / 1**, and removal exited **0 / 0**. In the final baseline
all 30 rejection controls failed because admission accepted the declarations.
Both fixed focused runs exited **0** (31 tests initially, all **36** after the
equivalence control). Counter dependencies were reused offline; no dependency
installation, network, fetch, engine runtime edit, key use or commit occurred.

Every entry below is an actual process exit code. File runs used the matching
nvm Node/PATH with `node --experimental-vm-modules --test PATH`; package runs
used offline npm and the default local pinned counter dependencies.

| File / command | Node 22.16.0 | Node 24.15.0 | Node 24.22.1 |
| --- | ---: | ---: | ---: |
| `evaluation/context-read-qualification/test/q3c.test.mjs` | 0 | 0 | 0 |
| `evaluation/context-read-qualification/test/q3.test.mjs` | 0 | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 | 0 |
| `npm run test:qualification-inputs` | 0 | 0 | 0 |

All **15** initial matrix processes and the **three** final-source Q3c repeats
exited **0**. The table uses the repeat exits for Q3c. Its first runs began
before the final equivalence-claim control; all reduced runs and Q3c repeats
use the final source. Each final Q3c repeat passed all **47** tests. Each reduced
package run passed
**162 of 166 tests**, with **four intentional layout skips** and no failures.
The focused fixed regression also exited **0**; its baseline exited **1**, with
all five truthful controls passing and all 30 rejection controls failing.
No full snapshot run, rehearsal or timing measurement was requested or run in
this round. All started verification processes have exited; no background
continuation remains. The initial handoff authoring finalizer exited **1** for
an extra blank line at EOF; after correction its final audit exited **0**.

## Changed files, cross-checked two ways

Relative to `fad2c39d`, Git diff plus untracked inventory and an independent
HEAD blob/mode comparison plus filesystem discovery agree on **6 paths**,
checking **2522 HEAD files** (cross-check exit **0**). No engine runtime,
older-session test, guard source, template or dependency file changed.

- `docs/plans/context-read-qualification-inputs.md`
- `evaluation/context-read-qualification/registration.mjs`
- `evaluation/context-read-qualification/test/q3c.test.mjs`
- `tools/testing/fixtures/context-product/protocol.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/measure-context-read-product.mjs`
