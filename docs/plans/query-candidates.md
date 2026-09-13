# Query-aware bounded recall candidates

Owner continuation: keep advancing without waiting for merges; additional USD50
phase authority remains, with USD0.04 already conservatively reserved. This slice
is offline only. No credential access, paid retry, merge, release or deployment.
Fixed base: PR65 `b3429f1246c942b3b8adcb68e955d68abb7716c2`.

## Outcome and sequence

The current two query-independent root pages hide correctly stored memories.
Replace only recall's private candidate-page policy with a bounded query-aware
memory candidate path, retaining the public map and MOC organization. This is
literal candidate generation within the shared core, not semantic search or a
claim that vectorless retrieval is categorically different from RAG.

After offline safety and reachability pass, independently review this exact
candidate. Next compare retained baseline diagnostics and separately frozen real
model queries; then evaluate bounded topic routing as an additional signal for
paraphrases. Memory-update/adoption failures remain another open gate.

## Acceptance Q1–Q8

- Q1: before ranking/page packing, inspect at most 1024 exact-namespace memory
  rows plus one sentinel in deterministic indexed ID order. Historical/deleted
  rows count against that scan allowance; do not read arbitrary rejected rows
  while claiming bounded work. Only current, nondeleted records are eligible.
  Score eligible full bodies by distinct literal Unicode letter/number query
  tokens (lowercase; whole runs, no stemming, dictionary segmentation or synonyms).
  Sort descending overlap, then stable ID. Retain zero-overlap candidates; no
  lexical match is not proof of absence. Bound input/body lengths as today.
- Q2: a correct explicit exact-token target beyond ordinary map page two but
  within the scan allowance reaches actual select input and sourced recall.
  Show correct, misleading and no placement, unrelated unfiled distractors,
  large/small stores and multiple required targets. Duplicate placement edges
  must not consume multiple candidate slots for one memory.
- Q3: use real current placement references when available and true unfiled
  references otherwise, following existing projection validation/fallback
  semantics. Do not fabricate edges or reclassify a filed memory to reuse a DTO.
  Public map ordering/input/output, classification catalog, stored hierarchy,
  database schema, model output ports and adapter allowlists remain unchanged.
  Private candidate pages may omit group headers; document that input-policy
  change, including loss of group context and future topic-routing work.
- Q4: retain two select calls, 100-item/4000-token page envelopes, existing
  selected/fetched/ranked limits and authoritative final snapshot. If scan or
  candidate pagination is incomplete, keep incomplete coverage even when a
  matching result is returned. No infinite or empty continuation loop at the
  scan ceiling. Private cursors bind namespace, epoch, query digest, policy
  version, scan allowance and position; reject forged/stale/cross-query/public
  cursors. Preserve prior callbacks' mutation defenses, including an empty result.
- Q5: inspect exact owner/project/personal namespace only. Forgotten, superseded,
  stale or foreign evidence must not enter model inputs. Correction, forgetting,
  supersession, filing and index rebuild during token counting/select/rank retain
  existing fail-closed freshness and index behavior. No provider in core.
- Q6: tests include deterministic 1023/1024/1025-row scan boundaries (including
  tombstones/history), crowded score ties, whole-token CJK vs substring misses,
  paraphrase/synonym misses, lexical decoys, multiparent and namespace controls.
  Treat visibility-oracle success as reachability only; never model quality.
- Q7: document rows inspected and bytes scored; inspect SQL EXPLAIN for the
  namespace scan. Distinguish returned-row/JS scoring bounds from total SQLite
  page I/O and auxiliary projection lookup cost. No unmeasured latency claim.
- Q8: both Node22.16/24 generic/JSON/plugin, core/store/MOC/recall/continuation,
  OpenAI offline/MCP and artifact-install gates; the explicit package allowlist
  must include every new runtime import. Relevant safety tests and isolated fresh synthetic
  stores. Explain intentional old-order regression changes instead of weakening
  assertions. Freeze, independent Standards/Spec review, fix/reverify/review,
  then PR against main. No merge is required to begin the next verified slice.

Implementation may split a small private scorer/storage helper, but must not
duplicate the engine or change hosted/private application code. If an acceptance
criterion exposes an architectural problem, report and resolve it before delivery
rather than silently claiming the criterion is met.
