# Small paired ingestion semantic probe

Status: completed; do not adopt combined. The original prospective contract and
pre-launch audit are preserved below; completed results follow them.
Base: c347657acdc67f093771fb33fa9d449389c2cc25.

Goal: decide whether combining extraction and source qualification merits further
development for a lightweight, reliable memory layer. This is not a retrieval,
Hermes integration, LongMemEval score, or production-default adoption gate.

## Frozen acceptance contract

- P1: Twelve NEW short synthetic scenarios, two predeclared repetitions, both
  arms per scenario: 24 attempts per arm. Freeze source-only cases and separate
  rubric before calling a provider. Failures remain in this denominator. No
  retries, no replacement cases, no consumed official benchmark questions.
- P2: Baseline is the actual source-bound-v2 extraction and bounded-partition
  qualification core/adapter. Combined is the unchanged evaluation-only
  `ingestion-design/combined.mjs` prompt/schema/compiler. Same retained source
  window, pinned gpt-4.1-mini-2025-04-14 model, existing 6,000 local / 7,024
  provider input and 1,024 output ceilings. Neither arm sees rubric/oracle.
  No classification, admission, persistence or recalled answers in either arm.
- P3: Baseline uses real `callModel`, `extractedItems`, `qualifyCandidateItems`;
  combined counts input before generation and runs `compileCombined`.
  Fail closed on refusal, incomplete/malformed output, citation/slot errors,
  oversized output, or deadline. Preserve original outputs for diagnosis.
- P4: An explicitly experimental guarded transport accepts only exact method
  body shapes and actual derived schemas for extract, qualifyCandidates and
  evaluation_combined_v1; never disguise combined as a production method.
  HTTPS OpenAI responses/input_tokens and responses only, POST, no redirects,
  no tools/background/streaming/storage. Count-to-generation bodies must match;
  one count consumed by one generation. Local fit checked before any dispatch.
- P5: Use the existing US$200 campaign ledger (v2 bound handle), exact frozen
  initial checkpoint/history, reserve before dispatch and settle conservatively
  including unknown usage. No reset/refund/new campaign, concurrency or retry.
  This probe cap: US$3 reserved and 576 HTTP requests (24 pairs of arms with
  at most 6 count/generation pairs baseline and 1 combined: 336 requests;
  576 is only a ceiling, not a target). Stop all on accounting/auth anomalies;
  ordinary item failures remain failed and proceed to other frozen attempts.
- P6: Per-call 30 seconds, per-arm 180 seconds, whole probe 90 minutes.
  Bound response bytes and honor abort even for injected transports. Persist
  one-shot start marker before key/network access; persist raw synthetic request
  bodies without credentials and response bodies in a private operator folder.
  Never persist or print API key/header or real user data. CLI is opt-in only.
- P7: Freeze semantic rubric separately: supported meaning, uncertainty,
  attribution, scope/time, useful coverage, and evidence entailment. Empty or
  all-unknown outputs do not pass useful coverage. Two blind independent agent
  raters see source, anonymized cards, and rubric (no arm/cost); disagreements
  are disclosed and adjudicated with cited source, not hidden. These are agent
  judgments, not human labels or an independent benchmark.
- P8: Report completion and each semantic dimension, unsupported assertions,
  omissions, observed provider usage/cost separately from reserved ceilings,
  and latency. Include failures and declared repetitions. No statistical or
  broad superiority claims from this small probe. The baseline/combined task
  decomposition differs even though end-to-end source exposure is held fixed.
- P9: Run focused offline tests and generic/OpenAI contributor gates on Node
  22.16 and 24.15. Include injected failures, no dispatch on invalid schema or
  over-budget, pending/foreign-ledger fencing, no generation after failed count,
  no after-failure retry, and a real-core fake-HTTP paired happy path. Primary
  reruns key checks; independent Standards/Spec review exact committed diff
  before any live dispatch. No production code, default or existing guard
  mutation, package publication/deployment.

## Ownership and next gates

Primary owns this contract, new fixtures/rubric, ledger audit, operator launch
and result interpretation. One bounded GPT-6 Sol/high worker owns experimental
runner/transport/tests/docs implementation; separate read-only reviewers own
Standards and Spec. Follow-up production adoption depends on the semantic
result, long-history fit and ordinary MCP/Hermes integration, not this probe alone.

The bounded fixture implementation is separately delegated to GPT-6 Luna/max
in an isolated worktree, then inspected and integrated by the primary. This is
parallel to the Sol/high runner packet; files have disjoint ownership. Reviewers
must not be either implementation worker.

## API and budget preflight

Official [model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
checked 2026-09-27 confirms the pinned snapshot, Responses/structured outputs,
and US$0.40 input / US$1.60 output per million tokens (cached input US$0.10).
Keep the existing model for this architectural comparison, not a model migration.
Use valid provider usage for metered estimates; distinguish these from the
conservative nonrefundable reservation and from an actual billing invoice.

Primary read-only audit found the existing v2 campaign open at 18,528 requests,
119,997,094 microUSD reserved, 80,002,906 remaining, and zero pending attempts.
This is a pre-launch checkpoint, not a promise of the balance at dispatch.
The operator must revalidate the exact historical witness and reject changes.
No paid call occurred during this planning/audit step.

## Completed result update, 2026-09-28

The prospective contract/checkpoint above is the preserved pre-launch record;
the separately reviewed one-shot paid probe has now completed. Frozen P1–P9,
fixtures and rubric remain unchanged. See the
[full evidence report](../evidence/ingestion-semantic-probe.md) and
[sanitized per-attempt artifact](../../evaluation/ingestion-semantic/results.json)
for original independent A/B ratings, source/card projection, mapping and
adjudication. Adjudication was frozen before the mapping join at SHA256
`1e215c4948e05ab07c58c53ee5be146d645e20376e3bb5c762f64ec76aae05b9`;
primary's earlier baseline projection/failure inspection limits blinding.

Baseline mechanically completed 23/24 and combined 24/24; strict all-six success
was 11/24 and 12/24. Useful coverage was 19/24 and 18/24, so the frozen adoption
hypothesis fails: **do not adopt combined**. Same-model-family agent judgments,
not human labels, cover twelve scenarios repeated twice, not independent
questions. Raw rater A full success was baseline 9/24 versus combined 12/24;
rater B was baseline 11/24 versus combined 15/24. Six rows had eleven dimension
disagreements. Two preference consensus failures were corrected using preexisting
adopted-position
guidance. The eleven nondecision commitment-only failures support a post-hoc
17/24-each sensitivity, not a changed rubric, score or adoption decision.

The sole mechanical failure, baseline conditional-cap-exception repetition 1,
retains a repeated valid field reference rejected by the actual slot decoder.
Local deduplication diagnosed only this response; no replay, score repair,
production correction or historical official-slot root cause is claimed.
Baseline consumed 96 HTTP attempts and combined 48. Known generation usage
uncached ceilings were 32,713 and 25,864 microUSD; retained reservations were
427,008 and 213,504 microUSD. Count cost remains unknown. New reservation
640,512 microUSD leaves cumulative campaign reserved 120,637,606 microUSD,
remaining 79,362,394 microUSD, 18,672 requests and zero pending attempts.
These are accounting/usage evidence, not invoices or production latency claims.

P7/P8 delivery publishes the audit projection and offline integrity gate; final
result-delivery independent review is still required. This PR changes no engine
and does not finish the reliability goal. Next: a separate minimal safe duplicate
field-reference fix, semantic/time/claimant clarification, then bounded ingestion
and output capacity; offline checks/review precede NEW held-out paid cases.
Further dispatch requires a new frozen, reviewed operator manifest and budget
audit within the user's already authorized cumulative US$200 cap. The completed
one-shot manifest supplies no additional dispatch or consumed-case replay.
Only after completion gating return to official-style fixed-N Cairn/Mem0 scoring
and then ordinary installed Hermes/MCP. Do not replay consumed official cases.

Result-delivery verification: the primary reran the final full OpenAI suite on
Node22.16.0 and24.15.0, both 267 passed with zero failures/skips. Worker focused
tests passed 13/13 and generic tests 112/112 on both runtimes, plus JSON/version
validation. Primary verified the public blinded rows, raw ratings, mapping and
adjudication exactly match original private evidence, all 48 metric projections
match original HTTP records, and all six historical input file hashes match the
pre-live candidate. Final independent review and CI records belong to the PR.
