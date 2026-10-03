# Prospective extraction TEXT rejection diagnostics

Owner: actual GPT-6.1 Sol/high bounded implementation worker; primary owns
acceptance and two independent reviews. Worktree `extraction-text-shape-diagnostics`,
branch `fix/extraction-text-shape-diagnostics`, fixed base
`7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`.

The paid observation retained only `extract/core_validation/invalid_extraction_text`;
its rejected object was not retained, so its exact subtype is UNKNOWN. This
prospective refinement does not explain or fix that historical failure. No
actual artifacts, source, evaluator, key or operational state may be inspected.
The paid runtime and frozen private operator remain untouched.

## Verbatim acceptance contract

ET1 prospective finite content-free reason codes distinguish at least nonstring, malformed Unicode where currently rejected, >20000 raw bound, empty normalized, all-redacted, NUL, normalized>600. Preserve legacy invalid_extraction_text allowlist and unknown historical subtype.

ET2 unchanged four-field event(version/stage/layer/reason), no text/values/lengths/IDs/hashes/errors captured; update existing diagnostic privacy docs as needed.

ET3 exact current rejection/normalization/redaction/truncation/Unicode behavior and public invalid_model_output envelope, whole batch zero admission and replay claim handling remain identical across plain/qualification/indexed-evidence/episode modes. No dropping/repair/retry/truncation/bound/model/prompt policy change.

ET4 valid boundary600 and Unicode/normalization/redaction cases preserve behavior; observers throw/reject/mutate inert.

ET5 carry fixed codes through existing pilot/mixed diagnostic collector using existing allowlist, no score/provider change. Inspect all callers if boundedText internal seam needs extension; avoid copying normalization/redaction algorithm or architectural framework.

ET6 freeze real regression tests before fix; retain red/green logs and scoped diffs; no inferred actual run subtype.

ET7 both Node22.16/24.15 complete current required gates generic/validate/core/demo:store/demo:capture and affected OpenAI/live/LME gates and capture suites; prerequisites missing fail, not skip. Extra gates if actual diff extends there.

ET8 one scoped commit frozen after tests; don't push/open PR/merge/deploy, no actual .env/key/book/config/source/evaluator reads or paid calls, no owned-history cleanup. Preserve original failed data and frozen measurement; root reruns and dual reviews final candidate before delivery.

## Evidence

All evidence is retained separately from canonical runner scratch in the owned
directory `/tmp/cairn-text-shape-evidence.ObsG3Y`; labels are unique and no log
is replaced. New fixtures use `createTestWorkspace` with core close before
owned removal, including failures and explicit successful-closure assertions.
No provider calls or real data are required. Independent reviews pending at
candidate freeze.

### Feedback loop, baseline and corrections

The exact original subtype is unknowable from the retained event. The feedback
loop reproduces **diagnostic ambiguity**, not that paid failure's unknown cause.
Ranked checks concern only where diagnostic detail collapses: the shared text
validator, extraction prechecks, then the finite collector allowlist. No real
failure hypothesis can be adjudicated without the missing rejected object.

Before runtime edits, the canonical real `core.capture` loop ran under env-i
pinned Node22:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs core/test/extraction-text-diagnostics.test.mjs
```

- `ET-red22.log`: exit1,0/7 pass,0 skip/cancel,439ms. All seven first captures
  returned `invalid_model_output`, admitted zero from a two-item batch, and
  emitted the same legacy `invalid_extraction_text`. Expected fixed subtype
  assertions failed, not imports or an unsupported option. Test SHA at that
  point: `1b82914fb795bded4a014d066a676494baece43af923318b5bb6455edb8abfc3`.
- `ET-full-red22.log`: expanded harness retained its own fixture mistakes:
  list rows were incorrectly treated as full memories, and the wrapper failed
  to return a rejecting observer Promise. These were corrected in the fixture
  before implementation, not by changing core behavior.
- `ET-full-red22-fixture-correction1.log`: exit1,7/20 pass; all valid-boundary,
  normalization/redaction/Unicode and observer baseline cases passed.
- `ET-frozen-red22.log`: final pre-fix regression, exit1,7/21 pass,14 diagnostic
  assertion failures,0 skip/cancel,10537ms. Added raw/normalized/NUL/qualified
  Unicode precedence. Frozen test SHA before runtime edits:
  `4e90b4b691c027185e511ea7dd1f75287dfee16490127ea6ca88a17389c2d508`.
- `ET-first-green22.log` and `ET-first-green24.log`:30/31,exit1. One overbroad
  episode replay expectation was exposed after the first subtype assertion
  passed. The pre-fix RED did **not** reach that second invocation; it cannot
  be cited as prior verification of episode replay.
- `ET-episode-base-replay22.log`: exact base7467 runtime modules copied into
  a new owned synthetic workspace, canonical --script execution,exit0. It
  proves first `invalid_model_output`, then staged-episode
  `capture_evidence_closed` with one extraction, and owned closure/removal.
  Retained helper `episode-replay-baseline.mjs` is a test-only evidence probe,
  not a runtime/framework or a committed caller.
- With primary approval, the test now asserts existing per-mode replay:
  staged episodes stay closed without a second extraction; plain/qualification/
  indexed-evidence failures abandon their admission claim and invoke the model
  again on an explicit caller retry. No runtime correction or automatic retry
  was added. Final regression SHA:
  `678d77423e259138e8721621fe07fb8938f50f1d59c1cdb4df52dacd555f5b91`.
- `ET-focused22-correction1.log` and `ET-focused24-correction1.log`:31/31,
  exit0,0 fail/skip/cancel. This includes all seven codes, precedence, whole
  batch zero admission, five capture configurations, valid600/raw20000 bounds,
  NFKC expansion/contraction, astral Unicode, existing plain malformed-Unicode
  acceptance, mixed redaction, surrogate-safe truncation, throwing/rejecting/
  mutating observers, rejected-hook Promise handling, pilot slot persistence,
  mixed finite collection and retained legacy allowlisting.

### Minimal seam and callers

Only `core/validation.mjs`, `core/capture-input.mjs`, and
`core/model-diagnostics.mjs` change runtime behavior, solely optional observation.
`boundedText` keeps its original three arguments and exact normalization,
redaction, rejection order and code-point truncation loop; an optional fourth
internal hook gets one fixed category, never text/values/lengths. Its thrown or
rejected result cannot replace `invalid_text` or become an unhandled rejection.
Only extraction supplies this hook and maps it into the existing finite emitter.
Existing qualified/indexed Unicode prechecks remain mode-specific and precede
raw bounds; plain extraction adds no Unicode policy. Legacy reason remains
allowlisted as a fallback, not attributed retrospectively.

All callers were inspected: capture snapshot/retained receipts, source windows,
placement, qualification candidate/canonical-label validation, qualification
input, episode storage, source evidence, contract remember/admit/query paths,
staged evidence, and test storage scenarios. Existing three-argument callers
are unchanged. `extractedWindowItems` delegates this same extraction validator;
no normalization/redaction copy or alternate engine is introduced. The pilot
slot reader/writer reprojects through `emitDiagnostic`; the mixed observer
receives only finite emitter events. Their implementation, scoring, provider,
prompts, defaults, wire and storage schemas remain unchanged.

### Required gates

Setup ran only locked `npm ci --prefix adapters/openai`,
`npm ci --prefix adapters/mcp`, and `npm ci --prefix tools/plugin-validation`
under env-i/pinned Node24. All exit0, zero vulnerabilities;1/14/3 packages
respectively. `setup-{openai,mcp,plugin}.log` retains raw output. All three
lockfiles are unchanged. No paid runtime/dependency/native root was modified.

Final source1 matrix passed on Node22.16.0 and24.15.0. Runtime/test bytes did
not change during these gates; only this evidence and privacy wording were
completed afterward. Raw logs are `ET-{22,24}-<label>-source1.log` in the owned
evidence directory above. Every command runs with
`env -i PATH=/home/chichieh/.nvm/versions/node/v<version>/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1`
from the isolated worktree; `version` is exactly22.16.0 or24.15.0. There is no
environment key or inherited provider configuration.

| Label / command | Node22.16 / Node24.15 result |
| --- | --- |
| `generic`: `npm test` |580/580 both;0 fail/skip/cancel;exit0 |
| `core`: `npm run test:core` |1157/1157 both;0 fail/skip/cancel;exit0 |
| `openai`: `npm run test:openai` |310/310 both;0 fail/skip/cancel;exit0 |
| `longmemeval`: `npm run test:longmemeval` |193/193 both;0 fail/skip/cancel;exit0 |
| `workspace`: `npm run test:workspace-lifecycle` |25/25 both;0 fail/skip/cancel;exit0 |
| `live`: `npm run test:live-evidence-offline` |370 tests:340 pass,30 existing explicit opt-in skips both;0 fail/cancel;exit0 |
| `validate`: `npm run validate` |exit0 both |
| `plugin`: `npm run validate --prefix tools/plugin-validation` |marketplace/plugin validations pass;exit0 both |

The30 live-suite skips are existing optional installed Hermes/source-pair/
rationale-host gates without their explicit artifact/host metadata. They are
not passes, do not satisfy those opt-in gates, and are not a new ET prerequisite
skip. All mandatory source gates and new tests executed; missing mandatory
dependencies failed closed, rather than silently skipping. No actual installed
host, native Mem0, paid/provider or downloaded-source gate is claimed here.

Demos also passed exit0 on both runtimes through canonical owned --script
execution: each command is `node tools/testing/run.mjs --script <entrypoint>`.

| Log label | Entrypoint / existing npm demo equivalent |
| --- | --- |
| `demo-store` |`examples/local-store.mjs` / `demo:store` |
| `demo-capture` |`examples/capture.mjs` / `demo:capture` |
| `demo-openai` |`examples/openai-offline.mjs` / `demo:openai-offline` |
| `demo-ingestion` |`evaluation/longmemeval/demo.mjs` / `demo:longmemeval-ingestion` |
| `demo-public` |`evaluation/longmemeval/public-demo.mjs` / `demo:longmemeval-public` |
| `demo-mixed` |`evaluation/longmemeval/mixed-demo.mjs` / `demo:longmemeval-mixed` |
| `demo-episodes` |`examples/session-episodes.mjs` / `demo:episodes` |
| `demo-admission` |`examples/admission.mjs` / `demo:admission` |

Retained scoped diffs: `ET-runtime-source1.diff` and `ET-finaltest-source1.diff`.
The latter's expected git --no-index exit1 means differences from /dev/null,
not a failed test. `git diff --check` passed and dependency lockfiles remain
unchanged. All new fixture closures and canonical runner cleanup completed;
only this task's worktree and intentionally retained evidence remain. No
historical/operational directory was scanned, cleaned or modified.

One test-only post-implementation correction round addressed the proven
per-mode episode replay assertion; no runtime correction round was required.
Earlier expanded-fixture setup errors and all REDs remain separately labelled.
Independent Standards/Spec reviews and primary exact-candidate acceptance are
pending at freeze. The primary owns later delivery; this worker does not push,
open a PR, merge or alter the paid runtime/frozen private operator.

No source changes after the candidate commit without primary coordination.
This is prospective observability only, not extraction/recall/answer quality,
reliability improvement, live-run attribution, or permission to replay/spend.
