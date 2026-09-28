# Capture timeout boundary: offline diagnosis and narrow repair

Base: `304ac6fcb9b71ec2eade579bfb0877e409167e10`. Worktree:
`capture-timeout-boundary`; branch: `diag/capture-timeout-boundary`.

The retained official-six observation is that the sixth knowledge-update
capture failed at `capture/model_timeout`, with extraction diagnostics for a
core call timeout and adapter cancellation. Five earlier batches completed.
This observation does not establish why the provider call stalled, and no
historical batch will be replayed for this change.

## Acceptance contract

1. A fast, deterministic, synthetic offline test reaches public capture,
   the real core model-call wrapper, and the OpenAI adapter with fake HTTP (or
   a narrower existing guard seam if justified). It distinguishes a core
   per-call timeout, caller cancellation, and the capture invocation deadline.
   Record the exact red-capable command and observed result before diagnosing
   or changing production behavior. Include a stable fast success control.
2. Before selecting a fix, record three to five ranked falsifiable hypotheses,
   the caller trace, and the observed boundary behavior. Any repair stays in
   the core model call, capture deadline, or adapter abort path. Preserve model
   and prompt defaults, time limits, call budgets, retry policy, schema, and
   accounting semantics. Propose exact finite diagnostic fields to the primary
   agent before changing a public surface.
3. Verify pre-admission and post-admission failure states. Cancellation must
   neither report complete work nor duplicate storage writes; the initial
   classification journal remains observation rather than a retry queue.
4. New tests use synthetic data, fake HTTP, `createTestWorkspace`, and owned
   runner cleanup on success and failure. Run the focused test and affected
   contributor gates on Node 22.16 and 24.15. Do not access operational data,
   live providers, or prior paid-run files.
5. Negative controls distinguish identical error codes by abort origin. Public
   output and diagnostics remain finite and source-free: no message content,
   IDs, paths, secrets, or arbitrary error strings.
6. State separately any proven local engineering defect and the unproven
   cause of the historical provider timeout. Do not claim a new score or that
   the old paid case is fixed.

The approved observer change adds only the finite `core_call:capture_deadline`
reason for a trusted expired invocation budget. Public failures continue to
use `model_timeout`; the per-call timer continues to report
`core_call:model_timeout`. The observer event retains exactly
`{version,stage,layer,reason}`. A provider-supplied timeout code or forged
abort reason cannot acquire invocation-deadline attribution.
The limiting timer is identified when scheduled: a timer at the 30-second
per-call ceiling, including a tie, retains that reason if a longer invocation
budget expires before its callback finally runs.
Expiry in non-model capture work can still return `model_timeout` without an
observer event; the new reason covers only the core model-call boundary.

## Evidence and handoff

The worker owns this plan and narrowly scoped tests, then sends the primary
agent the caller trace, red result, ranked hypotheses, and exact production
proposal before changing production code. The primary agent owns combined
acceptance, independent reviews, and delivery. Record commands, outcomes,
candidate SHA, and limitations here as work proceeds.

### Reproduction and decision

Implementation owner: bounded sub-agent, GPT-6 Sol/high, from the fixed base
above. The primary agent independently reran the red case and approved the
observer reason before the production edit.

Before the edit, this exact command was run twice:

`node tools/testing/run.mjs --test-concurrency=1 adapters/openai/test/capture-timeout-boundary.test.mjs`

Both runs failed one assertion in under a second: the real public capture with
fake HTTP returned `model_timeout` after an invocation deadline, but the core
observer emitted `model_timeout` where the test expected `capture_deadline`.
The test also confirmed the provider generation callback was entered, its
signal was a genuine core-aborted signal, and no memory, receipt or
classification-journal row was committed. It did not reproduce the historical
provider/network stall.

Caller trace: `contract.capture` → `captureMessages` → `callModel` → OpenAI
`invoke` → `post('/responses')` → fake `fetchImpl`. The core timer marks its
private signal and aborts; the adapter then reports `model_cancelled`. Before
this change the core emitted the same `model_timeout` reason for its per-call
timer and the invocation budget.

Ranked falsifiable hypotheses sent to the primary agent before further probes:

1. The core timer merges two local timeout origins into one observer reason.
   Splitting by trusted deadline expiry should turn the red boundary green
   while leaving its public error code unchanged.
2. Expiry during synchronous token counting can fail before adapter dispatch.
   Forcing expiry there should yield no HTTP call and one deadline reason.
3. Adapter cancellation after a core abort is a consequence of the same abort,
   while a forged caller abort has no private core provenance. Comparing the
   two signals should preserve that distinction even with the same adapter
   cancellation label.
4. The historical stalled generation may have originated at provider, network
   or guarded transport. Local fake HTTP alone cannot discriminate these;
   no retrospective root-cause claim follows from this test.

The proved local defect is observer ambiguity at `callModel`. The retained
official-six case remains a fixed failure: batch index 5 in guard scope 8,
with five completed ingestion batches, one failed and 39 not run. Its final
generation attempt settled as unknown; retained finite metadata has no
generation duration. No paid case was rerun or rescored.

### Verification at candidate freeze

| Gate | Node 22.16 result | Node 24.15 result |
| --- | --- | --- |
| Focused boundary, model-call and capture-deadline tests | 27/27 passed before final collector addition; focused collector 1/1 passed after it | Combined affected files including full public-pilot test: 80/80 passed |
| `npm run test:core` | 1003/1003 passed | Primary acceptance pending |
| `npm run test:openai` | 307/307 passed | Primary acceptance pending |
| `npm run test:longmemeval` | 193/193 passed | Primary acceptance pending |
| `npm run test:live-evidence-offline` | 341 passed, 30 expected skipped, 0 failed (371 total) after final collector addition | Primary acceptance pending |
| Focused `case-deadline-guard.test.mjs` | 21/21 passed | Primary acceptance pending |
| `npm test` | 121/121 passed | 121/121 passed |
| `npm run validate` | Passed | Passed |
| `npm run test:workspace-lifecycle` | 25/25 passed | 25/25 passed |
| `npm run demo:store`, `demo:capture`, `demo:openai-offline` | Passed | Primary acceptance pending |
| `npm run demo:longmemeval-ingestion`, `demo:longmemeval-comparison`, `demo:longmemeval-public` | Passed | Primary acceptance pending |

The worker's full OpenAI suite preceded removal of one unused test import;
the later Node 24 combined test ran that final test file. Primary's
exact-commit Node 24 acceptance remains pending. All tests and demos used synthetic data;
the three demos retain their fresh synthetic files by their documented design.

### Review correction P2

The Spec reviewer found a schedule-versus-dispatch ambiguity in candidate
`24e09a0`: a 30-second per-call timer might dispatch late after a longer
invocation budget has expired. At dispatch the old code relabeled that timer
`capture_deadline`, despite the per-call ceiling being its scheduled bound.
Before the correction, the deterministic command
`node tools/testing/run.mjs --test-name-pattern='delayed per-call timer remains per-call' core/test/model-call.test.mjs`
failed in under one second: actual `capture_deadline`, expected
`model_timeout`. The test used mocked timers, a trusted deadline returning
30,000 ms at scheduling, and expiry made visible before delayed dispatch.

The corrected wrapper records whether the invocation bound was shorter than
30,000 ms when scheduling. Only such a timer may report `capture_deadline`,
and only if the trusted deadline is expired when it fires. A 30,000 ms tie
remains per-call. The public error remains `model_timeout`, with unchanged
timer values. The adapter test also replaces its unbounded caller-readiness
poll with a one-second bounded wait and abort cleanup. Focused core/adapter
tests passed 11/11 on Node 22.16 and 11/11 on Node 24.15 after correction.
The full-suite results above belong to `24e09a0`; affected suites are being
rerun against the correction candidate before final review.

### Test timing correction

The first Node 24 full OpenAI rerun failed the new synthetic boundary test at
`adapters/openai/test/capture-timeout-boundary.test.mjs:96`: its public error
was still `model_timeout`, but the core observer emitted `model_timeout`
instead of the test's expected `capture_deadline`. Twenty finite focused Node
24 repetitions of the same test reproduced one such failure and 19 passes.
The implementation permits this result when an invocation-limited timer fires
before the trusted monotonic deadline reports expiry; the observer must not
claim expiry it has not established.

The synthetic fake generation callback now blocks the local event loop for
600 ms after a 500 ms capture budget has begun, so the pending timer cannot
dispatch until that budget is genuinely expired. This models delayed timer
delivery, not historical provider latency. A separate mocked-timer negative
control covers an invocation-limited timer that fires before expiry and must
retain the uncertain `model_timeout` reason. Production timers, codes and
limits are unchanged. The corrected real-adapter boundary passed 10/10
additional focused repetitions on Node 22.16 and 10/10 on Node 24.15.
Combined core model-call and adapter boundary tests passed 12/12 on each
runtime. The existing capture-invocation-deadline suite passed 19/19 on each.
The final full `npm run test:openai` rerun passed 307/307 on Node 22.16 and
307/307 on Node 24.15. The primary agent is separately rerunning affected
full Node 24 suites for fixed-point acceptance; those results are not claimed
by this worker's test-only correction record.

### Final local acceptance

Tested code candidate: `b4f7349aa31bf24b2a8f9e4d5a4e66d4c8ef7885`.
This record supersedes the local pending entries above; the earlier failures
and earlier-candidate results remain historical evidence. Node commands below
used the pinned 22.16.0 and 24.15.0 runtimes, including child test processes.
The worker ran the Node 22 gates; the primary independently ran the Node 24
gates and the combined affected-file check on both runtimes. The worker's
full OpenAI checks used the same final code and tests on both runtimes.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node tools/testing/run.mjs core/test/*.test.mjs` | 1005/1005 pass | 1005/1005 pass |
| `npm run test:openai` | 307/307 pass | 307/307 pass |
| `node tools/testing/run.mjs evaluation/live/test/*.test.mjs` | 341 pass, 30 expected skips, 0 fail | 341 pass, 30 expected skips, 0 fail |
| `node tools/testing/run.mjs evaluation/longmemeval/test/*.test.mjs` | 193/193 pass | 193/193 pass |
| `node tools/testing/run.mjs evaluation/experiment-budget/test/case-deadline-guard.test.mjs` | 21/21 pass | 21/21 pass |
| `node tools/testing/run.mjs plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs` | 121/121 pass | 121/121 pass |
| `node scripts/validate-json.mjs` | pass | pass |
| `node tools/testing/run.mjs core/test/model-call.test.mjs core/test/capture-invocation-deadline.test.mjs adapters/openai/test/capture-timeout-boundary.test.mjs evaluation/live/test/public-pilot.test.mjs` | 82/82 pass | 82/82 pass |

The `npm run test:core`, `test:live-evidence-offline`, `test:longmemeval`,
`npm test` and `npm run validate` aliases used by the worker invoke the
corresponding direct commands above. The primary also inspected the complete
diff, public-pilot projection and final real-adapter fixture.

All six required synthetic demos passed on both runtimes: `node` followed by
`examples/local-store.mjs`, `examples/capture.mjs`,
`examples/openai-offline.mjs`, `evaluation/longmemeval/demo.mjs`,
`evaluation/longmemeval/comparison-demo.mjs` and
`evaluation/longmemeval/public-demo.mjs` (or their documented npm aliases).
Demo files retain their fresh synthetic artifacts under their existing contract;
ordinary tests use the owned runner. No historical scratch was cleaned.

Independent Standards review passed on the tested code candidate. Independent
Spec review found the implementation correct and independently passed the
31 focused core/adapter checks on both runtimes, but required this final gate
record before acceptance. This addendum is documentation-only; both reviewers
must inspect its committed successor against the original base before push.
Exact-head GitHub CI and mergeability remain delivery gates, recorded in the
PR, not local results claimed here. No paid run, replay, rescoring, ledger
mutation, release, deployment or provider-cause conclusion follows.
