# Answer-blind paired LongMemEval comparison

Base: `6abca93f2247a5b5fd0b3990c0c939e59a835b31` (#35/#36 merged).
Track B now connects ingestion, retrieval, answering and evaluator-only scoring.
This is an offline verified runner, not a published LongMemEval score.

## Acceptance C01–C09

- C01: Strict in-memory comparison API accepts prepared history/question, exact
  case namespace, existing public core, injected answer callback and synchronous
  token counter, explicit answering-model identity and common positive limits.
  Snapshot data/callbacks before awaiting. Question has only question_id/text/date
  and must match history. Reject answer/evaluator/manifest annotations before
  any capture/answer call. No filesystem, keys, network or provider default.
- C02: Produce three explicitly named arms: cairn, lexical, no-memory. Cairn
  uses the existing ingestion then actual core recall, never a second engine.
  Lexical is a deterministic documented simple token-overlap ranking of original
  turns using only the question, never labels; ties follow source order. No-memory
  receives no dialogue or memory. Failed Cairn ingestion/recall stays failed while
  other arms can still run; retain all three arm records without automatic retry.
- C03: Same answer function/model identity, question/date, instruction template,
  output cap and token allowance for all arms. The full serialized answering
  request is counted with the injected counter. Pack whole evidence items in
  deterministic order; record omitted candidates and used tokens, not silently
  truncate text. Empty baseline has empty evidence. Overlarge question/framing or
  invalid counts fail before answering. Include selected source dates/roles as
  untrusted evidence consistently. Do not pass arm name or reference answers to
  answerer. Callback has a bounded AbortSignal deadline; malformed/timeout/error
  outcomes remain explicit and do not leak raw exception messages.
- C04: Cairn context comes only from returned memories/receipts in the exact
  namespace, matched by receipt event/session to the validated ingestion source
  map. Reject unknown/cross-case source claims; preserve incomplete recall coverage
  rather than report perfect recall. Evidence/session linkage measures traceability,
  not semantic entailment. No full raw turn promoted into context when only a
  receipt excerpt was retrieved. Lexical evidence preserves source identities.
- C05: Separate evaluator-only scoring API joins matching prepared evaluator to
  a completed run record after all generation; strict labels and source IDs must
  exist in the frozen history. Return a clearly named normalized exact-match
  diagnostic (not official/semantic accuracy) and optional injected semantic
  judge result with explicit judge identity. Reference arrays are not assumed
  alternative aliases; document exact serialization. Judge receives only the
  question, generated answer and reference, not a mutable run or answerer.
  Unknown/missing/failed judgments remain unscored, never incorrect or correct by
  accident. Judge deadline/errors explicit. No built-in live judge or official
  LongMemEval-equivalence claim.
- C06: Separately report reference-session evidence coverage with numerator and
  denominator; no evidence labels means null, not 100%. Distinguish retrieved
  evidence from evidence actually packed for the answer. Keep all arm failures,
  attempted/completed/scored denominators, usage/cost unknowns and latency. Missing
  provider usage/cost stays null, not zero. Any safety/provenance violation is a
  distinct blocking flag, not averaged away by answer accuracy.
- C07: Synthetic tests on Node22.16/24 prove no label leakage, no-memory isolation,
  shared prompt/budget, deterministic lexical ties, whole-item omissions,
  bad/mutated inputs/callbacks, mismatched/poisoned evaluator, wrong/empty answers,
  judge unknown/failure/timeout, ingestion/recall failure retention, and exact
  actual-core source receipt mapping. Test sensitivity to changed evidence and
  answer rather than simply asserting scripted success.
- C08: Runnable no-key synthetic demo exercises actual public SQLite core with
  scripted extraction/recall and answering; report all three arms and explicit
  synthetic-only label. Wire CI/contributor gate/changelog and document API,
  scoring interpretation and remaining live/full-dataset/reliability gates.
- C09: Primary independently runs actual-core comparison and evaluator sensitivity
  probes, then fixed-base Standards/Spec reviews of the final candidate. No raw
  downloaded corpus or generated results committed, no paid calls, no private or
  production change. Freeze future live sample/judge before spending/tuning.

## Ownership

Sol high worker owns new comparison/scoring modules under evaluation/longmemeval,
their tests/demo, package and CI wiring. Primary owns acceptance/docs, independent
verification and review. Do not change core, prepare/ingestion schema or behavior,
provider, MCP, Hermes, existing model defaults or the sibling budget worktree.

## Verification record

Primary independently verified the frozen implementation on Node 22.16.0 and
24.20.0: all 37 LongMemEval tests, ingestion and comparison demos, JSON validation,
and all 31 plugin tests passed. Claude plugin validator 2.1.260 passed marketplace
and strict plugin validation on Node 22.16.0.

An independently authored temporary probe used actual public SQLite core with
scripted model callbacks. It verified three isolated answer arms, exact receipt
mapping, changed-reference diagnostic sensitivity, unknown judge denominators,
judge identity snapshots, poisoned/duplicate run rejection and occupied-namespace
failure retention. Both runtime versions passed. The scripted diagnostic pattern
is a test assertion, not a measured Cairn quality advantage or benchmark score.

Primary integration checks prompted stronger immutable input snapshots, exact
receipt content/role/client matching, retained partial ingestion outcomes, strict
three-arm and no-memory validation, failed-coverage nulls and zero-call oversized
question preflight. No paid model calls, real-dataset answer generation, private
changes or production actions occurred. Independent fixed-base Standards and Spec
reviews are required before push; their final results belong in the PR evidence.

Initial independent Spec review found no gaps; Standards review found no
documented violations and two cleanup heuristics. Primary extracted the repeated
shape/freezing helpers while preserving each stage's error class, and renamed
the validated token counter to `countTokensOrFail`. Both runtime gates and the
independent probe are repeated, followed by both review axes on the new commit.
