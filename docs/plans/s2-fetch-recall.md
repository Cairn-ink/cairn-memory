# S2c — revision-safe fetch and bounded recall

Base: `831afbce07197d8ec01099ad2523c8c7c2727f7c` (merged S2b).
Independently authored public implementation; same runtime/schema, no private
code/prompts/fixtures, no new dependency or hosted/plugin/Moss change.

## Acceptance

- C1: Synchronous `fetch({namespace,refs,cursor?,tokenBudget?})` accepts 1..12
  unique `{memoryId,revision}` refs in one exact namespace. Unknown fields,
  duplicate IDs, invalid revisions/budgets reject before content reads.
  Missing/foreign/forgotten refs produce `{memoryId,reason:'not_found'}`;
  changed revisions produce `stale`, without content/receipts.
- C2: Return `{items,nextCursor,exhausted,truncatedBy,indexRevision,invalidRefs}`.
  Items are `{memory,receipts,receiptCount}` using current core DTOs. One ref
  per page, at most 100 receipts; receipt order is createdAt/id ascending.
  Receipt overflow continues the SAME memory through the response cursor;
  consumers combine receipt IDs. Once all receipts are consumed, move to the
  next requested ref. Invalid refs also advance. Only exhausted means all refs
  and all their receipts were examined. SQL receipt materialization is bounded.
- C3: Budget defaults to 4000, range 1..4000; count entire success envelope
  including cursor and invalidRefs with injected local counter. Missing/invalid
  counter fails explicitly. No heuristic production counter. Too-large first
  memory+receipt/envelope fails context_item_too_large, never a stuck cursor.
  Cursor authenticates store, namespace, operation, ordered refs, budget and epoch;
  restart survives, mutations stale, cross-operation/filter/tamper rejects.
  Revalidate epoch after counter callbacks, before returning any payload.
- C4: Async `recall({readSet,query,limit?})`, limit default 6/range 1..12.
  ReadSet is one exact namespace or personal+one project of the same owner;
  duplicates, mixed owners, multiple projects and unknown fields reject with
  invalid_read_set before model work. Query normalized/redacted, 1..4000 UTF-16
  units. Namespace authority belongs to trusted caller, never model output.
- C5: Read one bounded recall-map page per namespace. Injected `model.select`
  receives query and these maps; returns `{refs:[{namespaceIndex,memoryId,revision}]}`,
  at most 12 per namespace/24 total, only exact visible memory refs (not MOC IDs).
  Fetch one bounded receipt page per selected memory, separately scoped. Then
  injected `model.rank` sees query and fetched current memory/receipt items and
  returns the same ref shape, a unique subset of supplied candidates, at most
  requested limit. Empty selections are valid; invented IDs/revisions/namespaces,
  extra fields and malformed arrays are invalid_model_output. No fallback to
  lexical hits, recent-40 candidates, cloud, catch-all or fabricated receipts.
- C6: At most two model calls (within the three-call contract ceiling), at most
  24 fetched memories (within 36), no hidden traversal or unbounded retries.
  Both calls require contextWindow >=8192, exact counted request <=6000,
  counted output <=1024, maxOutputTokens 1024, framing reserve 1024 and a
  30-second AbortSignal deadline. Missing model/counter, timeouts and overruns
  are explicit failures. Models/counters never run inside database transactions.
- C7: Result `{memories:FetchItem[],namespaces:[{namespace,mapExhausted,
  fetchExhausted}],coverage:'complete'|'budget_exhausted'}`. Namespaces retain
  requested order. Fetch exhaustion is false if any selected memory has receipt
  overflow; map incompleteness independently makes coverage budget_exhausted.
  Complete means bounded inputs fully examined, not proof of semantic relevance.
  Empty incomplete result must remain budget_exhausted.
- C8: After final model work/counting, validate every fetched candidate revision
  and materialize selected memories/receipt prefixes in ONE authoritative SQLite
  transaction spanning both authorized namespaces. Missing/forgotten/foreign/
  revision-changed candidates fail entire recall with revision_conflict and no
  payload; never emit cached fetched objects. Deletion before this snapshot must
  be observed. Changes after snapshot affect later reads. Do not call adapters
  after this linearization point. Neither fetch nor recall writes memory/index.
- C9: Synthetic real-SQLite tests cover valid/invalid refs, receipt continuation,
  tamper/filter/store/restart cursors, counter-time mutation, many-to-many dedup,
  read-set isolation, empty/incomplete selection, prompt-injection-shaped output,
  model limits and mutation during final model/counting including another SQLite
  connection. Source-runnable mock demo; no real-model quality claim.
  Gates: core tests on Node 22.16 and 24, plugin tests, JSON and isolated plugin
  validation, existing store/MOC demos plus recall demo in both CI runtimes.
  No TypeScript gate in this JavaScript repository.

## Later

Adaptive map traversal, additional receipt pages during recall, real provider/
tokenizer integration and semantic evaluation, MCP, hosted migration, admission
leases/conflicts/rebuilds and Moss remain separate milestones.
