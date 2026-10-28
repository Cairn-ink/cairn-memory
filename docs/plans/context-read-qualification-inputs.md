# Context-read qualification inputs: preparation handoff

**Qualification remains blocked. Do not start either long segment.** The authorized harness fixes and product registration are implemented.
The tiny real session leaves all four first-eligible Memory/Card intent targets
unobserved under same-projection capture/review writes. An earlier round-1 trial also retained
a T preparation `read_timeout`; the final rehearsal completes all four T probes
and preserves that earlier evidence below. An earlier session with
the adapter quantum also exported a failed pump with `index_unavailable`. Requests, O, W/WM, B and all four T probes complete their functional checks in
the final round-1 rehearsal. The pinned test dependencies were installed offline. No engine runtime
change, qualification timing run, network access or commit was made.

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
| Quantum | 128 items / 1,000 ms | adapter |
| Per-tick budget | 1,024 items / 8,000 ms | adapter |
| Poll / renewal / cron | 25 ms / 10,000 ms / 60,000 ms | adapter |
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
`counterConfiguration:{dependencyRoot:OPERATOR_DEPENDENCY_ROOT}` only when an
override is needed. The local pinned dependency root is the default. Node, counter,
deadline, pump and other frozen product-fact keys are forbidden in host overrides,
even when their values equal the template.
`production-linux-ext4`, `wsl2-ext4` and `apfs` remain distinct roles.

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

## Changed files, cross-checked two ways

Relative to `94edae6c`, Git diff plus untracked inventory was compared with an
independent HEAD blob/mode comparison of **2478 files** and `rg --files --hidden`
disk discovery. Both routes agree at **35 paths**, including this handoff, the new
test-only snapshot coverage/catalog helper, and the two pre-supplied, unchanged
dependency manifests. The cross-check exits **0**. The seven harness test paths
were separately cross-checked by filesystem glob and `rg` (**7 paths**, exit **0**).
There are **zero engine runtime changes** and **zero database files** in the
delivery list. The raw-file guard source and both F/A configuration files match
HEAD exactly. Operator-path/private-name scans and final whitespace checks
exit **0**.

- `.github/workflows/ci.yml`
- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-qualification-inputs.md`
- `evaluation/context-read-qualification/adapter.mjs`
- `evaluation/context-read-qualification/build-template.mjs`
- `evaluation/context-read-qualification/canonical-evidence.mjs`
- `evaluation/context-read-qualification/corpus.mjs`
- `evaluation/context-read-qualification/counter-closure-child.mjs`
- `evaluation/context-read-qualification/counter-deps/package-lock.json`
- `evaluation/context-read-qualification/counter-deps/package.json`
- `evaluation/context-read-qualification/counter.mjs`
- `evaluation/context-read-qualification/freeze.mjs`
- `evaluation/context-read-qualification/generate-child.mjs`
- `evaluation/context-read-qualification/generate.mjs`
- `evaluation/context-read-qualification/gold-rank.mjs`
- `evaluation/context-read-qualification/labels.json`
- `evaluation/context-read-qualification/manifest.json`
- `evaluation/context-read-qualification/queries.json`
- `evaluation/context-read-qualification/registration.constants.json`
- `evaluation/context-read-qualification/registration.engine.template.json`
- `evaluation/context-read-qualification/registration.mjs`
- `evaluation/context-read-qualification/schemas.mjs`
- `evaluation/context-read-qualification/test/harness-fixes.test.mjs`
- `evaluation/context-read-qualification/test/inputs.test.mjs`
- `evaluation/context-read-qualification/test/q1.test.mjs`
- `evaluation/context-read-qualification/test/snapshot-checks.mjs`
- `package.json`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/rehearsal-checks.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/storage-child.mjs`
- `tools/testing/fixtures/context-product/v4-session-pump.mjs`
- `tools/testing/fixtures/context-product/v4-session-work.mjs`
- `tools/testing/fixtures/context-product/v4-windows.mjs`
- `tools/testing/summarize-context-read-product.mjs`
