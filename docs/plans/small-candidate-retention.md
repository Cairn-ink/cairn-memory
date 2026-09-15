# Bounded small-candidate retention experiment

Base `2f9539e53b737f18fd4a6c59380eb05671aefd92`.
This evaluation-only algorithmic intervention tests post-selection loss in the
existing shared core. It does not promote a new product policy, discover related
updates, raise a cap, change a prompt or introduce another memory engine.

## Rationale and seam

Earlier retained comparisons lost required passages at ranking even when the
complete selected set fit the requested result limit. Ranking also rejects
irrelevant evidence, so preserving everything is not assumed better. The new
same-source answer record did not establish reliable interpretation and remains
evaluation-only; this experiment addresses a separate engine decision.

Use a model-port wrapper at the existing shared core's rank seam. For a nonempty
fetched candidate set no larger than `input.limit`, return all of its exact
namespace/memory/revision references in existing order, without a provider rank
generation. Empty input returns no references. For a larger set, call the captured
original rank method once with an unchanged detached request and propagate its
result/error without retries or fallback. Selection and other model ports stay
unchanged. The wrapper runs inside the real core's `callModel` path, retaining
its exact input/output token checks, source freshness checks and authoritative
final reread. It is a policy experiment on that core, not semantic verification.

## Acceptance

1. Add `evaluation/architecture/small-candidate-model.mjs`, exporting
   `createSmallCandidateRetentionModel(model)`, with no I/O, database, transport
   or credential discovery. Require original rank, exact tokenizer and existing
   contextWindow>=8192. Snapshot bound rank/counter functions. Preserve all other
   ports. Constructor and malformed requests fail with existing content-free
   errors. No new public core/MCP input option or default change.
2. Validate the rank request shell (system/input/maxOutputTokens/signal), query,
   limit1–12, candidate collection<=36, and unique safe namespaceIndex + existing
   memory.id/revision identities before deriving references. Preserve complete
   candidate values in the larger-set delegated request; do not infer relations
   from source text. No caller-owned getters/serialization may silently change
   a counted request or returned reference set. Use immutable snapshots and
   existing validation/budget conventions; reject malformed data rather than
   repairing or truncating it.
3. Count the actual `{system,input,maxOutputTokens:1024}` serialization<=6000;
   synthetic output must fit unchanged40000-character/1024-token limits. Preserve
   abort checks before/after caller callbacks and delegated completion. Check
   output identity/serialization after any counter callback before returning.
   Larger-set calls retain original provider validation plus shared-core final
   validation; no extra generation or hidden retry. Do not claim this wrapper
   independently certifies post-call source freshness.
4. Independent tests cover below/equal/above limit, empty input, malformed/duplicate
   refs, counter errors/overflow/mutation, pre/late abort and original rank errors.
   Exercise the actual core with a synthetic temporary store: baseline rank drops
   a selected changed/reaffirmed reason while wrapper retains all within limit;
   larger sets still delegate. Correction/forget during callbacks must reject
   stale output, with namespace and receipt identity preserved. SQLite-only tests
   skip explicitly on Node20; pure tests still run. No real models or user data.
5. Characterize—not hide—the negative behavior: a small selected set with another
   actor's material or unadopted advice remains exposed, and a baseline rank result
   of “none relevant” can become a nonempty candidate result. Do not label these
   semantic successes. Documentation requires fresh fixed positive/negative real
   comparisons before integration, reports saved rank calls and added context,
   and separates navigation misses from post-selection retention.
6. Root generic/JSON/strictplugin validation on Node22.16/24, independent exact
   commit Spec/Standards review, and all17 CI before merge. This package grants
   no paid experiment, publication, deployment or promotion by itself.
