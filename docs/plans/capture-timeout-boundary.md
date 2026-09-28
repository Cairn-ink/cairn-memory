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
