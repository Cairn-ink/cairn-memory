# Canonicalize repeated qualification field references

Status: implementation authorized; no new provider calls or historical rescoring.
Base: c347657acdc67f093771fb33fa9d449389c2cc25.

## Observed problem and bounded decision

A fresh paired semantic probe retained a completed qualification response with
`scope.evidenceSlots: [1, 1]` and a distinct, valid pool `[1, 2]`. The current
adapter rejects the whole result as `qualification_slot_mapping`. A minimal
synthetic replay has the same failure; changing only that field to `[1]`
decodes. The earlier official-run slot failures have no retained raw output and
must not be attributed to this cause.

This is an intentional strict decoder policy, not a malformed source ID or an
input/output capacity failure. Duplicate references to exactly the same valid
source do not supply additional evidence. Normalize them as a set at the wire
boundary, while retaining first-seen order and all existing validity checks.
Do not repair pools or guess which source the model meant.

Diagnosis loop: the primary ran a minimal no-network source/decoder assertion
comparing `[1, 1]` with `[1]`; it fails with `invalid_pool_output` and diagnostic
`qualification_slot_mapping` on the base. The raw response was completed, not
truncated. The three candidate causes were repeated field slots (confirmed by
one-variable replay), invalid pool membership (distinct valid pool remained
unchanged), and output truncation (completed envelope, 270 output tokens).
Provider-level retry is unnecessary; the captured/synthetic replay is enough.

## Acceptance contract

- D1: Validate the original field array's shape, descriptors and raw length
  (0–4), and every original slot's safe-integer/range constraints before
  canonicalization. For valid repeats only, output unique original candidate
  indices in first-seen slot order. No input/output object mutation.
- D2: Do not deduplicate, reorder, repair or relax the pool. Duplicate pool
  members, foreign-item candidate IDs, wrong item coverage, invalid fields,
  fractional/string/negative/out-of-range slots, overlength arrays including
  five equal slots, sparse/accessor/extra-property arrays remain rejected.
  Known fields with no evidence and all-empty item evidence remain rejected
  by existing adapter/core compilation. Diagnostic categories stay finite.
- D3: Exercise actual OpenAI adapter fake HTTP, real `callModel` and core
  qualification compiler, not just decoder equality. A synthetic duplicate
  succeeds without another count/generation call and yields exactly the same
  source-bound anchors as its single-reference counterpart. Multi-item,
  non-contiguous source IDs and partitioned singleton paths retain isolation.
- D4: Retain all other wire, prompt, schema, model, token, timeout, budget,
  core persistence and authorization behavior. No larger evidence arrays,
  fallback source, inferred semantic repair or automatic provider retry.
  This changes local acceptance of redundant valid wire references only.
- D5: Update the user-visible changelog and targeted wire docs; retain the
  original paid failure and scores. State that source linkage is not semantic
  truth. No claim that this alone fixes long-history ingestion or recall.
- D6: Red-before/green-after regression; Node22.16 and24.15 full OpenAI tests,
  offline adapter demo, generic tests/JSON validation and strict plugin gates.
  Since this changes qualification wire decoding, install both adapter sets,
  prepare the package cache and run the opt-in installed rationale offline
  gate on both runtimes. No live key, user database or operational ledger.
  Primary reruns key integrated paths; independent Standards and Spec reviews
  inspect the exact final candidate before PR delivery/merge.

## Ownership and exclusions

Primary owns this contract, actual diff acceptance and integration. A bounded
GPT-6 Sol/high worker owns the decoder, affected tests and focused docs. Two
non-implementing reviewers own the independent review axes. Do not modify the
separate semantic-probe worktree, its frozen rubric or recorded scores. No
publishing, deployment or production data changes.

Clarifying the semantic meaning of commitment for facts/moods, preserving
claimants and distinct dates, and scalable input/output capacity are separate
follow-up gates. This small mechanical fix does not resolve those questions.

## Implementation evidence

Bounded worker: GPT-6 Sol/high, requested and actual; fixed base above, worktree
branch `fix/duplicate-field-evidence-slots`, pre-commit HEAD `a42d0da`.
Primary owns acceptance/integration and independent reviews. No worker commits
or pushes. Implementation changed only the pool decoder runtime: original
`dataArray(..., 0, 4)` descriptor/shape/length validation and every slot's
safe-integer/range validation run before first-seen `Set` canonicalization.
The distinct same-item pool check is unchanged.

Red-before evidence (Node22.16.0, after isolated adapter `npm ci`):
`node --test --test-name-pattern='valid repeated field slots'
adapters/openai/test/qualification-candidates.test.mjs` exited 1:

```text
not ok 1 - valid repeated field slots retain first-seen original IDs and compile identical anchors without retry
error: 'invalid_model_output'
code: 'invalid_model_output'
normalizeQualificationSlots (adapters/openai/index.mjs:70:11)
async callModel (core/model-call.mjs:48:14)
# pass 0
# fail 1
```

The single-reference counterpart completed adapter decoding and core compilation
before that repeated-reference failure. An earlier launch failed only because
the isolated `tiktoken` dependency was absent; it is not the behavioral red.
The first green focused run passed 19 tests. Subsequent coverage adds explicit
unchanged core rejection of known uncited fields and entirely empty evidence.

Affected path/check ownership (worker unless marked primary):

- D1/D2: decoder unit tests cover all seven fields, five non-contiguous item
  IDs and non-contiguous original candidate IDs, first-seen ordering and no
  mutation. Raw five-repeat arrays, sparse/accessor/nonenumerable/extra string
  or symbol properties, fractional/string/negative/out-of-range/unsafe/NaN/
  infinite/null slots adjacent to valid repeats still reject. Getter calls
  stay zero. Duplicate/foreign pools and wrong item mappings keep their finite
  categories. Old duplicate-slot rejection fixtures now use raw five-repeat
  overlength arrays; other rejection cases remain intact.
- D3: `qualification-candidates.test.mjs` exercises fake HTTP, actual
  `callModel`, snapshot and compiler with two items and pools `[3, 1]` and
  `[7, 5]`. Every field's `[1, 0, 1, 0]` equals `[1, 0]` in source-bound anchors
  with exactly one count/generation pair. The existing real-wire singleton
  partition test now compares single and repeated valid slots across all five
  groups; both keep the same ten calls and isolated original sources.
- D4: callers traced through `adapters/openai/index.mjs`'s inline schema check,
  `core/model-call.mjs`, and `core/qualification-candidates.mjs` compiler and
  partition mapping. Shared example/direct-wire decoders and guidance tests are
  covered by the full OpenAI suite; no schema, prompt, core or guard edits.
- D5: changelog and both focused wire docs explain local canonicalization,
  unchanged invalid-array/pool constraints, and the limits of source linkage.
  Original paid failure/scores remain unchanged. Separate semantic evidence is
  primary-owned and is not rescored by this change.

Primary independent replay: the original retained completed response was served
through extraction, actual adapter, `callModel` and `qualifyCandidateItems` by
fake HTTP. The replay asserts outgoing bodies match all four retained responses.
The base exits 1 with `invalid_model_output` after four responses; this decoder
passes on Node22.16.0 and24.15.0 with two qualified cards, one anchor for repeated
scope, the same four responses, and zero external model calls. Primary also
ran the minimal `[1, 1]`/`[1]` differential repro green on both runtimes. These
are replay evidence only, not revised live semantic scores.

D6 worker gates, both Node22.16.0 and24.15.0 (absolute runtime `bin` prepended
to PATH for each command), final uncommitted implementation/tests above:

| Command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm run test:openai` | 258 pass, 0 fail/skip | 258 pass, 0 fail/skip |
| `npm run demo:openai-offline` | pass | pass |
| `npm test` | 112 pass, 0 fail/skip | 112 pass, 0 fail/skip |
| `npm run validate` | pass | pass |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin pass | marketplace and strict plugin pass |
| `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs` | 4 pass, 0 fail/skip | 4 pass, 0 fail/skip |

Dependency setup used isolated locked `npm ci --prefix adapters/openai`,
`npm ci --prefix adapters/mcp` and `npm ci --prefix tools/plugin-validation`,
then `node packaging/prepare-cache.mjs`. The latter prepared public package
metadata for offline nested installation, not model traffic. Installed rationale
gates exercise fake HTTP with new synthetic test ledgers and databases only;
no environment key, operational ledger, user database or paid call was used.
Raw gate summaries are retained locally as `/tmp/duplicate-slot-*-final.log`,
`/tmp/duplicate-slot-{demo,generic,rationale}{22,24}.log`.
`git diff --check` is clean. Worker correction rounds: zero; elapsed time and
token/cost measurements unavailable. Primary exact committed-candidate reruns
and independent Standards/Spec reviews remain pending integration acceptance.

Primary acceptance additionally reran the final full OpenAI suite on both
Node22.16.0 and24.15.0: 258 passed, zero failed/skipped. The same reviewed
working-tree implementation produced the retained-response replay result above.
