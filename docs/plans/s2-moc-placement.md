# S2b — MOC placement, hierarchy and bounded classification

Fixed base: `3b65135ef406dd279913b8f12cdde0184c5300b6` (merged S2a).
This delivers organization, not recall quality, MCP integration or all of S2.
New code, prompts and synthetic tests are independently authored in the public
repository. No private source/fixture text is copied; no new runtime dependency.

## Acceptance

- B1: Extend the existing shared SQLite runtime, not a second engine. Atomic
  v3→v4 migration adds persisted filing, namespace-bound L1/L2 groups, sourced
  titles and revision-bound memory memberships. v1 upgrades through v3; v2 and
  unknown versions remain rejected. Preserve receipts, IDs, suppression and
  store cursor identity. v3 cursors survive upgrade if their epoch is unchanged.
- B2: `applyPlacement({namespace,proposal,expectedMemoryRevisions,
  expectedIndexRevision})` is synchronous, model-free and atomic. Proposal is
  `{items:[{memoryId,parentIds,newL1?:{title,parentL2Ids,newL2Title?}}]}`.
  One to five unique memories; 0..3 unique existing L1 parents and 0..3 unique
  existing L2 parents per new L1; at most one new L1/L2 per item. Guards are
  exactly one `{memoryId,revision}` per item, no omissions/extras. All supplied
  IDs must be active, same namespace and correct level. Stale memory/index
  guards, missing groups or invalid hierarchy write nothing. Outputs:
  `{memories:Memory[],createdMocs:Moc[],refs:MocRef[],indexRevision}`.
- B3: New groups start revision1; existing groups whose direct memberships change
  advance once per transaction. Memory filing transition advances its revision;
  refs bind the resulting revision. Same filing with different parents advances
  group/namespace versions, not content revision. A replacement proposal sets
  the complete membership set. Exact no-op does not advance any version.
  Titles normalize/redact and contain1..120 Unicode code points; canonical
  same-namespace/level/title collisions with existing groups fail
  `moc_title_conflict`; identical creations within one batch coalesce with all
  responsible source bindings and at most three existing L2 parents. Newly generated
  titles bind all responsible memories' resulting revisions, never caller/model
  supplied source IDs. Stale title sources render null, never stale prose.
- B4: `linkMocs({namespace,parentId,expectedParentRevision,childId,
  expectedChildRevision,expectedIndexRevision})` permits L2→L1 only. It returns
  `{ref,indexRevision,duplicate}`; duplicate no-op, new edge advances parent and
  namespace. Group-to-group membership uses stable IDs and emits fresh versions.
  Memory can belong to multiple L1s; L1 can belong to multiple L2s.
- B5: Both legacy and envelope material admission changes/correct/forget remove
  previous memory memberships and invalidate source-derived titles in the same
  transaction. Changed active memories become unfiled; deleted text cannot remain
  in map labels/get placements. No-op admission retains filing. `list` filters
  actual filed/unfiled state; `get` emits current validated placements without a
  model, with revision-consistent content/receipts. Empty L1 and L2 with no valid
  descendants disappear from recall maps, but classification sees empty groups
  to avoid duplicate creation (invalid titles remain null).
- B6: `map({namespace,purpose?,parentRef?,limit?,cursor?,tokenBudget?})` is a
  synchronous read, default purpose recall, limit100 (1..100), budget4000 (1..4000).
  It emits `{items,nextCursor,exhausted,truncatedBy,indexRevision,invalidRefs}`.
  Items are group snapshots `{type:'moc',moc:{id,level,title,revision}}`, refs
  `{type:'ref',ref:{parentId,parentRevision,childType,childId,childRevision,
  relation:'contains'},label}`, or `{type:'unfiled',ref:{memoryId,revision},label}`.
  Root includes both levels/edges/unfiled; parentRef `{mocId,revision}` restricts
  to direct children and edges. Labels are first120 Unicode points of redacted
  current content; no full body/receipts field. Check both endpoints' namespace,
  state, level and memory revision before emitting. Report broken/stale refs as
  `{parentId,childType,childId,reason:'stale'|'not_found'|'invalid_level'}` and
  never their content. Deterministic order by level, visible title, ID, ref.
  SQL reads return bounded pages, not full-store JS materialization. Cursors bind
  namespace/store/operation/purpose/parent/limit/budget/epoch and survive restart.
  Mutation stales them. Only exhausted:true means complete. An item/envelope too
  large returns context_item_too_large, not an infinite non-progressing cursor.
- B7: `openMemoryCore({path,model?})` optionally accepts an injected adapter with
  `contextWindow`, synchronous `countTokens(text)`, asynchronous
  `classify({system,input,maxOutputTokens,signal})`. No default model or network
  adapter is bundled. Map requires its local counter, not classify; missing or
  invalid counters fail token_count_unavailable. Counter must count exact text
  for the adapter's model (mock counts are test-only). Map budgets cover the
  serialized success envelope including cursors/invalidRefs, with fresh epoch
  validation after counting so an adapter cannot cause stale content emission.
- B8: `classifyPlacement({namespace,memoryIds,expectedMemoryRevisions,mapRevision})`
  is async and returns `{proposal,basedOn:{memoryRevisions,indexRevision,mapExhausted}}`.
  Use at most one model call outside transactions; a bounded classification map
  and selected current memories only, never foreign memories. Strictly validate
  all output fields, unique requested memory IDs, visible existing group IDs and
  correct levels. Incomplete map forbids creation; no catch-all auto fallback.
  Classification only proposes; never writes. Apply is a separate guarded call.
  A mutation during counting/model work fails stale revision/index before a
  proposal can be returned. Missing model, invalid output, timeout, oversized
  context and unavailable counter are explicit errors; admitted memory remains
  inspectable. Context≥8192, request≤6000 counted tokens, output cap1024 tokens,
  protocol reserve1024. Classifier timeout is30 seconds with AbortSignal;
  scripted adapter timeouts also map to an explicit model_timeout error.
- B9: Real temporary SQLite plus scripted mock tests exercise new topics,
  multi-membership, existing-group reuse, canonical duplicate rejection,
  correction/re-placement, empty-group hiding, unfiled failure, cross-scope and
  invalid-level rejection, stale proposal/no partial creation, hierarchy, source
  invalidation, cursor/token incompleteness, restart/migration and legacy writes.
  Mock prompt injection/forged IDs are rejected, never treated as instructions.
  Required gates: existing core/plugin tests, validate, demo, plugin validation;
  core tests on Node22.16 and24. JS repository has no TypeScript gate. Mock success
  proves orchestration/contracts, not semantic classification or recall quality.

## Explicitly later

Fetch/recall orchestration, inferred admission leases, conflict hints, index rebuild
generations, real tokenizer/provider adapters, real-model quality, MCP, hosted
migration and Moss are not delivered here. The earlier draft engine is untouched.

## Integration ownership

Primary owns facade, classifier, public prompt, mock/testing, docs and acceptance.
An isolated worker owns database/runtime/MOC persistence. Independent reviewers
inspect the same final base/candidate diff; results and corrections go in the PR.

Internal runtime seams (not authenticated public APIs):
`applyPlacement(ns,proposal,guards,index)`; `linkMocs(ns,input)`;
`mapRows(ns,{purpose,parentRef,limit,offset,expectedEpoch})` returns
`{rows:[{item}|{invalidRef}],epoch}` with at most limit+1 rows; offset advances
over both row kinds. `classificationSnapshot(ns,ids,guards,index)` returns
`{memories:Memory[],indexRevision}` atomically; `assertEpoch(ns,index)` throws
index_revision_conflict. `getPage` additionally returns `placements`.
No model/token-counter callback runs inside SQLite transactions.
