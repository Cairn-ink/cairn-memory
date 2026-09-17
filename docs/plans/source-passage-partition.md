# Shared exact-source passage partition

Goal: remove source-position arithmetic from future model output without creating
a second memory engine. This change extracts the existing qualification passage
partition into one small internal core helper. It is an engineering prerequisite,
not a new semantic assessment method or a claim of reliable relation inference.

Base:2c5dc6ff4105d523f10e54c421a4902484430d41, the reviewed PR166 branch.
Isolated branch:refactor/source-passage-partition. No edits to frozen experiment
code, provider policy/grants, budget, user stores, or primary worktrees.

## Acceptance

- SP1: `core/source-passages.mjs` exports `partitionSourcePassages(excerpt)`.
  Input is a nonempty, well-formed JavaScript string of at most800 UTF-16 units.
  Reject invalid input; do not normalize, trim, rewrite, invent or drop text.
  Return deterministic contiguous `{start,end,text}` passages of at most200
  UTF-16 units, without splitting an astral code point. Rejoining passages must
  equal the exact input, including whitespace, repeated text and combining marks.
  Do not add configuration, storage, model calls or a public index export.
- SP2: `createQualificationCandidateSnapshot` uses this helper after its existing
  canonicalization/validation, preserving current model-facing input, candidate
  numbering across items/receipts, immutable snapshot, and compiled anchors.
  Its established retained-source normalization and800-unit contract are
  unchanged. The new helper itself must not apply that normalization.
- SP3: Tests cover199/200/201/800-unit boundaries, astral characters at cut points,
  combining/full-width text, leading/trailing whitespace, repeated passages,
  invalid/sparse/non-string inputs as relevant, and unchanged qualification
  candidate/model/anchor behavior through the real caller. Test observable exact
  coverage, not a copy of the implementation loop. Existing qualification tests
  and relevant adapter/capture integration tests must remain green.
- SP4: Keep the change small and internal. Do not add a new relation type, graph
  admission rule, ranking behavior, approximate citation matching, position
  clamping, or automatic memory verification. Partitioning alone cannot prove
  semantic entailment, and fixed cuts can separate a condition from its claim.
  A future selector must be able to select adjacent passages or abstain; this
  PR does not implement or evaluate that selector.
- SP5: Run npm test, npm run validate, npm run test:core and npm run demo:store
  on Node22.16/24.15 per CONTRIBUTING. Run relevant qualification adapter tests
  on both runtimes with injected synthetic data only; no provider or credentials.
  Primary personally inspects full diff and reruns key paths. Freeze a scoped
  candidate commit, then independent Standards and Spec review the same base
  and HEAD. Push/PR only after both pass; monitor exact-head CI. No merge/release.

## Ownership and evidence

Primary owns acceptance and integration. A bounded Sol/high worker owns only the
helper, qualification refactor, direct tests and this verification record. The
worker must list affected callers/checks and actual evidence before freezing.
No actual ledger, env/key or provider access is authorized for this task.

## Candidate verification record

Worker: Sol/high. The only runtime caller changed is
`createQualificationCandidateSnapshot`; it still canonicalizes receipts before
partitioning, and `qualifyCandidateItems`/source-bound capture continue to use
its unchanged model input and compiled anchors. The OpenAI adapter consumes that
same input and was not changed. No public API, storage, schema or model request
field changed.

On both Node 22.16 and 24.15, `npm test` passed 143/143, `npm run validate`
passed, `npm run test:core` passed 730/730, and `npm run demo:store` passed.
After `npm ci --prefix adapters/openai` installed the isolated offline test
dependency, this injected-synthetic focused command passed 17/17 on both:
`node --test core/test/source-passages.test.mjs core/test/qualification-candidates.test.mjs adapters/openai/test/qualification-candidates.test.mjs adapters/openai/test/qualification-interpretation-guidance.test.mjs`.
The first Node 24 focused attempt could not load `tiktoken` before that install;
it ran successfully afterward. No provider request or key was used.

Separately, primary compared original and refactored qualification snapshots
or error codes on 1,603 deterministic boundary/Unicode cases on both runtimes:
ASCII lengths 1–800, every astral position in 800 units, and whitespace,
full-width and combining text. All matched. This is differential mechanical
evidence, not a semantic quality result. Fixed cuts may separate a condition
from its claim; future selection must allow adjacent passages or abstention.
