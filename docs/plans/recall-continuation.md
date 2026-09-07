# 1e — bounded recall continuation and contract inventory

Fixed parent: `d91c60651c3d224eee5e8154a4eb6ab6ca27ba42`, branch
`feat/index-rebuild`, [PR #14](https://github.com/Cairn-ink/cairn-memory/pull/14).
Stacked continuation is authorized; no self-merge, release or deployment.

## Frozen behavior

Keep `recall({readSet,query,limit})` and its result shape unchanged. No new model
provider, namespace authority, schema, public configuration or hidden fallback.
The root map already contains both hierarchy levels and their memory refs, so
follow root-map cursors rather than inventing model-directed traversal tools.

1. Round one consumes one root-map page per authorized namespace (at most two)
   and makes one select call with those pages. Allow only exact visible memory
   refs, at most 24 total and 12 per namespace as before.
2. If any namespace remains incomplete, consume its next page, at most one more
   page per namespace, and make one additional select call. Preserve the original
   namespaceIndex even when another namespace has already exhausted. Each round
   has its own exact visible-ref allowlist; old-round refs not visible again
   cannot be fabricated into round two. Include `maxRefs` in selector input:
   round one 24, round two min(24, 36 minus unique refs already selected), with
   the existing 12-per-namespace output cap in each round. Reject excess output,
   not silently truncate it. Deduplicate across rounds/multiple parents by exact
   namespace index, memory ID and revision, preserving first occurrence order.
3. Fetch each unique selected memory initially once. If that fetch has a receipt
   cursor, consume exactly one continuation using the same singleton ref list
   and budget. Merge the contiguous ordered receipt prefix, never skipping a
   page or duplicating receipt IDs. Unexpected duplicate IDs or mismatched memory
   identity/revision across trusted pages fail `revision_conflict`, not a falsely
   complete response. Record fetchExhausted=false if a third page would be needed.
4. Rank all fetched candidates once, unless none exist. No silent candidate or
   evidence dropping to fit context: an oversized accumulated ranking request
   returns existing `context_budget_exceeded`. Selection/ranking retain existing
   allowlists, output checks, context ceiling and deadlines.
5. After the final model/tokenizer callback, pass ALL unique fetched candidates
   (including unranked ones) and each accumulated receipt-prefix length to the
   existing authoritative snapshot. Validate every candidate revision and reread
   selected contents/receipts there; never return cached fetch bodies. A changed,
   forgotten or foreign candidate fails with no payload. No callbacks afterward.

## Fixed ceilings and coverage

At most two selection calls plus one ranking call; four map pages; 36 distinct
fetched memories; two fetch pages per candidate, at most 72 fetch operations and
200 receipts per candidate. Each map/fetch response remains <=4,000 counted
tokens; conservative aggregate storage-response ceiling is 304,000 tokens
(4+72 responses). This upper bound is not a target cost or performance claim.
Each model call still permits <=6,000 input and <=1,024 output tokens with the
existing framing reserve/context requirement. Large evidence batches can fail
that stricter request ceiling; tighter packing is a future measured optimization.

mapExhausted reflects the last consumed page for each namespace independently.
fetchExhausted is true only if every selected candidate in that namespace has
fully consumed receipts; no candidates means true. coverage is complete only if
both flags are true for every namespace, otherwise budget_exhausted, including
empty output. These flags describe examined ranges, not semantic quality.
Intermediate cursor staleness/errors propagate explicitly. Map/fetch continuation
does not weaken the final candidate revision check or namespace read-set binding.

## Acceptance

- T01: targets beyond first map page in personal/project namespaces are reachable;
  exhausted namespaces are not paged twice and retain correct namespace indices.
- T02: round-specific allowlists reject forged old/foreign/group refs, duplicate
  output and excessive round/namespace counts without writes or payload.
- T03: deterministic two-round limits cap three model calls, four map pages,
  36 unique memories and 72 fetch operations. Cross-page multi-parent duplication
  does not spend additional fetches or appear twice in final results.
- T04: two receipt pages form a unique ordered contiguous prefix; a remaining
  third page is explicit incomplete. Empty complete versus budget-exhausted
  output remains distinguishable. No hidden receipt truncation claims.
- T05: oversized selection/ranking requests, output/counter errors and deadlines
  preserve existing error envelopes. No fallback or semantic-success assertion.
- T06: another connection corrects/forgets during either selection round, receipt
  continuation, rank or final counting: no stale/cached memory or receipt escapes.
  Every fetched candidate remains in final validation, not only ranked ones.
- T07: unchanged baseline contracts, all core tests and eight demos pass on Node
  22.16/24, plugin tests, JSON and isolated plugin validation pass. Independent
  Standards and Spec reviewers inspect the same fixed committed candidate.
- T08: publish a source-operation-to-test inventory under docs/plans, identifying
  implemented versus preview/excluded obligations without equating source tests
  to provider quality, standalone MCP, client compatibility or commercial cutover.

Engine worker owns core/recall.mjs and prompts/recall-select.md. Test worker owns
new continuation tests plus existing recall tests whose first-page-only assertion
must change; do not weaken old safety checks. Primary owns docs/demo/CI/facade
integration and the inventory. Existing fetch/runtime need no change unless a
concrete verified defect requires coordinated scope adjustment.
