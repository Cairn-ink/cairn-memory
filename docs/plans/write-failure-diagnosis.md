# Write failure diagnosis: execution before scores

Status: prospective offline diagnostic contract, not a historical cause or fix.
DRI: primary delivery agent. One implementation worker: GPT-6.1 Sol/high.
Fixed base: `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4` (`origin/main`).
Worktree: `write-failure-scaling`; branch: `diag/write-failure-scaling`.

## Goal and retained limits

The product target remains one lightweight, independently runnable public memory
core shared by MCP, Hermes and other harnesses, with source-faithful updates and
inspectable current/history/rationale evidence. Scores are evidence, not the
product, and benchmark accuracy is not required to be 100 percent.

The older official indexed-evidence six has a capture timeout after five of 45
batches. It lacks causal phase records. The more recent closed six instead has
an extraction count-transport failure after fourteen of fifty batches. Its
trusted parent discarded the underlying reason. These are separate failures;
neither historical cause can be recovered merely by passing an offline probe.
No old case replay, paid run, stopped-run continuation or new stop policy is
authorized here. No real corpus, answer, evaluator, key, operational book or
private output may be accessed by the worker or reviewers.

## Stage D: bounded diagnostic loop

- D1: Construct a deterministic, keyless loop through real public core, OpenAI
  adapter and, where applicable, real experiment guard plus an invocation-owned
  synthetic ledger. Network is fake and explicitly denied outside the injected
  transport. Use new synthetic messages only. Show the exact command and
  retained failure output before any runtime correction.
- D2: Separate a healthy direct capture, healthy guarded capture, entered-fetch
  rejection and timeout/cancellation controls. State any boundary not exercised
  (private credential parent, v3 operator, native arm, full mixed runner, scoring).
  Do not silently replace those boundaries with mocks and call it product proof.
- D3: Observe setup separately from capture. Compare small and larger valid
  synthetic ledger histories with identical source, model output, number of
  physical fake requests and transport delay. Use fixed sizes and record ledger
  validation/work counts alongside monotonic elapsed time. A synthetic bulk seed
  is allowed only inside a new owned fixture. Validate the empty ledger and bind
  its baseline policy first as required by the public API, closing that setup
  handle. Validate the completed seeded ledger through the public API before
  history-dependent benchmark/case-capability binding. Never seed or inspect an
  actual book.
- D4: Retain finite phase/outcome evidence without messages, bodies, credentials,
  arbitrary exception text, headers or cause chains. Timing is partial and
  evaluation accounting overhead is not product-only/provider latency.
- D5: Build a genuine health assertion that fails with an injected failure and
  succeeds when ONLY the injection is removed. Also retain accounting assertions:
  failed unknown requests keep full reservation; no pending request or further
  physical fetch after a global halt; prefix integrity and caps remain enforced.
- D6: Every fixture registers cleanup immediately, closes resources before
  removal and verifies success and failure leave no unexpected owned residue.
  Use the canonical testing runner and both Node 22.16 and 24.15. Prefer seconds
  over minutes; timeouts used to accelerate a test must be explicitly test-only.
- D7: Before runtime edits, checkpoint test/source hashes, actual commands,
  failure/minimization evidence and remaining unknowns to the primary. The
  primary independently verifies the seam and records falsifiable hypotheses.
  If no defect reproduces, report that outcome; do not invent a fix.

Allowed initial changes: this plan, one focused test under
`evaluation/experiment-budget/test/`, and at most one narrowly scoped helper
under `evaluation/experiment-budget/testing/`. The worker may read existing
public contracts/tests. Production edits, package/CI changes or private helper
copies require a primary scope checkpoint. No model, prompt, MOC, schema,
dependency, context limit, timer, retry or stop-policy changes are assigned.

## Stage F: correction and long-write acceptance (conditional)

Only a demonstrated defect advances to a minimal correction. Preserve the
pre-edit failing test, verify the corrected test and original seam, and check
normal public capture at fixed synthetic long-history sizes through cold reopen.
All planned batches must complete in healthy controls; retained source and
qualified data must remain unchanged; injected failures must not corrupt earlier
data. Classification-partial admission and extraction failure remain distinct.
No extrapolation to real-model completion, memory quality or product readiness.

The primary defines the exact runtime scope and required full gates after Stage
D evidence. Generic `npm test` and `npm run validate` apply to delivered changes;
budget/guard/core/OpenAI/LongMemEval/installed gates apply according to actual
callers and CONTRIBUTING. No typecheck exists in this JavaScript repository.
Record all failures and corrections. Freeze a scoped candidate, obtain separate
non-author Standards and Spec reviews, personally rerun key paths on both Nodes,
then push a PR and monitor its exact-head CI. No self-merge/release/deployment.

## Subsequent checkpoints, not passes

1. Source/decision reliability: stored, visible, selected and packed evidence;
   current/history/reason and supported updates in a new session.
2. A separately authorized, frozen new small paid comparison, then only if
   completion gates permit a broader fixed comparison. All wrong/unresolved
   cases stay in their denominator; the cumulative cap remains US$300.
3. Installed MCP/Hermes lifecycle and measured lightweight resource fit.

## Evidence and dispatch record

Primary reran the existing keyless diagnostic health assertion on 2026-10-02:
`env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script /tmp/cairn-count-transport-probe.HIRmrv/probe-source2.mjs --expect-healthy`.
Healthy capture succeeded with two fake fetches. Injected count-fetch rejection
entered once, returned extraction_failed, retained one full unknown reservation
and halted, then the SAME health assertion failed at line 136 (`false !== true`).
Owned workspace removal was true. This proves a diagnostic seam only; it neither
identifies the live transport cause nor exercises the historical timeout.

The source above stays private and immutable and will not become a dependency
of a public test. Public Stage D must be self-contained, with any missing private
boundary explicitly documented. Root primary worktree is unchanged; unrelated
wiki untracked files remain untouched.

Initial worker setup corrections: a deferred seed `DatabaseSync.close` needed
explicit closed-state handling because close is not idempotent. The first
binding attempt then failed `policy_binding_missing`: baseline policy must be
bound while the new ledger is unused. D3 above is clarified to respect that
existing API, not change or bypass it. These are fixture setup failures, not
reproduced capture failures or measurements of the live cause. No production
source has changed.

### Public Stage D checkpoint

Worker: GPT-6.1 Sol/high, assigned the actual test implementation at fixed public
base `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`. Only the focused test and one
self-contained helper were implemented; no private helper was copied. The
primary subsequently authorized technical evidence documentation and one
focused step in the existing Node 22/24 experiment-request-guard CI job, with
package scripts and runtime sources unchanged. There is no typecheck gate.

Initial accepted Stage D SHA-256 values (before the later one-point extension):

| File | SHA-256 |
| --- | --- |
| `evaluation/experiment-budget/test/write-failure-diagnostic.test.mjs` | `d67bdafa697989e99d267efa8c3608673814d0a27e08d5b2fe7ab7e8b2aa71da` |
| `evaluation/experiment-budget/testing/write-failure-diagnostic.mjs` | `a132620581499ac0e0e2bc3234c3fa1acf6cd86d562ae80ee323c7f5a9119c6f` |
| `core/model-call.mjs` (unchanged) | `eed76a63c4f9439e4e228b0ed948db1c082d074e5ce63c7900d56d39cfca6abf` |
| `adapters/openai/index.mjs` (unchanged) | `68a3394f1dbbbc73c2f1a492421c4c963a754d1d4e61ec42ffc80f83d6fdc1c0` |
| `evaluation/experiment-budget/index.mjs` (unchanged) | `daac7a41115991db520f91a93345e7f93ed6eeb8c005b80d61cb352f295f026b` |
| `evaluation/experiment-budget/request-guard.mjs` (unchanged) | `afec0ce8b3037bded6cefbf7e04a2debbf2a489b55979ec564ec07064bb883c3` |

The exact Node 24 focused invocation was:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/experiment-budget/test/write-failure-diagnostic.test.mjs
```

The exact Node 22 invocation substituted `v22.16.0` in both executable paths.
The pre-extension frozen worker runs were sequential and each exited 0 with five tests
passed, zero failed, skipped or cancelled (10.88 s / 10.96 s respectively).

The minimal command used the same fixture, input and health assertion:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script evaluation/experiment-budget/testing/write-failure-diagnostic.mjs --injection=count-rejection --expect-healthy
```

It exited 1 with `AssertionError: all planned captures must complete`,
`0 !== 1`. Before that assertion, its finite report retained `extraction_failed`,
one entered physical count fetch, `transport_failure`, one full 5,000-micro-USD
`unknown` reservation with null actual cost, global halt, zero pending attempts
and `cleanupRemoved: true`. Changing only `--injection=count-rejection` to
`--injection=none` exited 0, completed one capture, retained its exact source
after cold reopen and made four physical fake requests. The focused suite
executes both commands in real subprocesses on both Nodes and asserts that
their owned parent scratch is empty after each success/failure.

Healthy three-batch controls used identical sources, default model, output and
zero-delay one-attempt fake transport. Ledger histories were pinned to 16 and
4,096 settled attempts, including one fully reserved terminal unknown. Empty
public validation/baseline binding preceded linear fixture seeding; the fully
seeded book passed public inspection before history-dependent binding.

| Runtime/control | Setup ms | Capture ms | Setup full reads / returned attempt rows | Capture full reads / returned attempt rows |
| --- | ---: | ---: | ---: | ---: |
| Node 24 direct | 47.77 | 392.56 | 0 / 0 | 0 / 0 |
| Node 24 guarded, 16 | 179.74 | 1,105.34 | 18 / 208 | 74 / 1,628 |
| Node 24 guarded, 4,096 | 370.35 | 2,106.11 | 18 / 53,248 | 74 / 303,548 |
| Node 22 direct | 41.63 | 402.86 | 0 / 0 | 0 / 0 |
| Node 22 guarded, 16 | 202.89 | 1,076.29 | 18 / 208 | 74 / 1,628 |
| Node 22 guarded, 4,096 | 324.76 | 1,899.77 | 18 / 53,248 | 74 / 303,548 |

Every healthy control completed 3/3 batches, made 12 fake requests and retained
three exact sources after cold reopen. The test-only SQL observer counts rows
returned by the exact existing full-validation query; it restores the original
method after each fixture. Quick-check invocation counts equal the full-read
counts here, but internal SQLite page/row work remains unknown. Capture timing
includes partial local core and accounting work, excludes setup and later cold
inspection, and does not isolate product/provider latency. Earlier overlapping
workload runs are not used for latency comparison. No timing threshold proves
causation, and no extrapolation to a 35,812-row operational ledger is made.

Controls cover count/generation transport rejection, external cancellation,
the actual core model timeout, a separately configured transport timeout,
classification failure after admission, prefix tampering, request exhaustion
and monetary exhaustion. Unknown requests keep full reservations; successful
count cost is also unknown, not zero. Each global halt fences further physical
requests, no owned request remains pending, and all untampered historical
prefix rows remain identical. A generation rejection at batch index 1 of three
leaves batch 0 exact after cold reopen, retains one source and sends only six
physical requests; batch 2 is never sent. Classification rejection and caps
retain prior admission rather than masquerading as extraction failure.

The first transport-timeout expectation failed: advancing both real timers to
60 seconds correctly produced `core_deadline`, since core's 30 seconds wins.
This was a control-design error, not a product defect. The corrected
transport-only control binds an explicitly test-only 10 ms count policy and
advances its test clock by 10 ms; core's 30-second timer remains unchanged.
Healthy/core-timeout/cancellation controls keep the normal 60-second guard
policy. Finite reports retain configured policy, closed termination/outcome
labels, bounded model events and dropped counts, but no source, body, key,
header or raw exception. Setup failures above remain retained, not erased.

No natural defect reproduced. This is the ordinary v1/case-deadline guard,
not the embedding-bound-v2/mixed-v3 path. The private credential parent, v3
operator, native arm, full mixed runner, scoring and internal adapter phases
remain unexercised. Neither historical failure has a proven cause, so Stage F
has not opened and no runtime correction is proposed. The primary subsequently
authorized one 35,812-row synthetic one-batch point, recorded below. No
64-batch extension is authorized or run.

The primary's ancillary scripted long-history gate on both Nodes completed
208/208 positive batches with 1,030 admitted memories and eight negative
controls; cold source inspection retained seven passages and packed six, with
zero unexpected results. The default 1,025-row candidate capacity still has its
expected `delivery: false` / `budget_exhausted` result; explicit bounded-keyset
selection delivers but still reports budget exhaustion. This checkpoint is
not full retrieval, a current-choice pass, a paid-run cause or a semantic or
real-provider pass. The primary's Node 22 raw log is intentionally retained at
`/tmp/cairn-write-diagnostic-gates.vkSx7o/primary-long-history22.log`.

Pre-extension primary acceptance independently reran the frozen focused suite on both Nodes:
Node 22 passed 5/5 (9,405.84468 ms), Node 24 passed 5/5 (7,935.200624 ms), with
the same test/helper SHA-256 values. Shared workload makes those elapsed values
non-evidence for latency. The delivery candidate remains diagnostic-only;
independent Standards and Spec review and primary acceptance precede any push.

### Primary D7 hypotheses and their limits

1. If the older 30-second failure exhausted the model-call envelope during
   local preparation, count or generation, phase observations should distinguish
   that work in a future controlled loop. Historical attribution is **untested**:
   this Stage D loop has no internal adapter phase observer and cannot assign
   the old timeout to one of those phases.
2. If full-ledger validation work grows with history, identical captures at
   larger fixed histories should return proportionally more rows from the same
   number of full reads. **Tested for work counts only**: both fixtures perform
   74 reads and the row delta is exactly `74 * (4096 - 16)`. A causal timeout,
   practical resource fit and embedding/mixed representativeness remain
   **untested**, including after the later ordinary-v1 cardinality point.
3. If a count failure occurs before transport entry rather than inside entered
   fetch, prospective finite observations should distinguish that boundary.
   **Tested for the controlled public seam**: prefix tampering sends zero
   requests while injected first-count rejection enters once. The latest
   historical parent envelope discarded that distinction; prospective private
   parent diagnostics cannot recover its old cause and are not exercised here.
4. If the declared basic write configuration deterministically fails without a
   transport fault, the healthy cardinality/source assertion should fail too.
   **Not reproduced** in the healthy fake controls. They exercise ordinary
   plain capture (`extract`/`classify`) with the baseline model and v1 guard,
   not indexed-source qualification, the mixed v3 profile or real-provider
   behavior. This excludes only a basic deterministic failure under the stated
   synthetic configuration, not every write failure.

No natural defect was found, so none of these observations justifies a timer,
model, MOC, retry or stop-policy correction. Stage F remains unopened.

### Delivery verification matrix

All twelve authorized full gate commands completed with actual exit 0 on both
Node 22.16.0 and 24.15.0. Generic results below are the final real `npm test`
command exits and aggregate counts, not substituted file-level results.

| Unchanged npm script | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `test` | 580 passed; 0 failed/skipped/cancelled; exit 0 | 580 passed; 0 failed/skipped/cancelled; exit 0 |
| `run validate` | 10 valid JSON documents; version 0.2.0; exit 0 | 10 valid JSON documents; version 0.2.0; exit 0 |
| `run test:experiment-budget` | 65 passed; 0 failed/skipped/cancelled; exit 0 | 65 passed; 0 failed/skipped/cancelled; exit 0 |
| `run test:experiment-request-guard` | 292 passed; 0 failed/skipped/cancelled; exit 0 | 292 passed; 0 failed/skipped/cancelled; exit 0 |
| `run demo:experiment-budget` | Synthetic two-request accounting demo; exit 0 | Synthetic two-request accounting demo; exit 0 |
| `run demo:experiment-request-guard` | Three fake requests succeeded; exit 0 | Three fake requests succeeded; exit 0 |

Every command used a clean environment and the canonical outer runner, leaving
the existing npm scripts unchanged. For example, the exact generic Node 22
command was:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v22.16.0/bin/npm test
```

The other commands used the same wrapper and respective Node bin paths with
the table's npm arguments. The outer runner also owns/removes demo scratch
that the standalone examples normally retain. The ledger-only demo deliberately
shows one unresolved reservation (600,000 micro-USD reserved over two attempts);
that is its accounting example, not a pending diagnostic request. The guard
demo reserves 37 synthetic micro-USD for its three successful fake requests.
These quantities are not paid charges.

Exact commands, final exit codes, TAP aggregate counts and finite demo
observations are intentionally retained in the primary-owned source-free log
`/tmp/cairn-write-diagnostic-gates.vkSx7o/worker-offline-gate-summary.json`.
They are evidence artifacts, not test fixture residue or a public test
dependency. Gate processes ran concurrently, so their elapsed values supply no
latency comparison. The generic commands advanced through their existing
interruption/decision-table cases before final exits; no partial pipe/file pass
was counted as a complete command pass.

`scripts/README.md` is absent at this fixed public base. The worker inspected
the documented `scripts/validate-json.mjs` directly: it only reads public JSON
and checks version consistency. No operational publisher or production script
was run. Diff/whitespace checks passed, and frozen diagnostic source hashes
still match primary acceptance. CI adds only the exact focused canonical test
step to the existing OpenAI-installed experiment-request-guard matrix; package
scripts, runtime sources and all paid/network policies remain unchanged.

### Authorized one-batch cardinality extension

Before candidate commit, the primary authorized one additional keyless point
at exactly 35,812 settled synthetic historical rows on the same ordinary v1
path. The matching control has 16 rows; both use one healthy batch, identical
source/model/output, four physical requests, zero fake transport delay and the
unchanged 60-second guard policy / 30-second core model envelope. The original
16/4,096 three-batch controls and default `HISTORY_SIZES` remain unchanged.
Only an explicit `CARDINALITY_HISTORY_SIZE` allowlist constant and one focused
test were added; this explains the diagnostic source hash change. Runtime,
budget and guard source hashes remain the earlier fixed values.

| Extended diagnostic file | SHA-256 |
| --- | --- |
| `evaluation/experiment-budget/test/write-failure-diagnostic.test.mjs` | `0655a80201753572dbab1538f4abcb64a04756bfed6e61faf4768db8a57db5ca` |
| `evaluation/experiment-budget/testing/write-failure-diagnostic.mjs` | `7e01edb0ff2ea6577000598cb6cb18cd028c3b8069665e6ab785805b41a666c0` |

The same exact clean-environment canonical focused commands recorded above
passed the extended suite on both Nodes: six passed, zero failed, skipped or
cancelled, exit 0 (Node 24 11,841.081598 ms; Node 22 12,024.820012 ms). The
subprocess RED/GREEN health assertion is still exercised. No unexpected RED
or natural capture defect was observed at the added point.

| Runtime/history rows, one batch | Setup ms | Capture ms | Setup full reads / returned attempt rows | Capture full reads / returned attempt rows |
| --- | ---: | ---: | ---: | ---: |
| Node 24, 16 | 198.09 | 413.07 | 18 / 208 | 26 / 468 |
| Node 24, 35,812 | 1,284.17 | 2,712.01 | 18 / 465,556 | 26 / 931,164 |
| Node 22, 16 | 77.17 | 212.41 | 18 / 208 | 26 / 468 |
| Node 22, 35,812 | 1,359.08 | 2,919.32 | 18 / 465,556 | 26 / 931,164 |

Each control completed 1/1, retained one exact source after cold reopen and
made exactly four requests. Prefix and cap assertions passed; the larger book
ended at 35,816 requests and 55,812 reserved synthetic micro-USD, with no halt
or pending attempt. The deterministic capture row delta is exactly
`26 * (35812 - 16)`. Quick-check invocation counts again match full-read
counts; internal SQLite work is still unknown. Timing remains partial local
work and supplies no threshold, provider-latency or causal conclusion.

This is cardinality coverage for a fresh synthetic schema-v1 book, not an
operational ledger read, embedding-bound-v2/mixed-v3 representativeness,
35,812 real-source captures, a 64-batch gate, paid-run completion, quality or
resource-fit acceptance. No historical cause is recovered and Stage F remains
unopened. Prior generic/budget/guard/demo gate results still apply to their
unchanged callers and scripts; the affected focused path was rerun above.

Primary final acceptance independently reran the extended frozen suite: Node
22 exited 0 with 6/6 (14,335.776404 ms); Node 24 exited 0 with 6/6
(14,562.949679 ms), each with zero failures/skips/cancellations. Both source
hashes match the extended values above. Its raw logs are intentionally retained
as `primary-focused-cardinality22.log` and `primary-focused-cardinality24.log`
inside the approved `/tmp/cairn-write-diagnostic-gates.vkSx7o` directory. Worker
source-free point reports and exact focused commands are retained separately in
that directory's `worker-cardinality-evidence.json`. Shared workload again
precludes a latency conclusion. A scoped local candidate is authorized for
independent Standards/Spec review; no push is authorized before primary review
acceptance.

### Public review round 1 correction

At candidate `fad9b1ff2ded94b0d7dd6ad37a2e4cb543bbba95`, the independent
Standards review found one required-document omission and Spec found none.
`CONTRIBUTING.md` requires `ROADMAP.md` when an evidence gate changes; the
new blocking CI step had no corresponding roadmap entry. The narrow
correction adds one developer-preview bullet linking this diagnostic and its
historical/mixed/paid/semantic limitations, without rewriting old roadmap
history or budget claims. Diagnostic test/helper hashes and all runtime
sources remain frozen. Both review axes must inspect the corrected candidate
before push; the primary owns the additional contributor maintainer gates.

The affected clean-environment canonical `npm run validate` commands passed on
Node 22.16.0 and 24.15.0, each with actual exit 0, ten valid JSON documents
and version 0.2.0. Diff/whitespace checks passed. Exact source-free validation
records are intentionally retained in the approved evidence directory as
`worker-roadmap-validation.json`; this docs-only correction changes neither
the diagnostic callers nor the previously verified full gate scripts.
