# S2a — model-free memory lifecycle and inspection

Status: implementation slice, not completion of S2 or a model-quality release.
Fixed public base: `74f9d240192059b6c40046424b3fcc6bddba702c`.

This independently authored public slice implements the storage/inspection
portion of the agreed Memory/MOC target. It extends the existing SQLite store;
it must not create a second persistence engine. No private source, prompts,
fixture text, or configuration is copied. Existing Apache-2.0 public code and
Node built-ins are reused; no dependencies or model weights are added.

## Acceptance

- A1: Add `openMemoryCore({path})` from `core/contract.mjs`. Its implemented
  operations are `admit`, `list`, `get`, `correct`, `forget`, and `close` only.
  Operation results use `{ok:true,value}` / `{ok:false,error:{code,retryable}}`.
  Namespace is exactly `{ownerId,scope:'personal',projectId:null}` or
  `{ownerId,scope:'project',projectId}`. Unknown fields fail `invalid_input`.
  Scope is selected by trusted embedding callers, not authentication supplied
  by this library. No federation of personal/project inspection or mutations.
- A2: `admit({namespace,memory:{content,kind},receipts})` accepts 1..4 explicit
  source receipts `{client,sessionId,eventId,role,excerpt}`. Core assigns IDs,
  times, explicit origin/confidence 1. Exact duplicates preserve identity and
  unchanged revisions; new receipts commit atomically. Output is
  `{memory:{id,revision},deduplicated,indexRevision}`. Source receipt IDs are
  stable across restart and distinguish different memories' receipts.
- A3: All active memories start unfiled. `list({namespace,statuses?,limit?,cursor?})`
  returns `{memories:MemoryMetadata[],nextCursor,exhausted}`. `statuses` is a
  unique nonempty subset of `['filed','unfiled']`, default both; limit1..100,
  default20. Metadata is exactly id,namespace,kind,origin,confidence,revision,
  state,filing,receiptCount,createdAt,updatedAt; filing is `{status:'unfiled'}`
  in this slice. No content or receipt excerpts. Use SQL bounded keyset paging,
  order updatedAt DESC/id ASC; no latest-40 cap or full-store in-memory list.
- A4: `get({namespace,memoryId,receiptLimit?,receiptCursor?})` returns
  `{memory,receipts,placements:[],conflicts:[],nextReceiptCursor,exhausted}`.
  Memory is metadata plus content. Receipts include id,client,sessionId,eventId,
  role,excerpt,createdAt, ordered createdAt ASC/id ASC; receiptLimit1..100,
  default20. Read content, revision and bounded receipts in one transaction.
  Foreign/missing/forgotten IDs return memory_not_found, not cached data.
- A5: A persistent namespace epoch starts logically1, first mutation advances2.
  Every material memory/receipt mutation advances it; exact no-op does not.
  Cursors are opaque, tamper-evident, bound to store, namespace, operation,
  filters, limit, and epoch; survive restart. Malformed/mismatched cursors yield
  invalid_cursor, relevant mutation yields cursor_stale; another namespace's
  mutation does not stale them. Cursor payload must contain no memory prose.
- A6: `correct({namespace,memoryId,expectedRevision,content,kind,receipt})`
  preserves ID, advances revision/epoch, replaces sources, suppresses old
  content and returns `{memory,indexRevision}`. `forget({namespace,memoryId,
  expectedRevision})` returns `{forgotten,indexRevision}`; clears active text
  and receipts, suppresses replay across restart. Stale CAS writes nothing;
  missing/forgotten/foreign forget is false and does not advance epoch.
  Existing low-level remember/correct/forget paths share these transactions
  and epoch invalidation, so mixed API callers cannot bypass cursor safety.
- A7: Preserve existing low-level APIs and their result shapes. Atomic migration
  of committed schema v1 retains IDs/content/receipts/revisions/suppression and
  establishes namespace epochs. Reserve schema v2 for the unmerged engine draft;
  new schema is v3. Reject draft v2 and unknown/foreign schemas unchanged, do not
  import a broken draft or overwrite its data. No downgrade is promised.
- A8: Add executable synthetic SQLite scenarios and negative assertions covering
  A1..A7, two-connection mutation, separate-process restart, migration rollback,
  source pagination, suppression, namespace isolation and mixed-API access.
  A test adapter may read the frozen S1 oracle from an explicit local path for
  the documented supported subset; unsupported actions/assertions fail, never
  silently pass. Do not publish private oracle contents. Run npm test,
  npm run validate, npm run test:core, npm run demo:store on Node22.16;
  Node24 and isolated plugin checks when available. This JS repo has no tsc gate.

## Deliberately next, not implemented here

MOC records/placement/classification/map/fetch, token accounting, inferred
admission leases/conflict hints, recall final-read races, mock-model/MCP adapters,
all-45-case execution and real-model quality are subsequent S2 slices. Existing
lexical search is not semantic recall. No change to hosted plugin endpoints,
Moss, production, releases, private hosted migration or the unmerged engine PR.
The single public core remains the intended hosted dependency.

## Ownership and evidence

Primary owns scope, public provenance, tests/harness, integration and delivery.
A separate worker may implement core files in an isolated worktree; independent
Standards/Spec reviewers inspect the final committed diff. Actual assignments,
verification and correction outcomes are recorded in the PR. No private-source
rights or model-quality claim follows from this implementation.
