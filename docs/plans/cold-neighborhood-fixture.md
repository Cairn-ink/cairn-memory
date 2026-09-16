# Fresh cold-session source utility fixture

Fixed base: `c82a6eb00ace70ca78a30bbefdecbba9b1aadb8b`.

## Purpose

Prepare fresh source histories and evaluator-only obligations for a later
capture → cold restart → ordinary MOC recall → answer comparison. Earlier
source/basis and source-by-source hint comparisons did not show a reason to
promote more graph inference. Compare ordinary source recall against bounded
neighborhood-expanded **original sources**, without giving graph interpretations
to the answerer. This is preparation, not a paid run or a reliability score.

## Acceptance

- CF1: Four fresh synthetic timelines, each 12–18 original messages across
  three ordered capture batches, with at least five unrelated/different-scope
  distractor messages. Keep each message under 600 UTF-16 units, each batch
  under 4,000 units; use existing capture-compatible user/assistant message
  shapes after checking the public contract. Each timeline has one final
  user-facing question. Vary wording rather than reusing prior press/logger/
  department/provider/courier or old benchmark stories. Describe these as
  modest synthetic histories, not a long-horizon or blind benchmark.
- CF2: Cover (a) a premise genuinely changes while an independent reason and
  recorded choice remain; (b) a proposed option is explicitly unadopted before
  a later confirmed replacement with new reasons; (c) a late-imported dated
  source and separate actor/scope cannot undo a later effective update; and
  (d) a temporary exception plus a genuinely missing current fact requiring
  limited abstention. Include positive answer obligations so refusing every
  question cannot pass. Date statements are source content, not storage order.
- CF3: Keep model-facing source batches/questions separate from a frozen
  evaluator-only JSON rubric. For each answer obligation record supporting
  message IDs and exact unique source passages, historical/current/proposed/
  unknown distinction, forbidden inferences, and whether full or partial
  support is needed. State that anchors establish provenance, not automatic
  semantic correctness. Do not leak expected relationships or answers into
  model-facing fields. Ordinary dialogue can of course contain the facts.
- CF4: Evaluation instructions distinguish source submitted, retained after
  capture, selected root, linked-source expansion, evidence in final answer
  request, and answer correctness. Loss at one stage is not repaired by gold
  source injection at another. No manually admitted scored memories, seeded
  graph, forced oracle selection, regex/date override, retry or case replacement
  is allowed in the later scored comparison. Offline smoke fixtures may be
  scripted but must be explicitly separated from scored semantic evidence.
- CF5: Both arms must share the exact same captured store checkpoint and the
  same answer model/instructions/limits; they use different explicit recall
  modes. Different selected source sets make this a read-path utility comparison,
  not an equal-context causal ablation. No graph or basis proposals enter either
  answer request. Record partial traversal, more than six distinct returned
  sources, overflow, failed capture/retrieval/answer and all unrun slots as
  failures/unavailable, never correct abstentions. Do not change existing caps.
- CF6: Add bounded generic consistency tests for unique case/message IDs,
  batch/date metadata, size limits, source/rubric separation, all referenced
  message IDs and exact passages, counts and required rubric sections. Tests
  validate artifact consistency, not the semantic gold itself. Freeze sources
  and rubric only after independent source review and before any paid call.
- CF7: One non-consumer-author Sol/high worker owns source fixture, separate
  rubric, one concise protocol document, consistency tests and this plan only.
  No runtime/prompt/provider/guard/operator/budget/ledger/capture settings changes.
  No paid requests or credentials. Generic/JSON/strict plugin validation must
  pass Node22.16/24.15; freeze scoped commit for primary inspection and independent
  Standards/Spec review. No push/merge/release until instructed by primary.

Paid execution still requires a separate frozen operator, offline rehearsals,
review, cumulative-ledger preflight and an exclusive one-shot intent. This
packet neither grants that capability nor predicts the results.

## Frozen packet record

The packet contains four synthetic cases with 15 original messages in three
ordered batches each, one final question per case, a separate evaluator-only
rubric, a later-run protocol, and generic artifact-consistency tests. The
source fixture SHA-256 is
`fc28ec650a12b725397788d485c547566c63b050289dbdd834890bcb5fddc472`;
the rubric SHA-256 is
`80b02491e0558f5068f5c208cf3d691663284e970b8e8b3feb43723e0860b1e9`.
These hashes identify review inputs, not semantic validation.

The focused tests pass 2/2 and the full generic suite passes 141/141 on both
Node 22.16.0 and 24.15.0. Repository JSON validation and the pinned marketplace
plus strict plugin validation pass on both versions. These checks verify
structure and existing contracts only. No scored capture, recall, answer, or
paid request has run; every case and arm remains unrun.
