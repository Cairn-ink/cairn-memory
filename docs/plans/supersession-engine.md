# B1: durable supersession in the shared engine

Fixed base: merged main `194e2a6ef3387a8d87ea0736b722eaf31e83c6f7`.
Implements the storage foundation of [B](cross-window-supersession.md), not
automatic capture reconciliation. B is split into B1 (this package) and B2
(capture judgment and provider wiring) so migration and retrieval safety have
an independently reviewable gate. C remains fresh real-provider/installed
evidence. No release, merge, deployment or paid calls in B1.

## Frozen implementation contract

### B01: explicit operation and transaction

Add a model-free core operation:

```js
core.supersede({ namespace, memoryId, expectedRevision,
  replacement: { content, kind }, receipts: [receipt] })
```

Namespace, predecessor ID/revision, replacement and one to four receipts use
existing strict core validators (replacement max4000 content units, same as
explicit admit). Unknown fields reject. The operation is a trusted caller's
explicit replacement assertion, not semantic detection or a new MCP tool.
Result envelope is `{ previous: {id, revision}, memory: {id, revision},
deduplicated, indexRevision }`; previous revision is the resulting historical
revision. The replacement is explicitly sourced, confidence1. Validate the old
same-namespace undeleted/current record and expected revision before admission;
missing/foreign returns memory_not_found, stale returns revision_conflict,
already historical with the freshly inspected revision returns memory_historical.
Validation order is existence → revision → currentness: replaying the original
pre-retirement revision returns revision_conflict. Same normalized fingerprint
returns invalid_ref. Suppressed replacement returns memory_suppressed.

In one existing runtime transaction: admit/deduplicate the replacement using
the shared mutation, bind its final revision and actual selected receipt IDs,
persist the transition, retire the predecessor, invalidate its conflict/MOC
references and advance the namespace epoch. Any error, including the sixth
incoming transition, rolls back admissions, attached receipts, both revisions,
links, suppression and epoch. Repeated stale calls fail before a new write;
capture completed-event replay remains idempotent without new model calls.

### B02: v8 state and directional evidence

Add `memories.currentness` with `current` default and `historical` alternative,
independent of deletion and filing. Existing records migrate as current; do not
infer history retrospectively. Use a separate directional transition table,
one outgoing edge per predecessor, maximum five incoming per successor.
Persist exact namespace, predecessor judged revision, successor committed
revision and one to four actual replacement receipt IDs. No copied bodies,
excerpts, credentials or transcript payload. No recursive inspection.

Retirement preserves predecessor content and receipts, increments its revision,
marks it historical, and suppresses its fingerprint using the existing durable
suppression mechanism. This blocks later admission/re-extraction from turning
the retired content current; it does not delete or forget historical evidence.
It stays historical if the successor is corrected, forgotten, filed, receives
receipts, or is itself superseded. Do not reuse revision-invalidating symmetric
contradiction links for this durable relation.

### B03: reads and index correctness

`get` and inspection `list` retain undeleted historical records and set their
existing `memory.state` to `historical`; current records retain `active` and
their existing DTO shape. `get` adds `supersession` ONLY for historical records:
`{previousRevision, replacement: {memoryId, revision, currentRevision, state} | null,
receiptIds, evidenceAvailable}`. Stored transition revisions are immutable;
currentRevision is the present undeleted successor revision, NOT a claim of
current applicability; state is its `active` or `historical` status. A→B→C
inspection of A must label B historical without recursively returning C. receiptIds is the
subset still belonging to that same-namespace undeleted successor. Evidence is
available only when ALL originally bound receipts remain; absent/corrupt/foreign
successor yields null replacement, empty receiptIds and false. Do not echo
foreign identifiers, missing content or invented receipts. Explicit subsequent
inspection of a successor uses existing namespace checks. No incoming-edge
array or recursive expansion is exposed.

Default map, classification candidates, fetch, final recall, legacy get/list/
search and rebuilt index projections exclude historical memories, including
historical title sources and fallback branches. Fetch uses existing not_found
for historical refs; a retirement during recall's model work makes final
validation fail revision_conflict without returning stale content. Existing
active DTO shape stays unchanged. Filing historical memories rejects
memory_not_found; history remains inspectable even if an index is unavailable.

### B04: correction, forgetting, conflicts and replay

Correcting historical memory rejects memory_historical after its revision guard;
this intentionally preserves the historical claim/receipts rather than silently
editing prior evidence. Forget remains permitted with the current historical
revision and clears its body/receipts. Forgetting a successor never reactivates
a predecessor and history does not copy its forgotten content/receipts. Ordinary
current correction keeps existing suppression/revision semantics; relation
inspection reports unavailable evidence when its bound receipts were replaced.
New contradiction hints cannot target historical records. Existing predecessor
conflicts are invalidated on retirement. Exact-content inference of historical
text contributes to the existing suppressedCount; completed replay cannot
reattach receipts, restore content or erase the transition. Historical
fingerprint reactivation is intentionally unsupported, even for explicit admit.

### B05: migration compatibility and bounds

All supported old versions 1,3,4,5,6,7 upgrade atomically to8; draft2 and future
versions remain rejected. Preserve IDs, receipts, suppression, claims, store
identity/cursor secret, namespace epochs and staged/published index generations.
Upgrade index views/triggers atomically; unchanged current-only data must keep
existing signed cursor behavior and rebuild progress. No destructive cleanup,
down migration or live database use. Failure/DDL collision leaves original
version and state intact and permits a clean retry. Verify competing writer
failure. One-hop relation inspection and one-to-four receipt IDs bound work;
no unbounded history traversal or replacement fan-in.

Upgrade requires closing ALL older-runtime processes/connections, including
idle readers, before opening with v8. Mixed-version coexistence is unsupported:
a previously opened v7 process cannot be retroactively fenced by v8's startup
version check and may use old currentness rules. A lock-contention test does
not prove old-reader exclusion. Document this operational prerequisite and
retain tests rejecting newer formats on open; do not claim automatic process
coordination or a zero-downtime upgrade.

### B06: executable evidence and delivery

Independent actual-core synthetic tests must cover positive explicit replacement
and receipt preservation, cold reopen, explicit retry and capture replay,
owner/project isolation, self/stale/historical/suppressed/invalid failures,
incoming bound and late-write rollback, two-connection/process stale writers,
correction/forget of either endpoint, current retrieval (including final-recall
mutation), MOC/rebuild and migration. Preserve the baseline capture gap tests
with explicit B2-pending naming: B1 does NOT fix automatic capture. Convert those
to positive target tests in B2 when wired, not by adding a manual supersede call
and pretending capture resolved the change itself.

Run both Node22.16 and24: generic tests/validate, entire core suite, all store/
MOC/recall/admission/capture/conflict/rebuild/continuation demos, MCP suite and
adapter regressions affected by changed inspection semantics. Pin Claude
validations. No TypeScript gate exists. Update public local docs, changelog and
roadmap, then exact-commit independent Standards and Spec review before push.
Real model quality and installed artifact acceptance are not claimed by B1.
Local retention/threat documentation must explicitly say supersession retains
old content/receipts until separately forgotten and is not deletion or secure
erasure. Tests must verify metadata-only lists and foreign history non-disclosure.
Include every new imported runtime module in the explicit artifact allowlist;
run cache preparation and artifact tests on both runtimes. These install tests
verify packaging/ordinary lifecycle, not the separate C semantic gate.

## Next dependent B2 gate

Before B2 edits, freeze candidate and evidence bounds, model judgment schema,
source-role/authority policy, transaction/claim/retry integration and exact
status/error behavior. Resolve unseen out-of-order ambiguity explicitly; opaque
event IDs and arrival timestamps are not chronology. The judgment must bind
model indices to trusted snapshots and revalidate namespace epoch, revisions
and source receipts inside the same batch completion transaction. Reuse B1
history/invalidation logic; do not implement a second storage engine. Existing
capture shape remains strict until the reviewed B2 contract says otherwise.
