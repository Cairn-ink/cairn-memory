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
