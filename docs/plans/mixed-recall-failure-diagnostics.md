# Mixed recall failure diagnostics

Fixed base: `c982c77e3586c07e0ed024c3eee759e25cb22657`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/mixed-recall-failure-diagnostics`.
Branch: `fix/mixed-recall-failure-diagnostics`.
Implementation owner: bounded GPT-6.1 Sol/high worker; primary owns live N8,
acceptance, independent reviews, commits and PR delivery. No worker subdelegation.

## Observable contract

- RFD1: A deterministic seconds-scale test must traverse actual mixed generation,
  actual core recall and fake HTTP. A correctly framed and adapter-accepted
  ranking response rejected by core must expose the trusted core cause. Run and
  retain its first RED invocation/output, repeat and minimise before hypotheses.
  This reproduces a diagnostic gap, not the unknown cause of live N8.
- RFD2: Failed Cairn recall retains only a finite allowlisted trusted core code
  together with the existing bounded model diagnostic snapshot.
  Unknown codes retain the field with null; no arbitrary messages, IDs, source, query or provider
  prose, callback, or additional source retention is introduced. Use the existing
  journal-compatible `modelDiagnostics` container for `recallErrorCode` (null for
  unavailable/unrecognised codes). No retryability or retry policy is added.
- RFD3: Cover core rejection after successful adapter validation, safe refusal of
  unknown codes, successful and empty recall, ingestion-only failure, accounting
  and transport unknowns, and timeouts. Witness on/off must preserve arm outcomes,
  question/answer, request order/body/count and accounting. Journal and scorer
  validation must accept the reports unchanged; failed local recall remains U in
  the fixed denominator, and whole safety/account halts remain unscored.
- RFD4: Only mixed-generation, focused tests/necessary synthetic mixed-native
  fixture extensions, this plan and a narrow limitations appendix may change.
  Preserve arm reason/status/scope, guard revocation, scoring, budget, timers and
  stops. No core, adapter, prompt, guard, native, scorer, package or CI edits. No
  live data/artifact/key reads, provider calls, paid retry/regrade, merge or deploy.

## Required verification

Run contributor generic test and validate, LongMemEval tests, full mixed-native
local tests, recall/LongMemEval ingestion/comparison/public/mixed demos and locked
Claude plugin validations on Node 22.16.0 and 24.15.0. Use synthetic inputs and
owned test workspaces with pinned installed native prerequisites. There is no
TypeScript gate. The primary reruns key paths and independently reviews a fixed
candidate before delivery. Retain failed evidence and report limitations.

## Threat-model update: private recall diagnostic field

`modelDiagnostics.recallErrorCode` adds one finite code or null to the existing
private local generation report and, when explicitly enabled, its private result
journal. It is not a public MCP/API/telemetry field or an execution authority.
The existing model events remain capped at 64. Correlating the code with those
events, existing timing, scope and accounting metadata can disclose execution
patterns or failure-stage information, even without source text. Operators must
treat the whole report/journal as private evidence; this scalar is not anonymization.

The verified [journal storage boundary](../mixed-result-journal.md#retention-and-threat-limits)
requires owner-private 0700 parent/journal directories and 0600 files on supported
POSIX hosts. The writer and inspector check modes and UID; exclusive publication,
identity checks and hash links do not protect against hostile same-UID processes,
coherent rewrites or filesystem races. Existing operator access/retention policies
and backup/snapshot exposure still apply. Encryption and secure deletion are not
provided, and no new reader, output destination or retention policy is introduced.

Only the trusted core return is projected, by finite allowlist and an own data
descriptor. No raw source/query, identifiers, messages, stacks, provider bodies
or raw error object is added or read from private operational artifacts. Codes
and events are observations of local checks; they are not proof of provider or
upstream causation, semantic truth, authentic execution or permission to retry.
Existing RFD privacy tests verify unknown/accessor/inherited/non-enum refusal,
huge-message and serialization exclusion, the 64-event bound, and absence of
synthetic private sentinels in real-call failure diagnostics. Both supported
runtimes passed these controls within the recorded contributor/native gates.

## Checkpoints

Instructions read: wiki AGENTS, worktree workflow/model routing, diagnosing-bugs,
target CONTRIBUTING and CONTEXT, historical-state, classification and episode ADRs. The recall
entrypoint is mixed-generation → openMemoryCore.recall → guarded OpenAI adapter.
Existing native witness, timing, journal and scoring callers remain regression
owners; the worker exercises their offline tests, primary verifies integration.

### RFD1 retained RED evidence and minimisation

Invocation (Node 22.16.0, fake HTTP only):

```sh
CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu node tools/testing/run.mjs evaluation/longmemeval/testing/mixed-recall-failure.test.mjs
```

First exact-symptom RED (session 16521): natural exit 1, 1 test/0 pass/1 fail,
5230.62597 ms test / 5759.349913 ms total. Earlier sessions 53351 and 77609
failed harness preconditions because two guessed witness property names were
wrong (`undefined` versus `failed`); corrected to the actual `recallOutcome`.
Those are retained setup failures, not claimed gap reproductions.

```text
not ok 1 - RFD1 trusted core recall cause survives adapter-accepted ranking rejection
  ---
  duration_ms: 5230.62597
  type: 'test'
  location: '/home/chichieh/Github/cairn-memory-worktrees/mixed-recall-failure-diagnostics/evaluation/longmemeval/testing/mixed-recall-failure.test.mjs:55:1'
  failureType: 'testCodeFailure'
Expected values to be strictly equal:
+ undefined
- 'invalid_model_output'
code: ERR_ASSERTION
name: AssertionError
expected: invalid_model_output
operator: strictEqual
stack:
  TestContext.<anonymous> (file:///home/chichieh/Github/cairn-memory-worktrees/mixed-recall-failure-diagnostics/evaluation/longmemeval/testing/mixed-recall-failure.test.mjs:57:10)
  process.processTicksAndRejections (node:internal/process/task_queues:105:5)
  async Test.run (node:internal/test_runner/test:1054:7)
  async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5759.349913
```

The first RED proved one admitted synthetic source, one correctly framed rank
response, completed adapter rank output validation, failed core recall, generic
`recall_failed`, null answer, completed native counterpart and no global halt.
Cut witness alone: session 80539 remains RED (5062.66588 ms). Cut journal next:
session 66404 remains RED. Phase timing remains to establish adapter acceptance;
the actual native counterpart remains because generation requires a valid pair.
Removing the non-visible rank reference restores a successful recall. No extra
source rows, requests or unknown live inputs are required for this gap.

### Ranked falsifiable hypotheses checkpoint

1. The mixed recall throw discards the actual core result and bounded observer
   snapshot. Returning its existing local-failure shape with the projected cause
   will make the exact-symptom test green without changing requests/outcomes.
2. The adapter rejects this fixture before core validation. If true, rank output
   validation will fail rather than complete, and a core non-visible-ref event
   will be absent. The RED precondition already observes completed validation.
3. Journal projection removes the cause. If true, removing journal participation
   will expose it. The minimised journal-free RED falsifies that prediction.

Primary receives this checkpoint before the isolated implementation. These are
diagnostic-gap hypotheses; none identifies the original N8 cause.

### Proposed diff checkpoint

The failure branch still revokes at the same point, then returns the local
`recall_failed`/`execution` shape previously created by its catch. It preserves
the bounded observer snapshot and one explicitly allowlisted core-code scalar.
The projection reads only an enumerable own data property, refuses unknown,
inherited/accessor/non-enum/boxed codes without invoking them, and never reads
messages or serializes error objects. Core, adapter, guard, journal and scorer
are unchanged. Native tests register the new focused file by import, without
changing package/CI configuration. Existing canonical W302–W304 controls now
assert the new code for duplicate rejection and model timeout, absence on
success/empty/ingestion/answer-only failures, and unchanged complete request
body comparisons under their existing generated-field normalization.

Primary independently reran original RED with exact Node 22.16.0 in a clear
environment: session 20950 natural 1, 4995.510014 ms test / 5467.212882 ms total,
baseline implementation and RED test hashes authenticated before implementation.
Worker initial GREEN: session 48195 4/4, natural 0. A broader first test pass
(25342) retained 3 assertion failures: unnormalised generated timestamp comparison,
`unknownActualCount` includes priced count calls with null actual-cost data,
and account-framing rejection is wrapped by core as generic `recall_failed`.
Corrections preserve actual observed behavior, reuse the established canonical
wire differential and compare unknown costs against actual settled attempt data.
No failed run was silently counted as a pass.

### Native assertion correction retained

Both first full canonical native invocations found the same new assertion
failure in W302–W304: expected `recall_failed`, observed `deadline` for the
authenticated timeout case. Prior successful/rejected cases passed. This is
the existing guard's documented timeout precedence; the implementation did not
change it. The test-only correction expects `deadline` for that timeout while
still requiring the preserved core code `model_timeout`. Failed original logs
are retained as `node22-native.log` and `node24-native.log` in the owned evidence
root below. Primary was notified before the correction; this thawed the test
freeze only. New native-test hash:
`6b541b4555837ca5ea963f1c4f67bf25d6dca9bd71e1bde25f0f4daba4529307`.
Focused W302–W304 and complete native gates will be repeated on both runtimes.

Gate evidence root: `/tmp/cairn-rfd-gates.AhLQR3iz` (retained logs only; test
workspaces belong to the canonical cleanup runner). All invocations use a
clear environment with exact matching Node PATH, no credentials, synthetic
HTTP/inputs, and native roots only for the installed-native gate.

Final worker native closures: Node 22 session 6562 and Node 24 session 98175
both exited naturally 0 on the corrected frozen test file. No code changes
followed these runs. The ordinary owned runner performed workspace cleanup;
no historical directory scan/sweep or unrelated deletion was used. The retained
evidence directory and installed ignored adapter dependencies remain available
for primary inspection. The worker made no commit, push, PR or merge.

### Completed contributor gates on the implementation candidate

All commands run from the assigned worktree under
`env -i PATH=/home/chichieh/.nvm/versions/node/vVERSION/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1`.
Native commands additionally set the two pinned roots from the RED invocation.
Claude commands add the read-only installed-classification-followup pinned
`tools/plugin-validation/node_modules/.bin` to PATH and set HOME to an owned
empty per-runtime directory inside the evidence root. The reused package's
version was read directly and verified as `2.1.260`.

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 581/581, exit 0, 330055.275302 ms | 581/581, exit 0, 333799.509901 ms |
| `npm run validate` | exit 0 | exit 0 |
| `npm run test:longmemeval` | 267/267, exit 0, 70172.053781 ms | 267/267, exit 0, 67710.894608 ms |
| `npm run validate --prefix tools/plugin-validation` | marketplace + strict plugin pass, exit 0 | marketplace + strict plugin pass, exit 0 |
| Each of five demos below | all exit 0 | all exit 0 |
| Focused corrected canonical W302–W304 | 1/1, exit 0, 76527.524311 ms | 1/1, exit 0, 76407.332839 ms |
| First full native (superseded test assertion) | 46/47, exit 1, 328796.565361 ms | 46/47, exit 1, 326318.970842 ms |
| Final full native | 47/47, exit 0, 285479.803581 ms | 47/47, exit 0, 280548.280204 ms |

Demo commands use the owned runner's script mode:
`node tools/testing/run.mjs --script PATH`, where PATH is each of
`examples/recall.mjs`, `evaluation/longmemeval/demo.mjs`,
`evaluation/longmemeval/comparison-demo.mjs`,
`evaluation/longmemeval/public-demo.mjs` and
`evaluation/longmemeval/mixed-demo.mjs` (the package's recall, ingestion,
comparison, public and mixed demo entrypoints).

Focused differential command:
`node tools/testing/run.mjs --test-name-pattern=W302-W304 evaluation/longmemeval/testing/mixed-native.test.mjs`.
Full native command: `npm run test:mixed-native-local`.
Both tests are canonical-registration checks, not ad hoc replacement gates.
All completed passing suites have zero cancelled/skipped/todo cases.

The correct diagnostic-gap hypothesis is loss of the trusted failed recall
result and observer snapshot at the generic mixed throw/catch boundary.
Preserving the same local-failure shape with finite metadata fixes that gap.
A regression at this existing cross-layer seam would have prevented the gap;
no additional core architecture, observer or source-retention mechanism is needed.

### Frozen worker evidence

HEAD/base remain `c982c77e3586c07e0ed024c3eee759e25cb22657`; the candidate is
uncommitted for primary-owned delivery. Implementation and test SHA256 values:

```text
mixed-generation.mjs 004bce2cadb3a56e118d8ac93846f95d614b56193cc89d383e491c78e38dad52
testing/mixed-native.test.mjs 6b541b4555837ca5ea963f1c4f67bf25d6dca9bd71e1bde25f0f4daba4529307
testing/mixed-recall-failure.test.mjs 1ee5a80fc803cb3ac087c310b57e0536e80ef01bdd5438fa38d642774a9accde
test/mixed-recall-error-code.test.mjs f02cad9cafc7473c9b9325318e1c7d57c31e61bf2253635cdb223d02b48a2abb
```

Complete logs reside in the owned evidence root above. SHA256 values for the
principal gates and retained failures:

```text
node22-generic.log 41178e1d4f53465857dbef93c0813676197ad6e945e05448c23bb56c975086f5
node24-generic.log 3cea4033633861ee227533343980660cc4b0a7eb4b92e5e13ca83b8a19445aea
node22-longmemeval.log fd92f78d075d62757b391634e42e40d5c34c507e029c6a226b26faf87021cd66
node24-longmemeval.log 3c8911c1bfaadebfa940a62d662a25223d065f3e6274d709fd0ad3ddd4a1060a
node22-native.log b1e05dea89ed7bd302220364cdd31fe64c6cdb455ac47b2e8d644dc211cd2d64
node24-native.log afd75b81ef54e21512cabc403ffc7fe1d47ef257238fa8010febb2e83eaef4eb
node22-differential-r2.log 654e4aa13488a538b88e3e9c42de6de4f03316c2d313218a5cd04aec8af1c568
node24-differential-r2.log 0a887bed0521619cd4df9175bea050f360f88bc938dc8b56e10b8dbab1e95ceb
node22-native-r2.log 28e874d6c59900bd94d4ecaac3ba22c9cac38da9ee20ac4f9c43e60116828b6e
node24-native-r2.log 7431bff8ac779b0f1fac6de46aab25d3de4cb23a684cba619110eb99900afa2b
```

### Primary acceptance reruns complete

The primary personally authenticated the same four corrected implementation/test
hashes above and completed the full canonical native roster in a clear environment
with the pinned synthetic native roots on both exact runtimes. These were complete
roster reruns, not selected tests:

| Primary gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Full corrected native | session 91402, natural exit 0, 47/47, 305642.228527 ms | session 83002, natural exit 0, 47/47, 300566.491106 ms |
| Finite projection unit tests | natural exit 0, 3/3, 589.344363 ms | natural exit 0, 3/3, 518.603009 ms |

Both corrected full native runs have zero failed, cancelled, skipped or todo
cases. The primary's first full Node 22 run (session 51102, natural exit 1,
46/47, 305706.653823 ms) is retained as superseded failure evidence: its sole
failure was the same old W302–W304 assertion expecting `recall_failed` while the
authenticated timeout correctly retained `deadline`. It is not counted as a
pass or interpreted as a product regression or a paid-run retry.

Primary full corrected logs and SHA256 values, supplied by the primary:

```text
/tmp/cairn-rfd-primary.m3gGHW99/node22-native-r2.log
9d4c2dcdf96ec5d5d94de91faa5b6b36b9b8e668d136738efd301546fe9c5f5a
/tmp/cairn-rfd-primary.m3gGHW99/node24-native-r2.log
feb557aa2928dda5f45cf29040a936cff47a2a50badad065a974b8aa456969e2
```

### Independent review correction checkpoint

First candidate: `f5ebc7a0c2cb5310512841724f9fd8d987837742`. Standards P2
identified the contributor requirement for an explicit threat-model update for
the new captured field. The finding is retained and resolved by the bounded
threat-model section above and its limitations summary, verified against the
existing journal docs and actual storage/inspection code. No implementation,
test, schema, reader or retention behavior changed. The optional duplicated
fixture-setup heuristic is nonblocking; distinct fixture and real-call assertions
remain intact. The primary will inspect this docs-only correction, create a
notes-only successor and rerun independent Standards and Spec on its exact SHA.
Final independent review and CI remain pending.

Primary key runtime reruns are now complete. Remaining delivery gates belong
to the primary: create a scoped fixed candidate commit, obtain independent
Standards and Spec review of that exact candidate,
then deliver its PR and required CI. No live N8 replay or retrospective cause
assignment is part of this work. This prospective observation change does not
establish semantic reliability, host adoption quality, price or resource fit.
