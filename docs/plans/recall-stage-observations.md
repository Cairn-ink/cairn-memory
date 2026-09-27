# Content-free recall stage observations

## Scope and fixed base

Base: `d8f6a7987802a3949b96d05de3aaba2f49eb9fde` (unmerged PR199).
This is an offline-only, separately reviewed evaluation-observability packet.
It does not repair retrieval quality or authorize any paid evaluation. Keep all
previous cases, results, artifact bytes, ledger entries, caps and exclusions frozen.

The retained pilot distinguishes stored session representation from final returned
memories but cannot distinguish empty selection from empty ranking. Its existing
`candidateCount` describes final core-returned memories, not candidates visible
to selection. Core `budget_exhausted` denotes incomplete traversal, not spending
or a proven provider-token limit. A successful source-evidence per-ref fetch is
complete or fails, so incomplete traversal on that path implies incomplete maps;
this does not establish why the model selected or ranked nothing.

## Acceptance

- **O1 — Observe the stages without changing them.** Add one bounded case-local
  collector used only by the private public-pilot evaluator. Wrap the case's
  existing model select/rank calls and core recall result, forwarding the exact
  original request, receiver, returned value or error. Do not alter model prompts,
  parameters, token counting, number/order of provider calls, storage, ranking,
  selection strategy, limits, deadlines, transport guard or core API/schema.
- **O2 — Retain only allowlisted content-free metadata.** Record per-selection
  invocation ordinal, visible map-item/filed-ref/unfiled counts and exhaustion
  flags, returned-ref count and cumulative unique selected-ref count; record
  whether rank ran, its input and returned-ref counts; project the existing
  final mapExhausted/fetchExhausted booleans. Ordinals, bounded counts, booleans
  and closed status enums only. No source/query/label/answer text, IDs, paths,
  credentials, raw errors, object dumps or source-derived hashes. Temporary
  identity comparison may calculate uniqueness but must not escape the collector.
- **O3 — Make uncertainty and lifecycle explicit.** Missing/malformed/unobservable
  metadata is unavailable/null, never fabricated zero or success. Keep bounded
  record retention and explicit overflow/drop metadata. Collection must not throw
  into the real operation, swallow its error, invoke data getters/toJSON while
  projecting observations, inspect retained source text, or mutate requests/results.
  Close before serializing; late settlements cannot mutate frozen artifacts or
  cross case/session boundaries. Preserve existing accounting-first failure
  persistence and global safety-halt behavior. Do not weaken any gate for metrics.
- **O4 — Keep the artifact boundary private and compatible.** Add a versioned
  observation object only to fresh per-case diagnostics.json. Keep aggregate,
  report, answer evidence, scoring eligibility, public memory/hosted schemas and
  old artifacts unchanged. Old optional diagnostics remain optional; do not
  backfill missing observations or use them to resume a consumed session.
  Do not change existing candidateCount/selectedCount meanings; clarify them in
  documentation. A traversal false flag is not a claim that monetary budget ran out.
- **O5 — Demonstrate meaningful synthetic contrasts.** Through actual core and
  scripted/guarded fake HTTP, distinguish (a) visible items but empty selection,
  (b) chosen/fetched candidates but empty ranking, and (c) nonempty rank output
  but whole-item answer-packing omission. Also cover empty maps, incomplete maps,
  successful nonempty recall, select/rank errors, unavailable response shapes,
  overflow, close/late settlement, concurrent isolated cases and artifact-write
  refusal. Prove unchanged provider payload bytes, call counts/order, returned
  data/errors and scoring for identical input with/without observation. Sentinel
  private text/IDs/keys must never enter the observation object. Zero paid calls.
- **O6 — Verify and deliver independently.** Scope is evaluation/live helper,
  public-pilot integration and focused tests, plus related evaluation/privacy
  docs and this plan. No core implementation, model adapter, guard policy,
  old-result, README or release edits. Run both Node22.16 and24.15 generic tests,
  JSON/strict plugin checks, full offline live-evidence suite, LongMemEval suite
  and all three ingestion/comparison/public demos. Primary inspects all changed
  code and personally reruns key gates; exact committed candidate receives two
  independent non-author Standards and Spec reviews. Deliver a dependent PR
  against main and complete its exact-head CI. No merge/release/deployment.

## Ownership

Primary owns contract, decomposition, privacy/behavior boundaries and acceptance.
Bounded actual Sol/high implementation is appropriate for asynchronous case
isolation and evaluation data integrity. Independent actual Sol/high reviewers
own Standards and Spec. Record evidence in this plan or the PR; do not infer
agent costs from model labels. No paid experiment or broader cap is authorized.
