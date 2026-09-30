# Bounded recall observation in the mixed benchmark runner

Status: implementation and worker offline gates complete; primary acceptance,
fixed-head review and delivery pending. No paid invocation.
Fixed base: `8607e0ff8fcf2681bf2661f23348956e2a6f5195` (PR #304).
Worktree/branch: `mixed-recall-witness` / `test/mixed-recall-witness`.

The next fresh LongMemEval cohort needs a usable answer score and evidence
about candidate visibility/selection/ranking. PR #304's observation facade is
currently unwired. Connect it without changing selected evidence or answers.
This is an observation seam, not a retrieval repair or a quality claim.

## Acceptance contract

- W301: Add exactly one optional explicit `recallWitness: 'bounded-v1'` option
  to `runMixedGeneration`; reject unknown/accessor values, and constrain it to
  1-30 prepared cases before consuming prepared identity. Default behavior
  remains byte-compatible. No external observer callback, reference answers,
  source retention increase or extra provider/tokenizer calls.
- W302: Use the existing `createRecallWitness` around the actual adapter model
  used by the actual core. Close/finish around recall only, before answer calls;
  retain finite summary data under Cairn arm diagnostics as `recallWitness`.
  Emit no raw IDs, opaque tokens, labels, question/source prose or raw errors.
  Mem0 arms have no Cairn witness. Summary counts mean observed references,
  not semantic coverage; adapter-returned is not core-accepted, and complete-map
  bypass, overflow, projection failure and incomplete calls retain uncertainty.
- W303: Stop/failure/timeout/cleanup paths close and dispose private witness
  mappings. A call's failure, signal, receiver, raw HTTP requests, provider count,
  token count, evidence, answer and final scoring cannot change because the
  optional observation is enabled. Preserve diagnostic callbacks and phase
  timing. No public private-token lookup hook or persistent graph.
- W304: Actual core/adapter plus contained native fake-HTTP controls compare
  identical synthetic histories with observation on/off, including successful
  output, empty recall, pre-recall ingestion failure and local timeout/failure.
  Compare original HTTP bodies/order/counts, packed answer and scoring. Exercise
  same-namespace candidate loss, overflows/unobservability, and genuine rank
  packing omission where feasible; name scripted preconditions honestly.
  Final reports remain accepted by unchanged mixed scorer; wrong option never
  consumes prepared identity. Tests use owned temporary workspaces.
- W305: On both Node 22.16.0 and 24.15.0 run focused tests, full LongMemEval,
  generic tests, JSON validation, synthetic ingestion/public/mixed demos and
  explicit pinned-native mixed gate per CONTRIBUTING. Required native roots
  are supplied by primary without keys; missing prerequisites fail, not skip.
  Pinned local Claude plugin checks are required. Primary inspects and reruns
  key actual integration cases; independent Standards/Spec reviewers inspect
  the fixed-base committed candidate; all latest-head CI and mergeability
  precede ready delivery. No provider call or semantic-score claim.

## Ownership and scope

One GPT-6.1 Sol/high worker owns `evaluation/longmemeval/mixed-generation.mjs`,
focused LongMemEval tests and narrow native fixture/test extensions, this plan
and a technical limitations appendix. The PR #304 facade remains unchanged
unless the primary explicitly accepts a necessary correction. Budget modules,
core/adapter/prompt/scorer behavior, packaging/CI, frozen paid cases and other
worktrees are out of scope. The primary serializes shared docs integration,
owns final commits/PR, fresh official selection, credentials and paid execution.

Record actual checks, candidate hashes, review and any correction here.

## Implementation checkpoint

Worker: bounded GPT-6.1 Sol/high implementation assignment, no subworkers.
Fixed base remains `8607e0ff8fcf2681bf2661f23348956e2a6f5195`; the worker makes
no commits, pushes, PR changes, merges or paid calls. Primary owns candidate
freeze, independent review, integration reruns and delivery. Runtime token/cost
telemetry is unavailable and is not inferred from the model assignment.

- W301: `mixed-generation.mjs` accepts only the explicit own enumerable data
  option `recallWitness: 'bounded-v1'`, checks 1–30 cases before adding the
  preparation to the consumed set, and rejects extra observer callbacks.
  `test/mixed-recall-witness.test.mjs` exercises 1/6/30/31/250 rosters, unknown,
  accessor and hidden values, inherited properties, combined phase timing and
  preserved preparation identity after denial. Zero-case preparation already
  fails the existing preparation contract.
- W302/W303: the private witness wraps the actual frozen OpenAI adapter passed
  to the actual core. `finish` immediately follows actual recall, before
  provenance/packing/answer operations. A `finally` closes and disposes even
  when core construction, ingestion, recall, evidence or answer fails; only
  finite scalar summary data is attached to Cairn diagnostics. Historical
  retained-call counts are copied before disposal clears private events, and
  the disposed flag is read from the disposed witness. Native/preflight-only
  arms have no Cairn observation. Existing diagnostic/phase callbacks remain
  on the same adapter and are tested with both modes enabled.
- W304: `testing/mixed-native.test.mjs` adds seven on/off native differentials and
  extends existing thrown SQL, preflight-only and late ingestion-timeout
  checks. `testing/mixed-fixture.mjs` captures original synthetic HTTP body
  strings for assertions. Separate owned stores require a single generated-ID
  bijection from trusted owned SQLite metadata, applied only to known memory/
  receipt fields and generated memory-ID schema enums. Original outer/model
  serialization is asserted exact; source/query/answer prose remains exact,
  including UUID/time-looking literals and strings equal to actual generated
  metadata values. Mutation controls reject source changes. Native results
  establish equality after this normalization, not raw byte equality across
  independent stores. Phase elapsed values remain observations and are excluded
  from equality. A later answer failure leaves the completed recall summary
  complete, demonstrating the observation's distinct boundary. The unchanged scorer
  accepts real witnessed generation reports and produces equal scores.
  Existing `test/recall-witness.test.mjs` actual core/adapter controls provide
  same-namespace candidate-loss, independently fetchable rank-budget omission,
  overflow/projection/bypass and signal/counter/receiver/promise coverage.
- Technical bounds and preconditions are appended to `docs/limitations.md`.
  The facade, core, adapter, prompts, scorer, protocol manifests and packaging
  are unchanged. No source retention or private lookup hook is added.

Entrypoint/caller inspection: the sole changed public evaluation entrypoint is
`runMixedGeneration`. Preparation/pre-grant demo and existing callers omit the
option by default. Native generation/scoring tests and the full LongMemEval
suite cover dependent callers and option validation; direct core/adapter tests
cover forwarding semantics. There are no browser/UI/URL/copy changes.

## Retained failed verification attempts

1. First Node 22 native differential run failed at its new rank request-count
   assertion (`2 !== 1`, 7.300 seconds overall). The fake adapter sends both
   count and generation HTTP requests with the same stage schema; the test
   now counts rank generation only at `/v1/responses`, while full HTTP parity
   still includes counting calls. This was an assertion-precondition error.
2. The subsequent selected native run passed all six new differentials but
   failed the added SQL-failure outcome assertion (`failed` versus `unknown`,
   52.288 seconds overall). The real core catches injected SQLite failure and
   returns a failed recall result, which the witness observes. The assertion
   now expects `failed`, retaining zero model calls and disposed state. This
   was a separate outcome-precondition error, not a retrieval correction.
3. Primary inspection identified that the original blanket UUID/time regex
   could conceal changes in source/query/answer prose. It was replaced by a
   trusted generated-metadata bijection applied only to specific fields; a
   literal UUID+ISO source and mutation-control test were added. This is a test
   adequacy correction, with both original complete native gate passes retained
   as superseded evidence rather than claims for the corrected comparator.
4. The first field-aware native differential failed because the dynamic
   `memoryId.enum` values in the adapter's JSON schema remained unnormalized
   (10.105 seconds overall). The correction normalizes only those schema enum
   entries using the same known-ID bijection, preserving descriptions and all
   schema structure. Comparator plus all six native differentials then passed
   in 52.375 seconds. A seventh later-answer-failure mode was subsequently
   added and is included in the final full native gates.

Initial focused Node 22 test run passed 10/10 in 2.966 seconds. Its genuine
packing precondition measured individual fetch envelopes at 1699–1707 tokens;
the four-candidate rank input measured 7137 tokens against the 6000-token
budget, with zero source-set shortening. The same-namespace navigation loss
uses the documented scripted counter; it is not a natural tokenizer failure.

## Verification record

Initial exact-runtime batches passed all eleven gates on Node 22.16.0 and
24.15.0. Their native runs took 183.617 and 179.227 seconds respectively and
are superseded by the comparator correction above. Logs and exact
command/elapsed-time/output-hash summaries remain under
`/tmp/cairn-mixed-witness-gates.RW8EHt`. Final full batches under
`/tmp/cairn-mixed-witness-final.tAS4rR` passed all eleven gates on both exact
runtimes, including 32/32 actual mixed native cases with zero skips. The four
working code hashes below were checked again after these gates and match.
The authorized locked install was
`npm ci --prefix adapters/openai` (1 dependency installed, zero audit findings).
Native gates use only the supplied pinned roots:
`/tmp/cairn-mem0-preflight.vDNO3z/venv` and
`/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu`.
Plugin gates reuse the supplied pinned `2.1.260` wrapper read-only from
`installed-classification-followup/tools/plugin-validation/node_modules`.
No environment or credentials files were read or changed.

Working code content hashes before final gates (no worker commit):

| File | SHA256 |
| --- | --- |
| `mixed-generation.mjs` | `2352f04efa91d18b9264ea38710a1d038f858a0f9e6422902aa59eeb0463b317` |
| `test/mixed-recall-witness.test.mjs` | `64bc09fb3dd077baba996848c5aed998fb1415b819a0411007be58cf50ec1264` |
| `testing/mixed-fixture.mjs` | `7d51697387d8a2e16d495b11a4adba42668d642715afd45de9677fd95774d86d` |
| `testing/mixed-native.test.mjs` | `8c1f00c1aa3dbbe9be58ae589066df3a423a888251c16bf76b4c54a2f608cc17` |

Exact gate sequence for each runtime: prefix `PATH` with that runtime's `bin`,
then use its absolute `node` for `node tools/testing/run.mjs
evaluation/longmemeval/test/mixed-recall-witness.test.mjs
evaluation/longmemeval/test/recall-witness.test.mjs`; run `npm run
test:longmemeval`, `npm run test`, `npm run test:workspace-lifecycle`, `npm run
validate`, `npm run demo:longmemeval-ingestion`, `npm run
demo:longmemeval-public`, `npm run demo:longmemeval-mixed`, and `npm run
test:mixed-native-local`. Native environment contains the two supplied root
variables above and no live-key input. Finally invoke that absolute `node` with
`/home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs
plugin validate /home/chichieh/Github/cairn-memory-worktrees/mixed-recall-witness`,
then the same wrapper with `plugin validate
/home/chichieh/Github/cairn-memory-worktrees/mixed-recall-witness/plugins/cairn-memory
--strict`. These run the required pinned local plugin checks without changing
the dependency or packaging files. Per-command raw argv, exits, elapsed times
and SHA256 of retained stdout+stderr are in each runtime's summary JSON.

Final gate results (real parent elapsed milliseconds; Node tests' own durations
are separately retained in logs):

| Gate | Node 22.16.0 ms | Node 24.15.0 ms | Result |
| --- | ---: | ---: | --- |
| Focused options + actual core/adapter witness | 4361 | 4837 | 10/10, no skips |
| Full LongMemEval | 10828 | 10189 | 209/209, no skips |
| Generic tests | 4143 | 3731 | 131/131, no skips |
| Workspace lifecycle | 16469 | 16694 | pass |
| JSON validation | 86 | 95 | pass |
| Synthetic ingestion demo | 329 | 309 | pass |
| Synthetic public comparison demo | 408 | 399 | pass |
| Synthetic mixed preparation demo | 451 | 400 | pass |
| Explicit pinned-native mixed suite | 201689 | 199557 | 32/32, no skips |
| Pinned local marketplace validation | 790 | 783 | pass |
| Pinned local strict plugin validation | 767 | 763 | pass |

Native log output SHA256:

- Node 22.16.0:
  `3f58aae0ff4cee15223ea5ed53f8ae79cd2e5e06fa0359e2ec0cf099a55b59fc`.
- Node 24.15.0:
  `84d6afc46cb54bdb4d23e44716a451b65996553d5907b0f413f46126b3b06277`.

`git diff --check` passed. The final change contains only the runner, its focused
option tests, narrow native fixture/tests, this plan and the technical
limitations appendix. Worker acceptance does not substitute for primary
inspection/reruns, independent Standards/Spec review of a fixed committed
candidate, latest-head CI or mergeability. Those remain primary-owned gates.

Primary acceptance checkpoint: primary directly inspected the final runner and
field-aware comparator, accepted the comparison correction, and reported a
personal Node 22 focused 10/10 rerun (6689.3895 ms test-runner duration) with no
additional runtime finding. The primary will commit/integrate the scoped
candidate, personally rerun the combined native gate, and dispatch independent
fixed-head Standards/Spec review. Worker writes stop after this checkpoint;
there has been no worker commit or external delivery mutation.
