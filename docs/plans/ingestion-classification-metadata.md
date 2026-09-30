# Capture classification metadata: isolated contract diagnosis

Fixed base: `36b18814105967342110af87759bf3a8e0081d2a` (origin/main).
Branch/worktree: `fix/ingestion-classification-metadata` /
`ingestion-classification-metadata`.

This is a separate offline contract investigation, not an explanation of a
historical or ongoing paid failure. The active official-six runtime and all
private source/operator/accounting bytes remain immutable. No paid replay,
protocol substitution, merge, release, deployment or historical cleanup.

## Acceptance D1–D8

- D1: first create a deterministic, fast, red-capable test through the public
  ingestion entrypoint. Exercise a real producer-shaped successful capture
  with its actual optional classification-truncation metadata, and compare
  the otherwise identical response without that metadata. Prefer an actual
  scripted core capture that naturally emits it; identify any weaker seam.
  Show the exact command and red symptom before changing implementation.
- D2: repeat and minimize the reproduction; distinguish this bounded contract
  mismatch from pre-admission failure, genuine failed classification, unknown
  admission or incomplete source retention. Do not claim a cause for any paid
  outcome. Primary then predeclares 3–5 ranked falsifiable hypotheses before
  targeted one-variable probes or a fix.
- D3: any later authorized fix is limited to supported producer metadata in
  `evaluation/longmemeval/ingestion.mjs`, never a permissive catch-all. Validate
  the actual optional shape and its bounded scalar fields; unknown keys,
  malformed values and accessors must remain rejected. Preserve the metadata
  in observed results rather than silently discarding limitations.
- D4: no default core/qualification/filing/receipt/namespace/lifecycle changes;
  no prompts/models/budgets/timeouts/stop policies or scoring changes. Successful
  classification is not complete filing or semantic coverage. Genuine failed
  classification stays partial and prevents later batches in this protocol.
  Processing, thrown/malformed/failed responses and source metadata mismatch
  keep their existing outcomes; no retries, duplicate repair or relabeling.
- D5: regression controls cover absent and valid optional metadata, malformed
  and additional fields, genuine failed classification, unrelated successes,
  multiple planned batches, exact source/catalog/qualification metadata and
  unknown/pre-admission cases. Use synthetic data only; no corpus, actual
  questions/exclusions/evaluator/operator/ledger/env/key/result access.
- D6: new fixtures use immediate `createTestWorkspace` ownership/deferred
  resource closure and canonical owned test runner. Success/assertion/setup
  failures leave zero unexpected scratch. No broad temporary-directory sweep.
- D7: primary directly inspects the full final diff and personally reruns
  focused reproduction, `npm test`, `npm run validate`, required maintainer
  validations, `npm run test:longmemeval` and
  `npm run demo:longmemeval-ingestion` on Node 22.16.0 and 24.15.0 with the
  existing locked isolated dependencies and explicit clean environments.
  Add other contributor gates only if their modules are actually changed.
  There is no TypeScript gate in this repository. Offline checks are not scores.
- D8: one bounded actual GPT-6.1 Sol/high author; no subagents, installs, git
  mutations, operational commands or writes outside declared files. Stage 1
  permits only this plan's evidence append and
  `evaluation/longmemeval/test/capture-classification-metadata.test.mjs`.
  Implementation and limitations documentation require primary's separate
  Stage 2 instruction after the reproduction/hypothesis checkpoint. Primary
  owns dependency prerequisites, acceptance, scoped commit, two independent
  nonauthor Standards/Spec reviews of the final committed diff, one PR against
  main and latest-head CI. No merge/release/deploy in this packet.

## Initial observations (not a diagnosis)

The public capture producer can return optional `classificationTruncated` on
applied classification; ingestion currently validates an exact applied object.
The supported engine also separately retains admission on classification
failure, while the existing ingestion harness records partial and stops.
The latter behavior is intentional under the active protocol and is outside
this candidate's repair scope. ADR 0002 distinguishes the initial attempt
from current filing and must remain respected.

## Evidence

Reserved for the bounded author and primary acceptance. No reproduction or
fix is claimed at this initial checkpoint.

### Stage 1 red checkpoint (2026-09-30)

Owner: bounded author `ingestion_metadata_probe61`, requested/actual
GPT-6.1 Sol/high; no subagents or implementation takeover. Fixed base remains
`36b18814105967342110af87759bf3a8e0081d2a`. The author created only
`evaluation/longmemeval/test/capture-classification-metadata.test.mjs` and
appended this evidence. No implementation changes, hypothesis probes, git
commands, installs or operational scripts were performed. `scripts/README.md`
does not exist in this public worktree. Primary supplied the isolated import
dependencies. Candidate commit is pending; tokens, cost and total elapsed time
are unknown rather than inferred from the model label.

The frozen red fixture reaches `ingestLongMemEvalCase` through the real
`openMemoryCore().capture`, with one synthetic session, one 586-character
source message, one admitted preference and 25 preseeded synthetic topics.
The scripted extractor and classifier use a deterministic code-point counter;
core packing naturally produces the optional metadata. No hand-authored
truncation field or private/provider data is involved. Assertions establish
`ok: true`, `duplicate: false`, one admitted memory, applied classification,
unchanged stored content and the complete exact source receipt with the planned
message/session identities. This rules out pre-admission failure, genuine
classification failure, unknown admission and source-prefix loss for this
specific fixture; it does not establish semantic support or coverage.

Actual public shape at the minimized boundary:

```js
classification: {
  status: 'applied',
  memoryRevisions: [{ memoryId: /* actual core identifier */, revision: /* actual revision */ }],
  indexRevision: /* actual core revision */,
  classificationTruncated: { memoriesShortened: 1, catalogItemsOmitted: 0 }
}
```

Producer references: `core/model-packing.mjs:139` computes the scalar counts;
`core/classification.mjs:36` emits the optional two-field object when either
count is nonzero; `core/capture.mjs:55` attaches it to applied classification.
Consumer trace: `evaluation/longmemeval/ingestion.mjs:579` validates the applied
object, `:624` maps an unrecognized response to unknown/malformed and `:632`
stops subsequent batches. All four public exports at `:637`, `:641`, `:645`
and `:649` share that response boundary. No producer, default core, qualification,
receipt, filing, namespace, lifecycle or protocol behavior was changed.

Exact red commands (working directory is this plan's declared worktree):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs evaluation/longmemeval/test/capture-classification-metadata.test.mjs
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs evaluation/longmemeval/test/capture-classification-metadata.test.mjs
```

Each command ran twice against the same frozen test bytes. Every final run
exited 1 with 4 tests / 3 pass / 1 fail; the only failure is the D1 assertion
at test line 104: expected `completed`, actual `unknown`. The diagnostic reports
`error: { code: 'malformed_capture_response', retryable: false }`, the naturally
emitted counts above, and the matched control status `completed`. Suite durations
were 2.04/2.58 seconds on Node 22.16.0 and 2.07/2.60 seconds on Node 24.15.0
when the independent runtime invocations ran concurrently.

The response-admission negative control clones that same actual successful
envelope and deletes only `classification.classificationTruncated`; its otherwise
identical plan and full result are accepted as completed. This clone is a weaker
control seam than the main real-core capture, and is labeled accordingly: it is
neither a second capture nor duplicate repair. A separate actual capture whose
scripted classifier throws keeps its admission and is correctly partial with
`classification_failed`; that passing control preserves the distinction in
ADR 0002 between initial classification and current filing.

Reproduction/minimization history, all using the exact Node 22 command above:

- Initial topicCount 30 / filler length 565 run: all three initial tests failed.
  The source was 601 characters, above the extraction item's 600-character cap;
  actual core returned `invalid_model_output` before admission. This was an
  unrelated invalid fixture, not evidence of the optional-metadata mismatch.
- Changed only filler length 565 to 550 (source 586): actual applied capture
  emitted `{ memoriesShortened: 1, catalogItemsOmitted: 2 }`; 2 pass / 1 fail
  at the completed assertion. Repeating unchanged gave the same verdict.
- Changed only topicCount 30 to 25: real metadata became
  `{ memoriesShortened: 1, catalogItemsOmitted: 0 }`; the same contract red
  remained, with 2 passing controls.
- Changed topicCount only, successively to 20, 22, 23 and 24: each real producer
  emitted no truncation field. At 20 the fixture's metadata inspection failed
  because the field was absent; after adding an explicit fixture-precondition
  assertion, 22/23/24 reported `ingestion status was completed`. These are
  trigger-removal controls, not reproductions of the contract symptom.
- Restored 25 and retained 24 as a separate passing real-core control: removing
  one topic removes the optional field and completes. One session/message/memory
  and the 25-to-24 catalog boundary are minimized under this fixed source and
  counter; no claim is made that every source character is minimal.

Fixtures immediately own their workspace with `createTestWorkspace(t, ...)`,
immediately defer core closure, and explicitly verify the owned path is absent
after cleanup. Those checks passed after both successful assertions and the D1
assertion failure on both runtimes. Canonical runner cleanup reported no errors.
No general temporary-directory sweep or private residue inspection occurred;
setup cleanup uses the immediate registered hook rather than a late disposer.

Scope deviation recorded accurately: while finding versioned Node binaries,
the author attempted the read-only discovery command
`rg --files /home/chichieh/.nvm/versions/node /opt /tmp | rg '/v?(22\.16\.0|24\.15\.0)/.*node$|node-v(22\.16\.0|24\.15\.0).*/bin/node$'`,
which searched outside the assigned worktree and printed permission-denied
temporary-directory metadata. It was stopped. The author also listed the
version directory with `ls /home/chichieh/.nvm/versions/node`. These were
out-of-scope metadata reads; no file contents or writes occurred in that
discovery. The primary immediately re-scoped all filesystem discovery to the
declared public worktree and supplied both exact runtime paths. No further
outside-worktree discovery occurred. Raw private names/content are not retained
in this plan; no claim of entirely in-scope reads is made.

Entrypoint/check ownership: author owns the new frozen legacy-ingestion red
seam and its real-core source/failure controls. Primary owns independent
reproduction acceptance and the hypothesis checkpoint, plus any authorized
Stage 2 common-boundary controls for indexed/catalog/qualified source metadata,
unknown/malformed responses, unrelated successes and later not_run batches.
Existing dependent public assumptions are in `evaluation/longmemeval/test/ingestion.test.mjs`,
`evaluation/longmemeval/test/qualified-prefix-ingestion.test.mjs` and the
source-policy API descriptions in `docs/longmemeval-ingestion.md`. No browser
flow, URL or product copy changes exist in this test-only packet. Package
`test:longmemeval` discovers the new `*.test.mjs` automatically; the ingestion
demo and D7 full/maintainer gates remain primary-owned and unrun at this red
checkpoint. Offline verification is not an evaluation score and cannot explain
any historical or ongoing paid outcome.

Frozen Stage 1 test SHA-256:
`9a927af9d800489ff007ae622c497c3ee17a5f125067b5e69f67a6ba9475d058`.
Unchanged ingestion implementation SHA-256:
`5012c2dc36d2dfaa926f983e07264620bceb3fcd072bea08a1006512925621cc`.
Stop here: primary must independently inspect/rerun this red seam and predeclare
ranked falsifiable hypotheses before a separate Stage 2 instruction.

## Primary red acceptance and ranked hypotheses

Primary directly read the full frozen test and Stage1 evidence. Personally
reran the exact owned red commands above: Node22.16.0 exit1,4tests/3pass/1fail,
2019.048571ms; Node24.15.0 same counts,2026.95891ms. Only the actual-core
completed expectation fails, all source/failure/boundary/cleanup controls pass.
The test and unchanged ingestion hashes remain tied to Stage1 above.

Before any implementation probe, primary declares these ranked predictions:

1. Unsupported optional-field validation is the cause. Recognizing only the
   real two-field metadata shape makes the actual applied response completed;
   malformed metadata must still be unknown. All other outcome fields stay equal.
2. Producer metadata is structurally invalid despite applied status. If so,
   detached ordinary-data/count checks fail, or an identical plain JSON clone
   with valid metadata changes the verdict before any schema correction.
3. Admission or mode-specific source/catalog metadata is mismatched. If so,
   removing classification diagnostics cannot restore the same source envelope;
   changing only the source/catalog/qualification field must independently deny
   across the appropriate public ingestion modes after any metadata fix.

Stage2 may run these bounded one-variable probes and implement only the
confirmed contract repair. Allowed files now: the existing test and this plan,
`evaluation/longmemeval/ingestion.mjs`, and a compact accurately scoped
`docs/limitations.md` entry near its existing LongMemEval section (not the file
tail, to avoid overlap with the separate pending six-result report). Preserve
all D1-D8 scope and fixed active runtime exclusion. Keep absent metadata valid,
positive legitimate diagnostic counts retained, exact numeric/data-only shape,
unknown keys/accessors/symbols/nonfinite/negative/fractional counts denied.
Genuine failed/partial/processing/malformed responses and later not_run slots
keep their original behavior. No general validator rewrite or other optional
producer fields in this fix; no paid-cause or source-completeness claim.

Author owns focused regressions plus all four shared modes' mapped metadata
controls and affected canonical LongMemEval suite/demo on both runtimes.
Primary owns personal reruns, generic/JSON/maintainer prerequisites and fixed
committed independent review/CI. Do not commit, push or dispatch paid work.

## Stage 2 bounded repair and author verification

Same bounded GPT-6.1 Sol/high author; no subagents, installations, git or paid
work. Only the four declared files were changed. No additional outside-worktree
discovery occurred; the Stage 1 deviation above remains recorded. The existing
diagnosis skill kept implementation behind the independently accepted red and
ranked-hypothesis checkpoint. Implementation correction rounds: zero; the first
scoped change turned the actual regression green. Token/cost/total elapsed
measurements remain unknown. Primary review, committed SHA and CI are pending.

Hypothesis probes followed the predeclared predictions:

- H2, before any implementation change: the real diagnostic has exactly two
  own ordinary data fields, finite nonnegative safe integers and a standard
  prototype. Changing only the capture response representation to its identical
  plain JSON clone still produced unknown/malformed, while the already recorded
  single-field deletion control completed. This rejects a representation defect
  as an explanation for this bounded reproduction.
- H1: allowing only the actual optional diagnostic shape on the applied branch
  made the unchanged real 25-topic fixture completed, with its diagnostic and
  all other captured result values retained. The 30-topic original trigger also
  completes and retains naturally emitted `{ memoriesShortened: 1,
  catalogItemsOmitted: 2 }`; the 24-topic absent-field control still completes.
- H3: each independent source/catalog/qualification or admission mutation is
  denied even with a valid classification diagnostic, across all four exports.
  Removing classification diagnostics had already restored the identical valid
  source envelope before the fix. These probes do not explain any paid outcome.

The only implementation change is the applied-classification response check in
`evaluation/longmemeval/ingestion.mjs`. Its optional `classificationTruncated`
must be an exact two-field plain object whose counts are own enumerable data
properties, nonnegative safe integers and at least one nonzero. Applied fields
must likewise be exact own enumerable data; unknown keys, symbols, accessors
and nonenumerable values are rejected without evaluating diagnostic getters or
silently losing metadata during cloning. Absent diagnostics stay accepted.
The complete valid result is cloned and retained through the existing path.
Other optional producer fields, success forms, failed classification handling,
source-policy validation, stop policy and all core/runtime behavior are unchanged.

Final focused test has 21 passing cases: actual core captures at 25/24/30 topics,
genuine failed classification with retained admission, source-map assertions,
and four groups per public mode (legacy, indexed-window, indexed-evidence,
qualified-prefix). Those groups cover absent/positive/null-prototype diagnostics,
MAX_SAFE_INTEGER bounds, malformed/missing/additional/nonenumerable/symbol/accessor
fields, scalar type and count failures, no getter reads, exact mapped metadata,
independent source/qualification/admission mismatches, duplicate/skipped successes,
two planned batches and pre-admission blocked source. Completed/duplicate
responses continue; partial/processing/malformed/failed/thrown responses stop
with the next slot not_run. The per-mode response controls are scripted mapped
envelopes from each real public plan, a weaker seam than the primary actual-core
producer reproduction. The full existing suite additionally exercises real
indexed/evidence/qualified captures; no private data was used.

Exact before/after H2/H1 command on Node 22.16.0:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --test-name-pattern='D1 actual capture' evaluation/longmemeval/test/capture-classification-metadata.test.mjs
```

Before the fix: exit 1, one failed completed assertion, 687.430149ms;
`plainJsonStatus: unknown`, field-deletion control completed. After the only
implementation change: exit 0, one pass, 774.972692ms; real capture and JSON
clone both completed and diagnostic retained. No intervening producer, source
or model fixture change occurred in that red-to-green probe.

Final focused commands are the two Stage 1 commands above, now exit 0 / 21 tests
/ 21 pass / no skips or failures (3907.033496ms on Node 22.16.0,
3911.456940ms on Node 24.15.0). The original 30-topic replay is test line 147;
it passes on both runtimes, with full stored content/source receipt unchanged.
After adding that original-trigger replay, the final full suite ran again:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 npm run test:longmemeval
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 npm run test:longmemeval
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v22.16.0/bin/npm run demo:longmemeval-ingestion
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v24.15.0/bin/npm run demo:longmemeval-ingestion
```

Final full suites: each exit 0 / 214 tests / 214 pass / no skips or failures;
13019.659901ms on Node 22.16.0 and 12944.410135ms on Node 24.15.0.
Both demos exit 0 with `PASS: plan full synthetic case → lossless raw map →
actual core receipt → replay → forget`. The existing demo itself prints that
its synthetic database is retained; the outer canonical --script runner owns
that fresh directory and removes it after completion. Exact owned paths from
these two invocations were checked for absence and passed; there was no scan
or direct demo residue. Earlier 20-case focused and 213-test suite runs also
passed before adding the original 30-topic replay; final counts above supersede
those intermediate author observations.

All new actual-core fixtures verify their own path disappears after teardown,
on both successful and Stage 1 assertion-failure exits. A deliberate setup
fault was not injected into this new fixture and is **unrun**, not a claimed
pass. The existing canonical setup-failure subprocess/residue check is in
`tools/testing/lifecycle.test.mjs:105`, invoked by `test:workspace-lifecycle`
alongside `tools/testing/workspace.test.mjs`; its required both-runtime gate
remains primary-owned. Immediate workspace registration/deferred closure is
the new fixture's inspected cleanup contract, distinct from measured setup-fault
behavior. Generic/maintainer/D7 and independent review gates also remain primary
acceptance work; author suite results are offline contract checks, not scores.

Entrypoint/owner record: author changed the common applied-response boundary
used by all four ingestion exports, and owns the four-mode/stop/source controls
above plus the affected canonical suite and demo. Primary owns full diff
inspection and personally rerun acceptance. Existing browser/URL/product-copy
flows are unaffected; existing legacy/indexed/evidence/prefix callers and their
old success/failure/source assumptions are exercised by the full 214-test suite.
The compact limitation entry was inserted at `docs/limitations.md:861` before
the combined-ingestion section; its existing tail was not edited.

Final frozen code/test/document SHA-256 values:

- `evaluation/longmemeval/ingestion.mjs`:
  `d11142e5b4877b9b58c129233a4b54830e9670b4b8831e012be8e8e8871c49b1`
- `evaluation/longmemeval/test/capture-classification-metadata.test.mjs`:
  `589ebdba1dd62a83649f4749ec1bda8d7deccdb29f612005de5af1fdcfe58b09`
- `docs/limitations.md`:
  `b3f16a41eba32f63bc1af0f4af0e39c98ed255c0f3c36b9a8c9fef9425faa886`

The repair establishes compatibility with this supported diagnostic only.
Applied classification is not complete filing or semantic coverage; no new
semantic result, replay, score or explanation of frozen paid failures is claimed.

### Primary documentation clarification before commit/review

Primary requested one documentation-only precision correction: the limitation
entry now says the public core/default behavior and currently frozen paid
runtime remain outside this repair, rather than broadly saying runtime behavior
is unchanged. Evaluation ingestion behavior does change as documented above.
Code/test bytes are unchanged; no new test run is necessary for this wording.
Primary has personally started generic, LongMemEval, JSON, owned ingestion demo
and workspace-lifecycle acceptance on both runtimes. Those gates remain pending
until primary supplies their results. Implementation correction rounds remain
zero; this is one primary documentation clarification, not a new implementation.
The earlier limitation hash describes the previous wording and is superseded
by the returned documentation hash for this correction.

### Primary final inspection and D7 acceptance results

Primary personally read the complete final code, test and plan, then completed
the required acceptance checks on the unchanged implementation/test bytes:
`d11142e5b4877b9b58c129233a4b54830e9670b4b8831e012be8e8e8871c49b1`
and `589ebdba1dd62a83649f4749ec1bda8d7deccdb29f612005de5af1fdcfe58b09`.
The documentation-only clarification remains the single documentation correction;
implementation correction rounds remain zero. This append records primary's
reported results; the author did not rerun or mutate implementation, tests or
limitations in this acceptance-record task.

| Personally rerun check | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Focused metadata regression | 21/21 pass; 4272.851530ms | 21/21 pass; 4245.159466ms |
| `npm test` | 401/401 pass; 258487.375594ms | 401/401 pass; 262789.388474ms |
| `test:longmemeval` | 214/214 pass; 13623.862032ms | 214/214 pass; 13620.301578ms |
| `test:workspace-lifecycle` | 25/25 pass; 20117.029032ms | 25/25 pass; 20146.012310ms |
| JSON validation | 10 valid, version 0.1.2; 0.655260136s | 10 valid, version 0.1.2; 0.672295652s |
| Canonical owned npm ingestion demo | 0.443881844s | 0.436506191s |
| Locked Claude 2.1.260 plugin validation (`.` / strict plugin) | 1600ms / 188ms | 1600ms / 186ms |

Each test suite exited 0 with zero failures, cancellations, skips or todos.
JSON validation and both demo invocations exited 0. Primary's exact canonical
npm demo commands were:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v22.16.0/bin/npm run demo:longmemeval-ingestion
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v24.15.0/bin/npm run demo:longmemeval-ingestion
```

Primary asserted absence of the exact two newly owned outer demo roots:
two checked, zero residue. The previous direct-script owned demo roots were
also two checked, zero residue. These are exact owned-path checks, not a
temporary-directory scan or historical cleanup. The existing canonical
lifecycle tests personally exercised actual generic setup, assertion and
termination failure cleanup. A deliberately injected setup fault in the new
metadata fixture remains **unrun**; passing generic lifecycle evidence does
not relabel that narrower observation.

Primary's locked Claude 2.1.260 `cli-wrapper.cjs` ran `plugin validate .` and
`plugin validate ./plugins/cairn-memory --strict` on both runtimes. All four
commands exited 0 with null signal; owned configuration paths were absent,
zero residue. Their clean allowlist forwarded no provider/application
environment. Primary's locked prerequisite installs used `--ignore-scripts`,
with unchanged lockfiles; `scripts/README.md` remains absent. Primary also ran
`git diff --check`, exit 0. No author git/install/discovery or other-file edits
were performed for this append.

D7 personal inspection and the named acceptance checks are now recorded as
passed. The primary's fixed commit, two independent nonauthor Standards/Spec
reviews, PR against main and latest-head CI remain pending. No merge, release,
deployment, scored result, paid replay or explanation of any paid failure is
claimed by these offline acceptance results.
