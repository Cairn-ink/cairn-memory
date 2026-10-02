# Classification rejection reasons

Owner: `/root/classification_reason_impl61`, actual GPT-6.1 Sol / high (user-selected).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/classification-rejection-reasons`.
Branch: `fix/classification-rejection-reasons`.
Fixed base: `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4` (`origin/main`).

This is an offline observability improvement. The exact original live proposal
was not retained; this work does not identify or fix its historic cause.

## Acceptance criteria (verbatim assignment)

Contract CR1: preserve every existing accepted/rejected proposal/result and public failureCode semantics; invalid classified batch leaves committed card/receipts intact and local partial classification status, never retries or erases/re-admits.

CR2: trusted onDiagnostic observer records bounded compile-time reason(s) identifying deterministic validation class at rejection, never title/text, identifiers, indices, exception details or provider/raw proposal; fallback invalid_classification for unexpected/unclassified errors. Prefer same existing v1 stage/layer/reason shape with explicit allowlist; no arbitrary strings. Handle observer throw/reject without altering outcome. Avoid diagnostic revalidation drift/duplicated validator policy: emit classifications at actual rejecting seam or safely tagged internal error; do not relax limits.

CR3: cover reachable duplicate memory targets, duplicate L1 parents, duplicate L2 parents, invalid newL1 and newL2 title normalization/length (121 codepoints, UTF16 boundary, empty/redacted, NUL etc), target cardinality/membership mismatch, visibility/create-policy checks and generic fallback; choose lean finite classes rather than combinatorial data. Existing placementProposal API consumers preserve original error codes.

CR4: prove actual fake OpenAI adapter-valid output -> real core admission -> deterministic rejection for at least121-title and duplicate targets/parents, cold cards/source receipts retained, only exact finite diagnostic; missing alias remains adapter validation distinct. Boundary120 valid, valid filing, storage conflict remain distinct. Add RED-capable synthetic test before fix, run at least once failing and record output, then GREEN. No actualcase/gold tests.

CR5: hostile thrown errors/model content contain canary secrets + IDs; no canary escapes diagnostic events. Sparse/getter/malformed direct core shapes fail closed. No callback result changes no retry, tests proper teardown including failed assertions.

CR6: update protocol threat/privacy explanation of finite reason surface, user-visible CHANGELOG and limitations that exact historic cause remains unknown and runtime observability is not semantic accuracy; no score/parity/official result claim.

CR7: run generic npm test + npm run validate, test:core + demo:store + demo:moc on BOTH Node22.16.0/24.15.0; adapter tests + demo:openai-offline both if actual adapter integration test added/import used. Repo has no typecheck. Use existing locked isolated dependencies via npm ci --prefix adapters/openai if needed (registry dependency install okay; no provider). Keep new worktree clean besides scoped task; no raw broad dumps. Trace callers and tests, record owner/evidence. Freeze a local candidate commit after gates, report exact changed files/base/head/diff evidence/raw log paths. DO NOT push until primary acceptance and dual independent review. Meaningful checkpoints: failing seam, fix/green, full gates/candidate/blockers. Root continues private source membership acceptance separately.

## Scope and boundaries

Only classification/placement validation, diagnostic allowlist, synthetic tests,
protocol/limitations/changelog and this plan are in scope. No prompt/schema
acceptance changes, runner/extraction/recall behavior changes, real corpus,
private studies, configured keys, ledger, provider calls, production, release,
merge or push. Existing committed admission state remains authoritative.

Primary acceptance found a downstream integration dependency after the first
GREEN checkpoint: `evaluation/live/public-pilot.mjs` projects model diagnostics
through its own finite allowlist and would drop the eight new reasons. The
primary amended this same observability packet to include only that finite
allowlist and focused synthetic projection/persistence tests in
`evaluation/live/test/public-pilot.test.mjs`. No model, stage, budget, timer,
scorer or runner outcome behavior is changed. The amendment adds both-runtime
`test:live-evidence-offline`, `test:longmemeval` and `demo:longmemeval-public`
gates with isolated locked MCP dependencies. Original CR1–CR7 text above is
retained verbatim; this is the scoped integration amendment, not a new
experiment policy.

## Caller trace and evidence

| Seam / dependent check | Owner | Evidence |
| --- | --- | --- |
| `core/classification.mjs` calls `placementProposal` and checks visible groups | implementation worker | inspected fixed-base source; all current rejection paths collapse to `invalid_classification` |
| `core/contract.mjs` `applyPlacement` / `applyInitialPlacement` direct placement consumers | implementation worker | no observer supplied; original validator error codes retained, tested directly plus existing MOC/capture suites |
| `core/contract.mjs` classify and `core/capture.mjs` post-admission classification | implementation worker | real synthetic capture tests must retain admission/receipts and batch status |
| OpenAI adapter classification wire aliases and shape acceptance | implementation worker | fake HTTP integration tests; adapter schema and prompt unchanged |
| Existing diagnostics callback and allowlist | implementation worker | frozen v1 event; callback throw/reject swallowed |
| `evaluation/live/public-pilot.mjs` private diagnostic projection and persistence | primary identified; worker implements | duplicate finite allowlist updated; exact eight reasons roundtrip, arbitrary values/accessors rejected, actual post-admission title failure remains local partial capture |

## Verification record

Raw logs: `/tmp/cairn-classification-reasons-logs.HHPcHn/` (fresh worker-owned
directory; synthetic diagnostics and test output only).

- RED before production edits: Node 22.16.0,
  `node tools/testing/run.mjs adapters/openai/test/classification-rejection-reasons.test.mjs`.
  `red-seam-node22.log`: all four adapter-valid rejection paths completed real
  admission, cold retention and no-retry checks, then failed only because the
  baseline emitted `invalid_classification`; missing-alias control passed.
  Result: 1 pass / 5 failures including the parent subtest aggregation.
- Fixture correction before that definitive RED: a single visible topic gave
  adapter maxItems=1, so a duplicate two-entry parent array failed at the
  adapter. Seeding two distinct topics per level established the reachable
  precondition; rerun then failed at the intended diagnostic assertion.
  Initial/corrected attempts are retained as `red-node22.log`,
  `red-corrected-node22.log`, `red-final-node22.log`. This was a test-fixture
  correction, not a schema change.
- GREEN after implementation: `green-adapter-node22.log` (6/6),
  `green-core-node22.log` (15/15 including existing diagnostic tests), then
  `green-integrated-node22.log` (15/15 including valid 120-codepoint ASCII/emoji
  filing and distinct storage conflict controls).
- `git diff --check` passed before full gates.
- Initial full gate sets are provisional on Node 22.16.0 and 24.15.0:
  `npm test`, `npm run validate`, `npm run test:core`, `npm run demo:store`,
  `npm run demo:moc`, `npm run test:openai`, `npm run demo:openai-offline`.
  Exact command logs are `node22-<script-with-colons-replaced-by-dashes>.log`
  and `node24-<script-with-colons-replaced-by-dashes>.log` in the raw-log directory.
  They started before the primary integration amendment and cannot substitute
  for final frozen-source evidence.
  Generic tests (580 passing on Node 22) and validation passed both runtimes.
  At primary instruction, only verified owned provisional core runner parents
  17379 / 23259 received catchable SIGTERM to free resources for the separate
  packet's canonical gates. Both enclosing matrices closed with exit 143;
  later scripts did not run. These core logs are deliberately interrupted
  provisional evidence, not a product failure or pass. Exact owned scratch
  roots were derived from those process groups' SQLite fd paths, without
  reading process environments: `/tmp/cairn-test-run-C2g2cR` and
  `/tmp/cairn-test-run-lbG7Z3`. Both roots and runner PIDs were verified absent
  after closure; `provisional-cleanup.log` records that check. No sweep or
  historical cleanup was performed.
- Downstream RED before the public-pilot allowlist edit:
  `node tools/testing/run.mjs --test-name-pattern='CR[12] downstream'
  evaluation/live/test/public-pilot.test.mjs`, Node 22.16.0.
  `red-downstream-node22.log`: 0/2 pass; eight finite injected observations and
  the real 121-title post-admission rejection were both dropped from persisted
  `memoryModel.records`. `green-downstream-node22.log`: 2/2 after the sole
  projection-allowlist amendment, with exact persistence, malformed/accessor/
  canary refusal, no extra fields, 0600 artifact and no-retry roundtrip checks.
- `green-final-core-node22.log`: 6/6 after explicitly retaining generic fallback
  for an unexpected internal title-normalization exception. Only validator-owned
  `MemoryStoreError` title validation errors receive a title category.
- Additional locked dependencies installed with `npm ci --prefix adapters/mcp
  --ignore-scripts`; 14 packages, audit clean; registry only, no provider.
- Runtime/test source frozen after the downstream GREEN checkpoint. Final
  matrices wait until the separate supplied-history packet's canonical gates
  finish; primary owns the scheduling release. Provisional and final full gates
  never overlap within this packet. This avoids load on timer-sensitive tests
  without changing the required checks. Final parent npm compile cache will be
  disabled with `NODE_DISABLE_COMPILE_CACHE=1`; every final log will include
  exact node binary and version headers. Demo databases retain their documented
  example lifecycle and are distinct from runner-owned temporary test scratch.
- Locked adapter dependencies installed with `npm ci --prefix adapters/openai
  --ignore-scripts`; one package, audit clean. No credential or provider call.
  Target repo has no `AGENTS.md` or `scripts/README.md`; inherited parent
  instructions and target `CONTRIBUTING.md` / `CONTEXT.md` were inspected.
- Primary released the canonical gate slot after the other packet closed.
  Frozen runtime/test hashes are retained in `final-source-sha256.txt`.
  Exact final logs use `final-node22-<script-with-colons-replaced-by-dashes>.log`
  and `final-node24-<script-with-colons-replaced-by-dashes>.log`, with binary,
  version, command and parent compile-cache-disabled headers.
  The first canonical Node 22 generic test stopped at 579/580: unchanged
  `main-golden.test.mjs` observed empty fake request bytes in the
  `host-0755-key` / `launch-capture` variant. Launcher and later status exited
  zero, but the detached hook deliberately suppresses automatic-action errors;
  its original internal reason/exit status was not retained. The plugin,
  launcher and golden fixture have no changes against the fixed base, and
  their import graph does not reach the changed core or pilot modules.
  This narrows attribution but does not establish the original cause.
  Node 24 generic tests passed 580/580 and validation passed; its canonical
  core gate stopped at 1141/1142 on unchanged D3 staged receipt-deadline test:
  the intercepted receipt INSERT was never reached (expected 1, actual 0).
  The 876ms failure duration was shorter than its intentional 900ms INSERT
  pause; the fixture has a shared 600ms real monotonic capture budget.
  Classification executes only after admission, downstream of this seam.
  Neither failure log is overwritten or treated as a pass.
- Narrow diagnosis, not replacement canonical evidence:
  `diagnostic-node24-d3-target.log` runs the unchanged failing D3 test alone
  through the owned runner on Node 24.15.0, cache disabled: 1/1 passing, 1574ms
  including the intended receipt pause. Five fresh synthetic Node 22 detached
  replays in an owned copied plugin fixture reached capture and telemetry,
  each observed exactly two fake requests and detached worker exit zero,
  246–397ms launcher-to-completion. Only compile-time phases/reasons and timing
  were recorded in `diagnostic-probe-node22.jsonl`; no request content, keys,
  IDs or arbitrary exception text was logged. The copied control timeout
  matched the golden fixture's existing 30s widening; tracked code was not
  changed. Harness: `diagnostic-replay.mjs`, outside the worktree. Owned scratch
  `/tmp/cairn-test-run-phjhOF` was verified absent after completion. These
  successful unloaded probes do not prove that load caused either original
  failure. Further affected-gate reruns require the primary's direction.
- Primary directed completion of the already-started unaffected gates, followed
  only after both owned runners close by controlled synthetic probes of the
  actual unchanged 2s HTTP quota-lock refusal and the pre-receipt monotonic
  deadline boundary. It then authorizes one strictly serial Node 22 generic
  rerun and Node 24 core rerun, retaining originals, unchanged source/limits,
  exact runtime headers and disabled parent compile cache. A second failure
  requires stopping/reporting, not repeated attempts. Probe harnesses are owned
  files outside the worktree: `diagnostic-golden-lock.mjs`,
  `diagnostic-golden-preload.mjs`, and `diagnostic-d3-clock.mjs`; execution and
  results remain pending. `diagnostic-unchanged-seams.diff` is empty against the
  fixed base for plugin/golden/capture-deadline/capture/admission and the
  original D3 test. No tracked debugging instrumentation or limit edit exists.
- Node 24's continued adapter gate stopped at 319/320 on the unchanged A01
  tokenizer-performance test: `spawnSync` reported `ETIMEDOUT` at its original
  5s child guard on 40,000 spaces. The adapter suite already has
  `--test-concurrency=1`; it overlapped Node 22's existing core gate and shared
  host pressure, but the original child did not retain import/count timing.
  `diagnostic-unchanged-tokenizer.diff` is empty for adapter index and its
  original performance test. Index imports the modified finite diagnostic
  allowlist, but this direct valid `encoder.encode` path never invokes its
  observer, classification or pilot code. The primary added an owned finite
  tokenizer phase probe retaining child status, signal, error code and
  import/count elapsed phases, with the same 5s guard and 40k input; its result
  is pending. No timeout, tokenizer, dependency or application limit changes.
  Subsequent gates and all affected reruns are now strictly serial across
  runtimes; no additional Node 24 gates start while the existing Node 22
  runner remains active. No unrelated process is terminated or environment
  changed. The primary observed shared-host load above the 16-CPU count; this
  supports pressure as a hypothesis, not proof of either old hidden cause.
- Node 22 canonical core passed 1142/1142, followed by `demo:store` and
  `demo:moc`; its already-started remainder proceeds to adapter and downstream
  gates. The original failed canonical logs remain unchanged.
- The primary accepts resource-configured equivalents for affected generic
  and core reruns, not falsely described as literal npm commands:
  `node integrations/client/testing/run.mjs --test-concurrency=1
  plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs`
  on Node 22, and `node tools/testing/run.mjs --test-concurrency=1
  core/test/*.test.mjs` on Node 24. These use the same package file patterns,
  home guard where applicable, invocation-owned temp runner and unchanged
  assertions/product limits. The adapter npm command already uses concurrency
  one. Latest-head CI with its ordinary configuration remains mandatory and
  root-owned after primary acceptance plus independent reviews.
- Primary acceptance (root-owned, separate from the full gate set): actual
  clean-environment/cache-disabled `--test-concurrency=1` runner over new core,
  existing diagnostic and fake-adapter tests passed 26/26, zero skip/fail, on
  Node 22.16.0 (16.920s) and Node 24.15.0 (15.319s). Initial raw output remains
  in the primary tool transcript, not a claimed file log. Root verified all
  eight frozen runtime/test hashes and will tie this content to the candidate.
  Focused primary pilot roundtrip acceptance passed 2/2 on each runtime.
  Root's fsynced mode-0600 record is
  `/tmp/cairn-six-diagnostic-primary.F3Skmd/CLASSIFICATION-PRIMARY-PRECOMMIT.json`;
  it includes Node 24 key-test and both pilot raw output, explicitly identifies
  initial Node 22 key output as tool-transcript-only, and records actual SHA256
  reads for the eight frozen files. This worker cites the root-supplied path
  without inspecting unrelated private files. The checks verify exact eight
  finite persisted reasons, private artifacts and no retry/raw-content leak.
  No source edit or full-gate success is inferred from these bounded checks.
- The continued Node 22 gate-chain session 25028 unexpectedly closed with 143;
  neither worker nor primary sent a signal. Earlier worker inspection reported
  only 110 passing live-evidence cases and no summary; that inspection was
  incomplete and is corrected here. The immutable exact retained
  `final-node22-test-live-evidence-offline.log` actually contains the complete
  Node 22.16.0/cache-disabled `npm run test:live-evidence-offline` TAP summary:
  372 tests, 342 passed, 30 intentional opt-in installed/Hermes skips, zero
  failures/cancellations/TODOs, 324461.981857ms. Its SHA-256 is
  `9fec8f51c5c88773458e695d978881cf328eb6caae435e2906752a7f5d3fcb04`;
  filesystem mtime/ctime is 2026-10-03 01:32:47.816680155 +0800. No later run
  overwrites that file. The parent-chain exit remains UNKNOWN: absent retained
  process lineage, it cannot be attributed specifically to that fully
  summarized live child, nor accepted as a zero child/chain exit. A distinct
  authorized serial rerun will retain explicit launcher/cleanup evidence.
  Exact original runner PID/scratch path were not retained, so their absence
  is not claimed. Targeted runner/native-child command checks found no
  active match, and all 31 unique logged child PIDs no longer had this owned
  worktree cwd; `interrupted-node22-live-owned-check.log` records that check.
  No historical cleanup, broad sweep or unrelated process termination occurred.
- All three primary-authorized controlled probes then closed with zero:
  `diagnostic-node22-http-lock.log`: a fresh host-0755-key detached control
  produced two fake requests, worker exit zero. Changing only a live owned
  quota lock reproduced empty request bytes, completion marker, launcher zero
  and blank stdout/stderr; the worker's finite caught reason was
  `capture_unavailable` at 2071ms and worker exit zero at 2072ms, proving the
  unchanged 2s lock window reached refusal. This is a reachable explanatory
  counterfactual, not a recovered reason from the original failing worker.
  `diagnostic-node24-d3-clock.log`: actual 600ms capture budget with fixed 900ms
  receipt work reached the INSERT once and rolled back on `model_timeout`;
  changing only pre-qualification elapsed clock time to 601ms instead reached
  zero INSERTs and failed `model_timeout`. Both called only extract/qualification,
  never classification, and retained zero memories/receipts. The original
  failure asserted before inspecting its error, so its exact code is unknown.
  `diagnostic-node24-tokenizer-phases.log`: unchanged 5s child guard and exact
  40k-whitespace input completed status zero, no signal/error, in 4206ms;
  import finished at 633ms and counting at 4105ms. The original timeout's
  import/count split remains unknown. All probe workspaces use immediate
  failure-safe cleanup plus the owned outer runner; no tracked instrumentation.
  Frozen hashes still match. Approved gate reruns now run strictly one at a
  time, with distinct retained logs and known launcher PIDs, not overwritten
  originals. The primary still requires latest-head ordinary CI before delivery.
- Serial Node 22 generic rerun completed 580/580, zero skips/failures, 449.85s:
  `final-node22-test-serial-rerun.log`. Its originally failing golden fixture
  passed in 46.323s. Exact owned launcher 88278 and descendant-only inspection
  identified `/tmp/cairn-test-run-26rO7Y` in
  `final-node22-test-serial-ownership.log`; this exact root was verified absent
  after closure. The original failed log and unknown worker cause are retained.
  Node 24 core serial rerun is the next single active full gate.
- General-gate audit raised before candidate freeze: CONTRIBUTING/README also
  require both-runtime workspace lifecycle and isolated maintainer plugin
  validation. Primary explicitly adds these after the existing mandatory set;
  no unchanged artifact, installed rationale or unrelated optional gate is
  added. Maintainer tooling pins Claude Code 2.1.260 and its validate script
  runs only local marketplace/plugin schema validation; fresh owned HOME/TMP,
  clean subprocess environment and disabled nonessential traffic/telemetry
  avoid actual user configuration, keys or model calls. Dependencies are
  locked/isolated registry installs only; execution evidence remains pending.
- Node 24 serial core rerun was itself interrupted with 143 before a final
  summary, while `core/test/moc.test.mjs` was active. Its original D3 receipt
  deadline case passed within this run (1159.695ms), but the partial run is not
  a complete core pass. Neither worker nor primary sent a signal. Exact
  launcher 53245 and scratch `/tmp/cairn-test-run-mxoMrI` were recorded during
  the owned lineage check; both launcher absence and exact scratch absence
  were verified after closure in `final-node24-core-serial-cleanup.log`.
  `final-node24-test-core-serial-rerun.log` remains intact. Owned log timestamps
  (`interruption-owned-log-times.jsonl`) give 1365.44s write span; this does not
  establish a fixed timeout or explain either unexpected interruption.
  No assertion failure or full-core success is inferred, and no further core
  retry has been started without primary direction.
- Scheduling refinement: after this exact cleanup, the primary grants the
  other packet one bounded SCI6 installed-native smoke window (only its new
  12 controls, owned by that worker), not a full matrix. This worker pauses
  before adapter/other gates until that window closes and the shared slot is
  explicitly handed back. No full/native overlap, unrelated termination or
  runtime/test modification occurs. The other packet's full matrix still
  waits for classification's eventual final release.
- The bounded SCI6 smoke window closed successfully and returned the shared
  heavy-gate slot. Primary authorizes exhaustive Node 24 core coverage through
  disjoint per-file controls, not another monolithic retry: frozen manifest
  `core-node24-shard-manifest.json` has 84 regular test files, SHA-256
  `0f960efcbf0fba9ec523ef888d574bc8940aa57ab618e41a642cf4919ba5297b`.
  Each uses the same runner, concurrency one, untouched assertions and product
  limits, separate PID/caller scratch/full TAP/exit record, and immediate
  cleanup. Aggregate acceptance must compare against direct directory entries
  (including ignored/untracked regular `*.test.mjs` files), verify every frozen
  file hash, exact union/no omissions or duplicates, and 1142 tests with zero
  failures, cancellations, skips and TODOs. This is equivalent local coverage,
  explicitly not a canonical single npm invocation or an explanation of the
  two unknown interruptions; ordinary final-head CI remains required.
  Five minutes per control is an operational target only, not an outer timeout.
  Full unchanged long files are explicit exceptions with known ownership and
  live polling; the already-passing Node 22 background-context file's three
  sweeps took approximately 9.4 minutes. No deadline, filter, assertion or
  verification requirement is relaxed.
- Node 24 exhaustive core controls 000–083 all closed status zero/no signal,
  with caller scratch absent. `core-node24-shards-summary.json` verifies the
  direct-directory exact 84-file union, zero omissions/duplicates, all frozen
  test hashes unchanged, 1142/1142 passed and zero failures/skips/cancellations/
  TODOs. The complete original deadline file passed 19/19, background-context
  17/17, episode-capture 68/68, episode-concurrency 40/40 and MOC 12/12. All eight
  runtime/test freeze hashes still match. External controller revisions are
  honestly recorded in `core-shard-controller-revisions.md`: the initial 000
  pre-handler helper hash was not retained; later revisions only add owned
  signal forwarding, exact aggregate checks and ordered live TAP retention.
  Controls have independent PID/root/raw TAP/final count records; no partial
  monolithic log is relabeled successful and no original log is overwritten.
- Node 24 adapter serial rerun closed native child status zero/no signal in
  102360ms; exact spec footer is 320/320 passed, zero failures/skips/
  cancellations/TODOs. Known npm launcher 2785 and caller scratch
  `/tmp/classification-final-gate-DZEkwN` are absent after closure. Raw
  `final-node24-test-openai-serial-rerun.log` and original record are preserved.
  The external controller had a TAP-only footer parser and therefore failed
  its own postcheck despite native success; this is a controller evidence
  defect, not a product/test assertion failure. Separate
  `final-node24-test-openai-serial-rerun-footer-audit.json` independently asserts
  all six exact anchored spec counts, native status and actual scratch absence;
  it does not rerun tests or overwrite originals. Future controller parsing
  accepts both exact finite footer styles. Helper SHAs and the narrow change
  are retained in `remaining-gate-controller-revisions.md`. Eight frozen
  runtime/test hashes still match. The original adapter timeout log remains
  retained and its original startup/counting phase remains unknown.
- Primary scheduling amendment after adapter closure: pause remaining gates
  and hand back the heavy slot for its bounded approximately four-minute
  source-bound/SCI acceptance window. No classification verification child
  remains active, and this is an inter-gate scheduling boundary, not a waiver
  of remaining required gates or authority to push. Primary will explicitly
  return the slot before this worker resumes live/LME/demos/lifecycle/
  maintainer gates and freezes the local candidate.
- Primary's bounded verification window closed and explicitly returned the
  heavy slot. Node 22 live serial rerun then closed actual status zero/no
  signal/no recorded termination: 372 tests = 342 passed + 30 expected opt-in
  installed/Hermes skips, zero failures/cancellations/TODOs, 481216ms; caller
  `/tmp/classification-final-gate-aQX1pA` absent. Its distinct log/ownership/
  result records use `final-node22-test-live-evidence-offline-serial-rerun`.
  This closes the required offline gate without reinterpreting the earlier
  UNKNOWN parent-chain exit. Node 22 LongMemEval closed 193/193, zero skips,
  21288ms, caller absent (`final-node22-test-longmemeval`). Node 22 public demo
  closed zero in 494ms and cleaned its caller. Node 24 OpenAI offline demo
  closed zero in 1245ms; its documented synthetic example database is
  intentionally retained as `cairn-openai-offline-IcToJ6` inside
  `/tmp/classification-final-gate-JMTmm4`, not accidental test residue. Their exact
  commands/runtime/cache-disabled headers and launcher records are retained.
- Node 24 live offline gate closed zero/no signal/no termination in 389888ms:
  372 tests = 342 passed + the same 30 intentional opt-in installed/Hermes
  skips, zero failures/cancellations/TODOs; caller absent. Node 24 LongMemEval
  closed 193/193, zero skips, 17286ms; public demo closed zero in 480ms and
  cleaned its caller. Workspace lifecycle closed 25/25, zero skips, on both
  exact runtimes (16253ms / 16766ms), with callers absent.
- Locked isolated maintainer dependencies: `npm ci --prefix
  tools/plugin-validation --ignore-scripts` installed three packages, audited
  four, zero vulnerabilities. The complete downloaded `install.cjs` was read:
  it only resolves the already-installed optional native package and links/
  copies its binary into the owned ignored dependency tree; it has no network
  download or provider path. That local setup then ran in a fresh clean HOME/
  TMP environment, status zero with immediate owned cleanup. Both runtime
  maintainer validations executed the unchanged package command, marketplace
  validation and strict plugin validation, and passed zero/no signal in
  809ms / 647ms. Fresh HOME/npm config/cache and disabled nonessential traffic/
  telemetry avoid actual user configuration or model calls. Raw install/setup/
  validation logs and ownership/result records are retained; no tracked
  dependency/lockfile change occurred.
- Final read-only evidence audit `final-gates-summary.json` independently
  checks all eleven full test-log footers, the 84-file core aggregate and
  fourteen owned gate result/actual scratch records. The parser-postcheck
  defect remains explicit in the original adapter record plus separate audit.
  The earlier live log's complete 342-pass/30-skip summary and its separate
  UNKNOWN parent-chain exit remain explicit; no original failure, skip or
  interruption is washed away by later green results.
- Primary caller acceptance also checked `mixed-ingestion-diagnostics.mjs`
  and all `invalid_classification` consumers. The mixed observer uses the
  core emitter's finite vocabulary, not a second allowlist. Primary personally
  ran `emitDiagnostic` → `createMixedModelDiagnosticObserver` → `snapshot`
  with all eight added reasons on both exact runtimes: eight retained, zero
  omitted, no providers/writes. This root-owned evidence is in its tool
  transcript and root plan; no additional caller patch or test pin is needed.

## Final local verification — historical candidate 79f2dc5

All logs below are under `/tmp/cairn-classification-reasons-logs.HHPcHn`.
Every final command uses the exact pinned Node binary and parent compile cache
disabled. Resource-controlled equivalents use the unchanged package file
roster and runner with `--test-concurrency=1`; they are not falsely labeled
literal npm commands. Intentional installed/Hermes opt-in skips remain visible.

| Gate | Node 22.16.0 evidence | Node 24.15.0 evidence |
| --- | --- | --- |
| Generic | `final-node22-test-serial-rerun.log`: 580/580 | `final-node24-test.log`: 580/580 |
| JSON validation | `final-node22-validate.log`: passed | `final-node24-validate.log`: passed |
| Core | `final-node22-test-core.log`: 1142/1142 | `core-node24-shards-summary.json`: exact 84 files, 1142/1142; equivalent local coverage |
| OpenAI adapter | `final-node22-test-openai.log`: 320/320 | `final-node24-test-openai-serial-rerun.log` + footer audit: native zero, 320/320 |
| Store / MOC demos | `final-node22-demo-store.log`, `final-node22-demo-moc.log`: passed | `final-node24-demo-store.log`, `final-node24-demo-moc.log`: passed |
| Offline OpenAI demo | `final-node22-demo-openai-offline.log`: passed | `final-node24-demo-openai-offline.log`: passed |
| Live offline | `final-node22-test-live-evidence-offline-serial-rerun.log`: 342 passed + 30 expected skips | `final-node24-test-live-evidence-offline.log`: 342 passed + 30 expected skips |
| LongMemEval | `final-node22-test-longmemeval.log`: 193/193 | `final-node24-test-longmemeval.log`: 193/193 |
| Public demo | `final-node22-demo-longmemeval-public.log`: passed | `final-node24-demo-longmemeval-public.log`: passed |
| Workspace lifecycle | `final-node22-test-workspace-lifecycle.log`: 25/25 | `final-node24-test-workspace-lifecycle.log`: 25/25 |
| Maintainer schemas | `final-node22-validate-maintainer.log`: marketplace + strict plugin passed | `final-node24-validate-maintainer.log`: marketplace + strict plugin passed |

No required local gate remains. There is no repository typecheck. Store/MOC/
OpenAI example databases keep their documented intentional synthetic retention;
test caller roots are removed after child closure. Eight runtime/test freeze
hashes still match, and the worktree contains only the twelve scoped files.
Local candidate commit metadata/diff evidence will be recorded separately in
`candidate-commit.json` after this final plan is committed, avoiding a
self-referential commit hash. Fixed base remains
`7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`; branch is
`fix/classification-rejection-reasons`. The primary owns final byte-bound
acceptance, independent Standards/Spec review and ordinary latest-head CI.
No push/merge/release is authorized at this checkpoint, and exact historic
classification cause and semantic accuracy remain unknown.

## Independent review amendment — compensated sparse parent arrays

Independent review of `79f2dc5538d97594e37d303e7c0a38cedacb2dcc` reported
Standards: zero hard findings and one nonblocking finite-vocabulary duplication
smell. Spec reported a genuine CR5 gap: a parent array with one valid indexed
value, length two, one missing indexed slot and an extra enumerable canary key
can compensate `Object.keys` cardinality. `map` skips the hole and its Set can
include `undefined`; the malformed array can consequently pass `uniqueIds`,
`placementProposal` and actual classification. The gap predates this candidate.

Primary explicitly amends CR1 preservation to valid dense proposals/results,
authorizing only rejection of these malformed compensated sparse parent arrays.
Normal JSON/provider schemas, prompts, limits, accepted dense filing, public
failure codes, retry behavior and post-admission cold retention remain unchanged.
Direct placement rejects malformed arrays with the existing `invalid_input`;
classification rejects with existing `invalid_model_output` and only the exact
finite generic `invalid_classification` diagnostic. No canary, ID or extra array
key may enter an event. This is deliberate malformed-input acceptance tightening,
not recovery of the historic live rejection cause or a semantic accuracy claim.

Review correction remains in this same worktree/branch and fixed base. First add
a RED-capable regression for compensated sparse L1 and L2 parents at direct
placement and the real classify seam, including observer hostility/no retry.
Trace every `uniqueIds` consumer and the shared `denseArray` helper; after an
observed RED, prefer the smallest reuse of existing own-index validation. Do not
redesign unrelated memory guards, object validation or getters. No runtime fix,
test/import execution or gate begins while the separate packet owns the heavy
slot; primary will coordinate a short RED/GREEN window. The old candidate, full
gates and raw logs remain historical evidence, not acceptance of the amended
source. A new source freeze, primary key acceptance, affected checks and both
independent review axes are required for the next HEAD. No push/merge/provider
call is authorized.

Static readiness: three new RED-capable tests in the existing rejection test
file cover both parent roles independently at direct placement/`uniqueIds`,
real `classify`, and SQLite-backed public `classifyPlacement`. Each fixture
proves key-count compensation and the missing own index, keeps a visible valid
parent, and asserts existing public codes, only the frozen generic diagnostic,
canary/ID absence and one model call. Public-core cases seed actual L1/L2 topics,
verify unchanged map/card/receipts and cold reread, and register immediate
workspace teardown before assertions. Hostile synchronous/asynchronous observers
are included. Tests have not been imported or executed, and runtime remains
unchanged pending the primary's RED/GREEN slot.

Caller trace: `uniqueIds` serves L1 parents, L2 parents, derived proposal target
IDs and public `classifyPlacementValidated` input memory IDs. `placementProposal`
also gates `applyPlacement` and `applyInitialPlacement`; classification wraps
its validation error at the existing rejection seam. Shared `denseArray` in
`core/validation.mjs` already applies the same array/bounds/key-count checks plus
`Object.hasOwn` for every index. Reusing it inside `uniqueIds` is the proposed
minimal correction after observed RED; unrelated `memoryGuards`, items/object
and getter behavior remains outside this amendment.

Observed RED before production correction: Node 22.16.0, cache disabled,
`review-correction-control.mjs red review-node22-compensated-sparse-red` runs
the proposed focused command unchanged. Actual child status one/no signal,
zero passed/nine failed (three parent tests plus six role subtests), no skips/
cancellations/TODOs, 561ms. Direct placement fails only "Missing expected
exception"; actual classify lacks `invalid_model_output`; both public-core
role cases reach successful `result.ok === true` after actual visible-parent
seeding, failing the expected refusal. These are the intended seams, not setup
errors. Production placement SHA before/after remains the historical
`b15ac186b2c20a8559bbfe4c2c8b1a331c5e900d4b5f451b630bb744a00797ed`.
Owned caller `/tmp/cr22-T4XOeV` is absent, with streamed raw log/footer/status/
cleanup retained. Missing density validation is the causal explanation;
visibility/provider-only explanations cannot explain direct placement acceptance.

After that observed RED, the correction imports and calls existing `denseArray`
inside `uniqueIds`, replacing only its duplicated array/bounds/key-count checks.
Identifier normalization and duplicate callbacks remain in their original order.
Protocol, limitations and changelog explicitly disclose the deliberate malformed
acceptance tightening. Unrelated memory guards/object/getter handling is unchanged.

Bounded GREEN is complete with no overlap: focused new review cases 9/9 on
Node 22.16.0 (458ms) and Node 24.15.0 (493ms); combined three-file key checks
35/35 on each exact runtime, zero failures/skips/cancellations/TODOs. Commands
use concurrency one, explicit TAP, disabled compile cache and short owned TMP
callers. All five RED/GREEN callers are absent after actual child closure;
placement SHA remains unchanged during every invocation. Full raw/status/
ownership/cleanup records are `review-node22-compensated-sparse-red`,
`review-node22-compensated-sparse-green`,
`review-node24-compensated-sparse-green`,
`review-node22-combined-key-green` and `review-node24-combined-key-green`
under the existing raw-log directory. The new actual eight-file freeze is
`review-source-sha256.txt`; historical candidate/full-gate freeze remains intact.
The bounded slot is returned to primary for its own key reruns. No full matrix,
candidate correction commit or push starts during this handoff.

Primary's subsequent affected-check plan, after the other packet releases its
full-gate slot: full core both exact Nodes (regenerated exact 84-file manifests,
1151 expected tests, disjoint complete-file equivalence allowed), store/MOC
demos both, full adapter both, full `public-pilot.test.mjs` both, full LongMemEval
and public demo both, JSON validation both. Narrow full pilot coverage is not
called a full live-suite rerun; original 372-test live evidence remains historical.
Generic 580-test, lifecycle 25-test and maintainer schema results may carry
forward only after actual changed-file/import tracing proves no dependency on
this correction. Ordinary latest-head all-CI remains mandatory. Any additional
affected requirement must be raised before omission. Primary key acceptance and
both independent axes must bind to the next committed candidate; no commit or
push yet.

Primary correction acceptance is complete, as reported by root without worker
access to its private directory. Its exact-version, cache-disabled, concurrency
one three-file checks passed 35/35 on Node 22.16.0 (6908.752738ms) and Node
24.15.0 (11644.695843ms), with zero failures/skips/cancellations/TODOs. Actual
child PIDs 50301 and 56793 closed zero without signal. Root verified each owned
caller identity, empty-only removal and all eight source SHA256 values before
and after against `review-source-sha256.txt`. Root's retained, mode-600/fsynced
raw logs are `/tmp/cairn-six-diagnostic-primary.F3Skmd/CR-CORRECTION-PRIMARY-22.16.0.log`
and `/tmp/cairn-six-diagnostic-primary.F3Skmd/CR-CORRECTION-PRIMARY-24.15.0.log`.
These are root-supplied facts, not worker inspection of private artifacts.
Six production/test freeze values remain historical-candidate-identical; only
`core/placement-input.mjs` and the existing core rejection test have new bytes.
Root has returned the heavy slot to the separate packet. This worker remains
static-only until that packet's final release; no further gates have started.

Affected-gate tracing supersedes the conditional generic carry-forward above.
Five generic architecture test files dynamically import `core/contract.mjs`:
`small-candidate-model`, `checklist-model`, `augmented-model`,
`query-evidence-checklist` and `full-label-model`. More decisively,
`synthetic-lineage.test.mjs` imports `evaluation/architecture/synthetic-lineage.mjs`,
which imports the contract and actually calls `core.capture`, reaching the
corrected placement validation. Primary explicitly accepts full generic
580-test reruns on BOTH exact Nodes as affected coverage; no dependency-free
generic carry-forward claim remains. Workspace lifecycle tests import only
unchanged workspace/runner helpers and built-ins. Maintainer validation checks
unchanged marketplace/plugin manifests against the same locked schema tool,
without importing corrected core modules. Primary permits those historical
25-test lifecycle and maintainer results to carry forward on this actual trace;
ordinary latest-head all-CI remains mandatory. Remaining correction gates are
full generic, exhaustive full core, full adapter, full public-pilot test file,
full LongMemEval, store/MOC/OpenAI-offline/public demos and JSON validation on
both exact runtimes. Pilot-file reruns are not represented as full live-suite
reruns. All gates remain synthetic/offline and serialized by packet.

Bounded core strategy assessment uses retained old Node 24 records, not new
test execution: all 84 file controls total 1,777,526ms (29.63 minutes). Seven
files above 60 seconds account for 1,268,958ms (21.15 minutes); 66 files at most
15 seconds account for 253,941ms (4.23 minutes). Keep long files and deadline/
timer-sensitive files isolated at concurrency one, including the original D3
file. Pair only proven short, non-deadline files in disjoint controls at native
`--test-concurrency=2`; run exactly one owned control at a time, with ordered
streamed TAP, exact version/cache header, PID/root/status/counts and cleanup.
Regenerate an independent manifest from direct regular-file directory entries,
freeze every SHA, and prove exact 84-file union with no omissions/duplicates and
1151 aggregate tests per runtime. Historical manifests and interrupted logs
stay unchanged. The operational five-minute target is not an enforced timeout;
whole long files retain their original assertions and timers. Estimated core
wall time remains roughly 25–30 minutes per runtime, not a speed guarantee.
No monolithic interrupted command is silently retried and no new assertion
failure is automatically retried. Controller preparation is static until the
explicit final heavy-slot handoff; affected gates and a new local candidate
commit are still pending.

Primary explicitly handed the exclusive affected-gate slot back after the other
packet closed all of its gate children and artifact inspection. Worker-owned
`correction-affected-control.mjs` now runs fixed offline commands with exact
runtime/cache headers, ordered streamed logs, known owned PID/caller identity,
native status/signal/termination, finite TAP/spec footer parsing and eight-file
SHA checks before/after each child. It never overwrites previous logs, changes
assertions/timers or automatically reruns a failure. Node 22 generic starts with
`node integrations/client/testing/run.mjs --test-concurrency=1 --test-reporter=tap`
followed by the exact regular-file package patterns' expanded paths. Adapter
uses unchanged `npm run test:openai`; pilot and LME use the existing owned runner,
concurrency one and TAP. JSON/demos use their unchanged npm package commands.
All parent/child compile caches are disabled.

The new direct-directory core freeze is `correction-core-manifest.json`, SHA256
`ffc5d7e94eee8efc2ee63754d09daa9e9bca49991a73a2d05c93780ded6b05be`.
It contains all 84 regular test files, independently frozen SHA values and 82
disjoint controls: 80 isolated files and two adjacent, pure-input pairs at
concurrency two. Pair eligibility is conservative: explicit helper/prompt names,
retained old duration at most 15 seconds and no direct deadline/timer expression;
all other files remain isolated at concurrency one. Original D3 and long files
are isolated. Aggregate acceptance requires the direct directory exact union,
all current hashes, every raw footer/status/cleanup binding, no duplicates or
omissions, and 1151 passed/zero other counts on each exact runtime. This is
equivalent exhaustive local coverage, not a canonical single npm invocation.

Corrected full generic Node 22.16.0 is closed: 580/580 passed, zero failures,
skips/cancellations/TODOs, 245297ms, actual child PID 1457 native status zero/no
signal/no controller termination. Owned caller `/tmp/cr22-MOLcoF` was verified
empty and removed. All eight sources match before/after. Raw
`correction-node22-generic.log` SHA256 is
`1c1cf86e3731c4ef0f0e70c20f0f503e7f489cc4fcfec4227c18e8154280525d`,
with immutable adjacent status/ownership JSON records. Node 24 generic continues
unchanged as the sole child. Primary requested a new safe inter-gate handoff for
the separate packet's independent-review correction: do not interrupt this
child, but after its full closure/cleanup pause before validation/core and
return the exclusive slot. Completed generic evidence is retained and will
not be repeated. This scheduling change does not alter coverage or guard limits.

Corrected full generic Node 24.15.0 subsequently closed 580/580, zero failures,
skips/cancellations/TODOs, 254696ms. Actual child PID 87644 closed zero/no signal/
no controller termination. Owned `/tmp/cr24-FczxHD` was verified empty and removed;
all eight source hashes match before/after. Raw `correction-node24-generic.log`
SHA256 is `94f92e7ea83ec23950e428f59e57e91379ef1488448f2faea699a94097bc2d6e`.
Both owned generic controls are closed and the worker explicitly released the
exclusive slot before starting validation or core. No verification child remains.

Primary's subsequent CONTRIBUTING reread strengthens the corrected-candidate
matrix to the FULL offline live-evidence suite on both runtimes, superseding
pilot-only coverage above; that full suite includes the pilot file, so no
redundant subset is needed. Historical live 372-test runs stay separate.
Primary permits the full regular-file manifest expansion through the unchanged
owned runner at concurrency one/TAP as an explicitly equivalent invocation;
this controller uses options before the exact file paths, not a claim of literal
npm invocation. Live roster and all file hashes are verified before/after, with
actual full footer counts and the existing intentional installed/provider skips
reported separately. No filters, new skips, assertion/timer change or semantic
corpus test is introduced. Execution waits for the next explicit slot return.

External controller evidence history: both generic runs and manifest freeze
used initial controller SHA256
`6670e3dbf02fdf7967915e3e1e15b2b5b61625819b79f5d238fba253b33eceb6`.
After their closure, the verification-only controller adds full-live selection,
whole gate-file hash/roster checking and its own SHA field for subsequent
records. Previous raw logs and JSON remain immutable; runtime/test bytes do
not change. This is evidence-controller preparation only while another packet
owns execution.

While paused, primary's verification-controller audit found an envelope safety
gap: a metadata-write failure after spawn could enter `finally` before actual
child closure and remove an empty owned caller. The external controller now
tracks closure only from the child's actual `close` callback, installed
immediately after spawn. Cleanup in `finally` requires confirmed closure or no
spawned PID; otherwise the exact owned PID/root and closure-unknown status are
retained in a separate record, without killing or sweeping. Spawn errors do
not resolve the completion promise before close. Counted gates also require
exactly one anchored TAP/spec footer for each of six fields; occurrence counts
are retained and exhaustive core aggregation verifies them and closure. Initial
generic records and all product/source files remain unchanged. Revised external
controller SHA256 is
`17754c0208372de49241842b65f2f842cebde6b0eb00353620c75cdd10a74a05`.
No gate or controller import was executed while preparing this metadata-only
correction; independent envelope review remains primary-owned before resuming.

Primary inspected the actual revised envelope and reported an independent
NONAUTHOR control review with zero findings on the exact `17754c...` controller
SHA. This is external verification-envelope acceptance, not the renewed product
Spec review. Primary independently checked the direct 84-file roster, manifest
SHA, disjoint 82-chunk union and all eight source hashes. After its separate
packet's correction and personal checks closed, primary explicitly returned
the sole local heavy slot. No accepted generic run is repeated.

Corrected `npm run validate` passed on both exact runtimes: Node 22.16.0 199ms
(PID 7108, owned `/tmp/cr22-dxVgmj`) and Node 24.15.0 117ms (PID 7210,
owned `/tmp/cr24-brhFQc`). Both actual children closed zero/no signal/no
termination; caller identities were checked by the unchanged helper and empty
callers removed. Eight-file source checks match before/after. Their immutable
`correction-node22-validate` and `correction-node24-validate` raw/status/ownership
records bind controller SHA `17754c...` and raw SHA values. Node 22 exhaustive
core controls begin next under the same frozen manifest and envelope, with
long/deadline files isolated and streamed progress retained.

Corrected affected matrix is fully closed on both pinned runtimes. All commands
use disabled parent/child compile caches and fresh owned callers; none changes
assertions, timers, caps, skip policy or product defaults. Generic, core, live
and LME commands are documented resource-controlled equivalents through the
same package-owned runners, with their complete regular-file path unions.
Adapter, JSON validation and demos use the unchanged literal npm commands.
The core command per control is `node tools/testing/run.mjs
--test-concurrency=1|2 --test-reporter=tap <manifest chunk paths>`; only the two
named pure-input pairs use two. Live/LME use concurrency one and TAP followed
by the exact direct-directory complete regular-file list. No pilot-only subset
is substituted for the full corrected live suite.

| Corrected affected gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Generic | 580/580; 245297ms | 580/580; 254696ms |
| JSON validation | exit 0; 199ms | exit 0; 117ms |
| Exhaustive core, 84 files / 82 controls | 1151/1151; 1096912ms | 1151/1151; 1083227ms |
| Full OpenAI offline adapter | 320/320; 105269ms | 320/320; 95879ms |
| Full live-evidence offline | 342 passed + 30 existing intentional skips / 372; 255814ms | 342 passed + 30 existing intentional skips / 372; 238655ms |
| Full LongMemEval offline | 193/193; 14549ms | 193/193; 13351ms |
| Store demo | exit 0; 243ms | exit 0; 217ms |
| MOC demo | exit 0; 275ms | exit 0; 262ms |
| OpenAI-offline demo | exit 0; 878ms | exit 0; 1008ms |
| Public LongMemEval demo | exit 0; 355ms | exit 0; 327ms |

Every counted gate has zero failures/cancellations/TODOs; all except the full
live suite have zero skips. The 30 live skips are the unchanged explicit
installed/provider opt-in skips, not failures or all-passed claims. Core times
are sums of complete control elapsed times, not a canonical single npm run.
Root personally independently audited all 82 raw/footer/ownership/closure
records per runtime, the direct 84-file exact union, all current file hashes,
eight source hashes, controller SHA, private mode 600 and caller absence, and
accepted 1151/1151 on each runtime. The exhaustive equivalence and original
unknown-interruption caveats remain explicit.

Actual raw/index evidence is in the existing owned log directory:
`correction-node{22,24}-{generic,validate,adapter,live,lme,demo-store,demo-moc,demo-openai,demo-public}.log`
with adjacent immutable `.json` and `-ownership.json` records;
`correction-node{22,24}-core-000` through `-081` raw/status/ownership records;
and both `correction-node{22,24}-core-summary.json` records. Fresh read-only
`correction-final-audit.mjs` verified all raw SHA values, unique anchored six-field
footers, native exit/signal/actual closure bindings, exact live/LME/generic
directory unions, all before/after hashes and current caller absence. Its
mode-600/fsynced `correction-final-gates-index.json` SHA256 is
`70451cb17b156346168a1b18e22fe8f7949b4f360a0309c444282b7cec218926`.
It indexes 18 ordinary gate children and 164 core gate children (182 actual
spawned children); the orchestration cell additionally performed two read-only
aggregate controls, then closed naturally with its original queue empty and
no active child. No unexpected failure, retry or signal occurred in this
corrected affected matrix. The sole heavy slot was explicitly released before
static plan/candidate work; the primary's next packet may proceed.

Six demo callers remain intentionally nonempty with only their recorded
synthetic demo outputs: Node 22 store `/tmp/cr22-T0Cc9Q/cairn-store-demo-aIJmZK`,
MOC `/tmp/cr22-uOWhJw/cairn-moc-demo-UrciCq`, OpenAI-offline
`/tmp/cr22-6LtQ23/cairn-openai-offline-Js4kl1`; Node 24 store
`/tmp/cr24-pVuIGY/cairn-store-demo-lGakiF`, MOC
`/tmp/cr24-UsBK2b/cairn-moc-demo-yCFao5`, OpenAI-offline
`/tmp/cr24-bDcaYO/cairn-openai-offline-QmF7JF`. The index independently verifies
the exact retained directory entries. They are intentional demo databases,
not unknown live children or accidental test residue. Every other owned gate
caller is absent. No sweeping or historical cleanup was performed.

Scheduling evidence clarification: primary briefly requested a Node 22
inter-gate handoff. A separate orchestration-store inspection returned stale
pre-loop state; its attempted queue truncation did not establish a live pause.
Primary rescinded that request before any cancellation or signal was sent.
The actual running cell retained the approved full queue, naturally completed
all 184 control invocations and verified every required actual raw record.
This is an envelope/state-observation issue, not a test/product failure, and
is not evidence explaining either historical status-143 interruption.

Lifecycle 25/25 on both runtimes and locked maintainer schema gates carry
forward only on primary-approved unchanged-import/manifest proof. The final
index compares the actual four workspace/runner files, locked tool manifest/
lockfile and marketplace/plugin JSON bytes to committed historical candidate
`79f2dc5538d97594e37d303e7c0a38cedacb2dcc`; all are identical. Neither helper
tests nor the local schema command imports the corrected placement module.
Ordinary latest-head full CI is still required after eventual authorized push.
There is no repository typecheck. No corpus/gold/private study, provider model
call, production mutation, deployment, merge, batch policy or paid-runner
change was introduced.

After this final plan is committed, the worker-owned
`correction-candidate-commit.json` records the actual new local HEAD, historical
parent, fixed base, exact combined 12-file roster, diff SHA and the eight
committed/current/frozen byte bindings. Keeping the self-referential commit
hash in that external record avoids changing a frozen commit to name itself.
Renewed NONAUTHOR Standards and Spec review, final primary byte binding and
ordinary latest-head CI remain primary-owned. No push is authorized by this
worker's completion; the new candidate stays local pending those checks.

Primary subsequently reported acceptance of the entire corrected affected
matrix after personally checking the final live/LME/public-demo raw counts,
ownership/closure, whole gate hashes and all eight current source hashes. Its
earlier personal 35/35 checks on both runtimes still bind to the same unchanged
runtime/test bytes. This is primary acceptance of current frozen content;
renewed dual NONAUTHOR product review and final committed-byte binding are
still required before primary-owned push/CI delivery.

## Acceptance evidence ownership

| Contract | Evidence / owner |
| --- | --- |
| CR1, CR4 | Worker: real core capture + fake adapter; cold cards, receipts, initial journal status and exact no-retry transport count; public error code unchanged |
| CR2 | Worker: fixed local categories observed at original rejecting seams, explicit allowlist, frozen exact v1 events; no diagnostic revalidation |
| CR3 | Worker: exhaustive finite categories; both title roles, 121 points, UTF-16 boundary, NFKC expansion, empty/redacted/NUL, cardinality/membership, parent visibility and create policy; direct errors retained |
| CR5 | Worker: canary+IDs absent from exact events, hostile error fields ignored, sparse/getter/malformed fail closed, observer throw/reject/mutation cannot change outcomes; immediate workspace teardown registrations |
| CR6 | Worker: protocol finite threat/privacy surface, changelog and limitations explicitly preserve unknown historic cause and avoid accuracy/score claims |
| CR7 | Worker: corrected both exact-runtime affected matrices closed, 1151/1151 exhaustive core unions, generic580/adapter320/LME193 and full live342+30 intentional skips; unchanged lifecycle25/schema carry-forward proved; final raw index and local candidate byte binding; renewed independent review/primary binding/latest-head CI remain root-owned |

No UI/browser replay, old URL migration, extraction/recall runner change or
new semantic policy is involved. Existing `uniqueIds` consumers in
`classifyPlacementValidated` keep their original valid-dense-input results and
error codes; the explicitly amended density check rejects malformed sparse
arrays that previously slipped through key-count compensation.
Diagnostic events expose no timing/cost/token measurements; historic runtime
measurements remain unknown. Verification elapsed times above are owned local
test evidence, not model accuracy or runtime-observability measurements.
No primary implementation takeover occurred. Fixture and external evidence
corrections are explicitly recorded above.
