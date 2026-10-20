# Three-layer engine contract

Status: **Future full-V1 contract remains DRAFT FOR OWNER REVIEW**. The separately
authorized bounded local implementation is recorded in the
[execution addendum](#execution-addendum-bounded-local-private-cards).
Recorded 2026-10-20; baseline public main
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`, inspected documentation candidate
`18f01e385f895f2402aea3e849eee1dc712454db`. This contract makes the
[architecture agreement](memory-architecture-alignment.md) reviewable. Every new
object, field, method, limit and capability in the original full-V1 proposal is
prospective unless selected by that addendum. The local slice's exact implemented
API and limitations are in [the local guide](../private-cards-local.md); default
retention and full Raw/hosted/production gates remain unchanged.

The same public engine owns Raw/Source, Memory and private Knowledge Cards,
their provenance, invalidation, two typed MOCs and bounded common evidence reads.
Hosts own authentication, UI, final answers, publication, destination ACLs and
product quotas. Use the existing core/runtime, not a parallel Card engine.
Roles are not a forced pipeline: Raw may support Memory, directly support a
Card, or be located through a Memory for optional Card drafting. Normal capture
continues to create Memories; it does not automatically create Cards.

## 1. Existing baseline and reuse

| Existing contract / source | Reuse and boundary |
| --- | --- |
| [Facade](../../core/contract.mjs), [runtime](../../core/runtime.mjs), [legacy facade](../../core/index.mjs) | One transaction runtime and exact namespaces. `admit`, `get`, `list`, `correct`, `forget`, `supersede`, `fetch` and `recall` exist. No Card lifecycle, Card MOC or common Memory/Card API exists. |
| [Database](../../core/database.mjs), [confirmation schema](../../core/confirmation-schema.mjs) | Current schema is **v18**. Memories have positive revisions; receipts have IDs, attributed role, excerpt and receipt identity, **no independent revision**. Existing Raw/Memory schemas are unchanged by this document. |
| [Memory review](../../core/confirmation-storage.mjs), facade `confirm` / `reject` | Review awaiting Memories and held transitions under `decisionReview:'required-v1'`. They are not Card confirmation, publication or trusted action authentication; do not reuse their names as evidence that Cards ship. |
| [Source evidence](../../core/source-evidence.mjs), [qualification](../../core/claim-qualification-input.mjs), [source snapshot](../source-evidence-context.md) | Validate actual retained receipts and canonical Memory revisions. Complete retained receipts are not complete conversations or proof of adoption. Existing source/qualification DTOs remain strict. |
| [Episodes](../../core/episode-schema.mjs), [reads](../../core/episode-reads.mjs), [staging](../staged-capture-evidence.md) | Bounded episode passages and expiring staging are distinct source projections. Neither can masquerade as full Raw. Existing `forgetEpisode` behavior differs from future RL-2's D5 cascade. |
| [MOC storage](../../core/moc-storage.mjs), [placement](../../core/placement-input.mjs), [index](../../core/index-storage.mjs) | Preserve Memory L2 → L1 → Memory refs, version guards, unfiled fallback and same-runtime projections. Old strict Memory refs never receive Card IDs. |
| [Fetch/recall](../fetch-recall.md), [fetch](../../core/fetch.mjs), [recall](../../core/recall.mjs) | Reuse canonical final rereads, exact authorized read sets, cursor/epoch checks and bounded coverage. Current private recall pages omit hierarchy headers/edges. No vector service or complete MOC routing is implied. |
| [Rationale storage](../../core/rationale-storage.mjs), [qualified transitions](../../core/qualified-transition-storage.mjs) | Reuse directed `supports-decision`, `challenges-premise`, endpoint revisions and receipt-content checks. Model proposals remain unverified; qualification/adoption guards still apply. |
| [MCP host](../../adapters/mcp/server.mjs), [CLI](../../adapters/mcp/cli.mjs), [artifact](../install-artifact.md) | Host fixes scope outside tool arguments; optional providers are injected. New tools require explicit capability/version advertisement and installed restart evidence. Old tools/DTOs stay unchanged. |
| [Raw RL-0](raw-layer-contract.md) | Full persistent selected-source capture is decided future work, not v18 behavior. RL-1 already reserves v19; choose later available additive revisions at implementation time. |

Use the facade envelope exactly: `{ok:true,value}` or
`{ok:false,error:{code,retryable}}`. Existing `storage_busy` is retryable;
new domain errors below are not automatic retries. Unexpected exceptions become
sanitized `storage_error`, never source text or provider messages.
`Namespace = {ownerId:Id,scope:'personal'|'project',projectId:Id|null}`;
personal requires null, project requires an ID. Existing storage normalization
of personal project IDs is internal. Reads accept the existing trusted read-set
shape: one exact namespace, or personal plus one project of the same owner.
The host authenticates and chooses this set outside model-controlled payloads.

## 2. Source prerequisite and proposed logical records

`Id` means a valid existing core identifier (1–200 UTF-16 units).
`Revision` means a positive safe integer; timestamps are canonical UTC or null
for unknown source event time. Ingestion time never substitutes for event time.
New records have revision 1; successful mutations increment once. A replay does
not increment. Physical table names are implementation choices; these are logical
objects within the same SQLite store, with strict fields and bounded arrays.

| Object | Proposed fields and types / invariants |
| --- | --- |
| `CardDraft` | `{id:Id,namespace:Namespace,revision:Revision,state:'draft',title:string,body:string,origin:'authored'|'model-assisted',bindings:SourceBinding[],triggerMemoryRefs:MemoryRef[],support:Support,createdAt:UTC,updatedAt:UTC}`. At most 16 bindings and 6 triggers; generated draft text is untrusted. Source invalidation cancels the whole draft (§5); no bodyless draft state exists. |
| `KnowledgeCard` | `{id:Id,namespace:Namespace,revision:Revision,state:'confirmed',bodyRevision:Revision,title:string,body:string,origin,bindings,triggerMemoryRefs,support,createdAt:UTC,updatedAt:UTC,confirmedAt:UTC}`. Confirmation preserves the draft ID, increments revision, and sets bodyRevision 1. |
| `Support` | `{status:'eligible'|'needs-review'|'unavailable',applicability:'current'|'historical'|'conflict'|'unknown',reasons:ReasonCode[],checkedAt:UTC}`. Lifecycle state and applicability are separate; confirmed does not mean currently applicable or true. |
| `CardTombstone` | `{id,namespace,revision,state:'cancelled'|'deleted',endedAt:UTC}` plus content-free operation/audit identities. No title, body, excerpts, generated rationale or copied source text. IDs are never reused. |
| `BodyMetadata` | `{cardId,bodyRevision,cardRevision,operationId,changedAt,changeKind:'confirm'|'edit'|'review'|'delete'}`. Keep only the current title/body. Old revisions retain content-free metadata, not old draft/Card bodies or an unbounded Raw copy. |
| `SourceBinding` | `{id:Id,source:SourceRef,dependency:'source-only'|'memory-interpretation',memoryRef:MemoryRef|null,receiptId:Id|null,role:'required'|'context',attribution:Attribution}`. A Memory interpretation dependency requires memoryRef; receipt-linked sources retain the actual containing Memory ref. All selected support defaults to required. |
| `MemoryRef` | `{type:'memory',namespace:Namespace,memoryId:Id,revision:Revision}`. A trigger ref locates original sources but is not support merely because it initiated drafting. |
| `Attribution` | `{sourceAuthor:string|null,claimant:string|null,subject:string|null,eventTime:UTC|null,commitment:'adopted'|'proposed'|'considered'|'rejected'|'unknown',status:'source-attributed'|'unassessed'}`. Strings ≤200 units; labels never authenticate identity, truth or authority. |
| `RawSourceRef` | `{type:'raw',namespace,conversationId:Id,messageId:Id,span:{start:number,end:number,precision:'exact'|'whole-message'},contentIdentity:Opaque}`. Core-issued identity binds exact retained redacted content and spans, not a public unsalted text digest. |
| `ReceiptSourceRef` | `{type:'receipt',namespace,memoryId:Id,memoryRevision:Revision,receiptId:Id,contentIdentity:Opaque,completeness:'excerpt-only'}`. Uses a core-issued opaque check over retained receipt content/identity, not an invented receipt revision. |
| `NoteSourceRef` | `{type:'submitted-note',namespace,sourceId:Id,revision:Revision,contentIdentity:Opaque,completeness:'provided-note'}`. Only the separately approved new submission path below can create it. |
| `SubmittedNote` | `{id,namespace,revision,state:'available'|'deleted',format,keyVersion,sealed:bytes|null,byteCount:number,occurredAt:UTC|null,receivedAt:UTC,exclusionGeneration:Revision}`. Current permitted text only, under the approved sealing/control/cap policy; deletion purges payload and preserves only necessary content-free fences. |
| `SourceRef` | A discriminated union of the three refs above. Source identity is its real source type/ID/namespace plus exact content identity; a new receipt/event is not independent evidence. Episode/staging excerpts are not Raw refs. |
| `MocMapping` | `{id,namespace,revision,state:'proposed'|'active'|'removed',memoryTopic:TopicRef,cardTopic:TopicRef,memoryIndexRevision:Revision,cardIndexRevision:Revision,projection:'fresh'|'stale',createdAt,updatedAt}`. Same-level L1↔L1 or L2↔L2 endpoints, same owner and exact namespace. |
| `Operation` | `{namespace,actionId:Id,revision:Revision,method:Method,targetId:Id,payloadBinding:Opaque,state:'pending'|'completed'|'cancelled'|'failed'|'interrupted',leaseId:Id|null,leaseUntil:UTC|null,providerOutcome:'not-started'|'completed'|'unknown',result:OperationResult|null,errorCode:Code|null,createdAt,updatedAt}`. Core-keyed payload binding includes method, scope, target, expected revisions, source refs and text; no plaintext ledger payload. Unknown provider outcome is explicit after interruption/timeout, never assumed uncharged. |
| `InvalidationEffect` | `{effectId:Id,namespace,kind:EffectKind,entity:{type,id},revision:Revision,actionId:Id,affectedIds:Id[],cursor:Opaque|null}`. Finite content-free batches, ≤100 IDs each; no body, excerpt, source digest or private reason prose. |

`Opaque` is a core-minted authenticated bounded handle (≤8192 ASCII units),
bound to store, scope and purpose; callers cannot mint it. Exact cryptographic
encoding belongs in the implementation threat-model review. Existing private
receipt digests used by rationale are not automatically public identities.
`MutationReceipt = {id,revision,state,bodyRevision:Revision|null,effectCount:number}`;
it contains no body and is sufficient for replay after cancellation/deletion.
`OperationResult` is the method's finite content-free mutation result from §3:
a MutationReceipt, submitted NoteSourceRef, mapping/placement metadata or operation
cancellation result. It never includes title/body/source text. `Method` is one
of the mutation names in §3; `Code` is one of its enumerated fixed error codes.
`ReasonCode` is limited to `source_changed`, `source_deleted`, `source_forgotten`,
`memory_changed`, `memory_historical`, `scope_revoked`, `unassessed`.
`EffectKind` is `evidence_invalidated`, `card_deleted`, `mapping_removed` or
`publication_recheck_required`. Effects notify consumers; canonical fences are
authoritative before any consumer drains them.

Title is 1–200 units; body 1–20,000 units; reject oversize/invalid Unicode/NUL,
never silently cut. Redact before persistence or model dispatch. Store submitted
formatting without applying Memory's whitespace normalization to source offsets.
At most 16 source refs, 6 trigger refs and 64,000 total UTF-8 source-input bytes
per draft operation; at most 20,000 submitted-note UTF-16 units. These are proposed
V1 limits, not measured resource results. Duplicate provenance text inherits the
source's privacy/deletion restrictions; indexes, logs and audit rows contain no
unbounded excerpts. Authored bodies have the separate retention policy in §5.

### Persistent Raw and the explicitly submitted note boundary

Full Raw MUST use [RL-0](raw-layer-contract.md#scope-ownership-and-gates)
unchanged: existing allowlists and local redaction; continuation assembly and
coverage; notice, pause/project/client controls; 200,000,000-byte per-owner cap;
crypto ports; source lineage, D5/D6 deletion/exclusions; G1/G2/H6 and production
gates. No tool/file/URL capture, MCP chat-history access, automatic backfill,
read-triggered extraction or policy bypass is introduced. A receipt, staged
message or 16 × 800 episode projection remains bounded evidence, not full Raw.
Availability of G1, G2 and required H6 evidence is **unknown here and blocking**;
implementation must obtain evidence rather than mark these gates satisfied.

`coreSource:'submitted-note-v1'` is a **new, OWNER-REVIEW-REQUIRED input**,
not an RL-0 capture extension. A trusted person explicitly submits a bounded
note as evidence for their private Card. It stores exactly the permitted,
redacted provided note in core; it never fetches a URL/file or reads previous
chat turns. `completeness:'provided-note'` means the entire provided note, while
`conversationCoverage:'unknown'` forbids claiming a complete conversation.
No Memory or model call is required to create an authored Card from this note.

Recommended policy: require explicit submission disclosure/control in the exact
namespace; same privacy, deletion/exclusion and host sealing requirements as
retained sources; count note bytes against the same owner cap with an explicitly
versioned usage projection. Note submission is a one-off action, not a new
default-on chat capture client. Account/source deletion and revoked scope fence
notes as well. Existing raw DTOs/counters do not silently change. Until the owner
approves this policy and its strict capability/usage schemas, note input returns
`source_unavailable` before retaining text. Do not use a Card draft as an
undisclosed source archive. Immutable notes can be deleted; replacement needs a
new explicit submission and reviewed rebinding, not in-place source rewriting.
The proposed note port context is separately versioned `source-note-seal-v1`,
binding namespace/source ID/revision/byte count/event time; never masquerade a
note as RL-0's conversation AAD. Local plain format and hosted authenticated
encryption/key lifecycle follow the existing source policy after approval.

## 3. Proposed finite API and authority

Expose these methods only with opt-in advertised `private-cards-v1` and, for
shared reads, `typed-evidence-v1`; anchor resolution additionally needs
`source-reference-v1`, and notes need `submitted-note-v1`. Names are proposals on
`openMemoryCore`'s shared facade.
All arguments are strict and all results use the existing envelope. The host
supplies `authority` separately from the serialized/model-controlled `input`.

`authority` is a trusted host context containing authenticated exact scope,
current access/control generation and a mutation grant bound to method, target
ID (or create actionId), expected revision and payload binding. A bounded host
drafting grant may allow creating/editing private drafts; confirmation, confirmed
Card edits/deletion, source-note submission/deletion and mapping activation
require a trusted explicit user-action grant. Core validates the binding before
commit. A boolean `humanConfirmed:true`, a
model's statement or a submitted `role:'user'` receipt is never a grant. The
host must not expose the authority constructor as a tool argument. No provider,
model or callback executes while a SQLite write lock is held.

Proposed `cardIntentPort` is a host-injected approval adapter, outside tool args:
`request({intent:'save-private-card',namespace,cardId,expectedRevision,
payloadBinding}) -> grant|unavailable`. A supported local CLI/host shows the
exact current draft and explicit private-save intent, obtains the person's
response through its own verified prompt/UI channel, and binds the resulting
one-use grant to that draft revision/payload. Core rechecks it at commit; replay
uses the stored original action result. Generic MCP tool invocation or quoted
chat does not implement this port. A host without a verifiable integration may
create an authorized private draft but confirmation fails `approval_required`;
never claim universal client approval support. Installed acceptance must exercise
this actual adapter path, including unavailable/stale approval.

Common aliases: `N=namespace`, `A=actionId`, `R=expectedRevision`,
`G=authority`, `B=budgets` (§7). Every mutation requires A; existing methods keep
their existing signatures. Every mutation of an existing object requires R.

| Proposed signature (`input`, `G`) | Success `value` | Additional fixed errors |
| --- | --- | --- |
| `submitSourceNote({N,A,text,occurredAt:null|UTC},G)` | `{source:NoteSourceRef}`; revision 1, same action replay gives same source | `source_unavailable`, `quota_reached`, `raw_crypto_unavailable` |
| `getSource({N,source:SourceRef,B,cursor?},G)` | `{source,parts,coverage,nextCursor}`; exact saved source only | `source_unavailable`, `revision_conflict`, `cursor_stale`, `context_item_too_large` |
| `resolveSourceReferences({N,anchors:[{rawAnchor,expectedConversationRevision}],B},G)` | `{sources:RawSourceRef[],coverage}`; read-only, 1–16 explicit retained anchors, no source text | `source_unavailable`, `source_excluded`, `raw_crypto_unavailable`, `revision_conflict`, `context_item_too_large` |
| `deleteSourceNote({N,sourceId,R,A},G)` | `MutationReceipt` and durable invalidation | `source_not_found`, `revision_conflict` |
| `createCardDraft({N,A,input,drafting:'authored'|'model-assisted',modelBudget?},G)` | `MutationReceipt` for draft revision 1 | `source_unavailable`, `source_excluded`, `model_unavailable`, `model_budget_exceeded`, `operation_cancelled` |
| `getCard({N,cardId,responseByteLimit?},G)` | `{card:CardDraft|KnowledgeCard|null}`; qualified owner-private inspection, default/max 65,536-byte whole envelope | `context_item_too_large` |
| `listCards({N,states:['draft'|'confirmed'],limit?,cursor?},G)` | `{cards,nextCursor,coverage}`; excludes cancelled/deleted, default limit 20/max 50 | `cursor_stale`, `invalid_cursor` |
| `editCardDraft({N,cardId,R,A,title,body,bindings},G)` | `MutationReceipt`; full replacement of current draft payload | `card_not_found`, `card_state_conflict`, `source_unavailable`, `source_excluded` |
| `confirmCardDraft({N,cardId,R,A},G)` | `MutationReceipt` with confirmed state/bodyRevision 1 | `card_not_found`, `card_state_conflict`, `support_needs_review` |
| `cancelCardDraft({N,cardId,R,A},G)` | `MutationReceipt` with cancelled tombstone | `card_not_found`, `card_state_conflict` |
| `inspectCardOperation({N,operationActionId},G)` | `{operation:Operation}`; content-free state/revision/lease/outcome/result | `operation_not_found` |
| `cancelCardOperation({N,operationActionId,R,A},G)` | `{operationActionId,revision,state,result:OperationResult|null}` | `operation_not_found`, `operation_state_conflict` |
| `editKnowledgeCard({N,cardId,R,A,title,body,bindings,applicability},G)` | `MutationReceipt`; includes explicit review/rebinding with unchanged body | `card_not_found`, `card_state_conflict`, `support_needs_review`, `source_excluded` |
| `deleteKnowledgeCard({N,cardId,R,A},G)` | `MutationReceipt` with deleted tombstone | `card_not_found`, `card_state_conflict` |
| `getProvenance({N,ref:MemoryRef|CardRef,limit?,cursor?},G)` | `{bindings,triggerMemoryRefs,coverage,nextCursor}`; default 20/max 50 | `revision_conflict`, `cursor_stale` |
| `listSourceDependents({N,source:SourceRef,limit?,cursor?},G)` | `{refs:(MemoryRef|CardRef)[],coverage,nextCursor}`; default 20/max 50 | `source_unavailable`, `cursor_stale` |
| `mapEvidence({N,type:'memory'|'card',parentRef?:TopicRef,limit?,cursor?,B},G)` | `{topics,typedRefs,edges,indexRevision,coverage,nextCursor}`; default 20/max 50 | `revision_conflict`, `index_revision_conflict`, `cursor_stale` |
| `applyCardPlacement({N,A,cardRefs,expectedIndexRevision,proposal},G)` | `{indexRevision,refs}`; ≤16 refs and ≤16 placements | `revision_conflict`, `index_revision_conflict`, `invalid_placement` |
| `setMocMapping({N,A,mappingId,R?,transition,endpoints?},G)` | `{mapping:MocMapping}`; strict transition variants defined in §6 | `mapping_not_found`, `mapping_state_conflict`, `index_revision_conflict` |
| `listMocMappings({N,states:('proposed'|'active'|'removed')[],limit?,cursor?},G)` | `{mappings,coverage,nextCursor}`; default 20/max 50 | `cursor_stale` |
| `selectEvidence({readSet,intent,query,types,B,cursor?},G)` | `{refs,coverage,nextCursor,snapshot}` | `invalid_read_set`, `cursor_stale` |
| `fetchEvidence({readSet,intent,refs,B,cursor?},G)` | `{items,coverage,nextCursor,snapshot}` | `invalid_read_set`, `revision_conflict`, `context_item_too_large` |
| `revalidateEvidence({readSet,intent,snapshot,B},G)` | `{items,coverage,snapshot}` or failure with no stale text | `invalid_read_set`, `revision_conflict`, `scope_changed`, `source_unavailable` |

For readability tables use N/A/R; actual proposed field names are **namespace**,
**actionId**, **expectedRevision**. `CardRef` is
`{type:'card',namespace,cardId:Id,revision:Revision,bodyRevision:Revision}`.
`getCard` returns null for foreign/missing/deleted/cancelled records; mutation
not-found codes have identical foreign/missing behavior. Provenance inspection
does not reveal foreign refs, tombstones or removed source text.
Common errors for every method: `invalid_input`, `authority_required`,
`storage_busy`, `storage_error`, `scope_changed`; mutations also permit
`revision_conflict`, `action_conflict`, `approval_required`. Any source-consuming
method permits `raw_lineage_unavailable`, `source_unavailable`, `source_excluded`
or `revision_conflict`; model-assisted creation additionally permits
`model_timeout` and `invalid_model_output`. Cursors additionally
permit `invalid_cursor`. New action conflict uses the existing Memory review
code `action_conflict`; Raw RL-0 keeps its `event_payload_conflict` contract.
`retryable:true` remains only `storage_busy`; refreshing after stale revisions
requires a fresh explicit action, not blind resubmission with a new ID.
All new reads have a 65,536-byte whole-envelope ceiling, including opaque refs
and metadata. Lists/provenance pages stop at whole items and return continuation;
an indivisible `getCard`/source/item that cannot fit fails `context_item_too_large`
with no partial body. A 20,000-unit body is an input ceiling, not a promise that
every escaped body plus all bindings fits one inspection response. Operation
inspection also obeys this ceiling and never includes generated/source text.
`getSource.parts` is a page of `{start,end,text}` half-open UTF-16 slices of the
exact requested retained source/span, at code-point boundaries and ≤4,000 units
each. Core supplies offsets; coverage distinguishes complete provided source from
an incomplete conversation. No additional surrounding text is fetched implicitly.

`resolveSourceReferences` mints core-owned refs from permitted retained Raw
without a Memory, Card, submitted note or model. `rawAnchor` is exactly RL-0's
`{conversationId,messageId,start,end,precision}`; its existing `getConversation`
and `rawAnchor` DTOs remain unchanged. The caller supplies actual retained-message
coordinates, never a search query, guessed substring offset or normalized-text
offset. Validate positive expected conversation revision, exact namespace,
half-open UTF-16/code-point bounds, retained redacted parts and D5/D6 exclusions.
G fixes that namespace outside model/tool args; input N must match it exactly.
`whole-message` requires its complete saved message; `exact` requires the entire
selected span saved contiguously. Opaque content identity is core-keyed and binds
that exact source content, not just the coarse conversation revision.
Use B's source-byte/deadline and whole-response ceilings; resolve all supplied
anchors or return a fixed error with no partial refs/text. Coverage describes
only those anchors, never a complete conversation. Authorized retained reads
remain available during pause/raw-off as RL-0 specifies; no capture/notice/control
barrier may be bypassed to save missing text. Opening uses the approved read port
outside locks, then canonical scope/revision/part identities/exclusion fences are
rechecked before returning refs. Missing/deleted/foreign/skipped source shares
`source_unavailable`; unrelated append requires fresh coarse read/re-resolution
but does not invalidate an unchanged exact content identity or establish adoption.

`createCardDraft.input` is exactly one of:
`{sources:SourceRef[],title,body}`; `{memoryRefs:MemoryRef[],title,body}`; or
`{authoredInput:{text,occurredAt},title,body}`. In model-assisted mode title/body
are omitted and the injected drafter supplies them. The authored-input variant
atomically submits a note under the approved note capability and creates its
draft. Reuse its operation identity for both; no orphan note on failure.
Sources are 1–16; Memory refs 1–6. A Memory path resolves actual original sources
and records triggers separately. An excerpt-only source returns
`source_unavailable` for full-original-backed drafting. It still supports existing
Memory reads; never relabel it as full source or fetch missing text elsewhere.

Authored drafting uses zero model calls. Optional model-assisted drafting uses
one explicit injected call: maximum 6,000 input tokens, 1,024 output tokens,
30-second deadline and caller-supplied smaller ceilings/exact counter. If the
required source set/request cannot fit, fail `model_budget_exceeded` before
dispatch; if output is truncated/incomplete or exceeds limits, fail
`invalid_model_output` without storing a partial draft. A person may explicitly
choose smaller spans in a new action; never silently omit required support or
call a clipped source complete. Reserve framing and disclose remote input use.
The drafter sees only authorized bounded source text; it cannot select scope,
authority, source IDs or actions. No implicit provider fallback, paid job,
background retries, vector service, topic summary or three-call pipeline.

## 4. Lifecycle, CAS and source binding

| Start | Action and required checks | Committed end |
| --- | --- | --- |
| Absent | Create: validate scope, source identities/fences and A; prepare optional model output outside transaction; recheck all before commit | Draft revision 1, bindings and operation receipt atomically |
| Draft r | Edit at R=r with trusted action for new payload; revalidate all supplied bindings | Draft r+1; replace body, purge previous draft body, invalidate prior projections |
| Draft r | Confirm at R=r with trusted action covering reviewed title/body/bindings; require currently eligible required support | Confirmed r+1/bodyRevision 1; confirmation is private authorship/curation, not truth or publication |
| Draft r | Cancel at R=r, or cancelling pending creation by operation A before its commit | Cancelled r+1 tombstone, or cancelled creation ledger without a Card; purge generated text/source copies |
| Draft r | Any bound source invalidates, including context-only source (§5); internal source-mutation transaction, no new user grant | Cancelled r+1 tombstone; purge the whole draft, cancel pending writes and emit content-free effects atomically |
| Confirmed r | Edit at R=r with trusted reviewed payload/bindings/applicability; title/body change increments bodyRevision, binding-only review does not | Confirmed r+1; invalidate dependent projections/attachments; current body only; unavailable support remains blocked unless actually replaced/revalidated |
| Confirmed r | Delete at R=r with trusted action | Deleted r+1 tombstone; purge body, draft payloads, placements and private copied excerpts; emit effects |
| Cancelled/deleted | Any new lifecycle action after exact completed replay lookup | Stale R refuses `revision_conflict`; matching R refuses `card_state_conflict`; no resurrection |

Use one namespace-scoped action ledger. Bind A to method, complete canonical
payload, scope, target and R before asynchronous work. Exact completed replay
returns the original content-free result even after later edits, deletion or
restart; it is not a new fetch. Different payload/method/target under A fails
`action_conflict`. A pending identical request never dispatches a second model
call: return `storage_busy` while owned work runs. Lease expiry after crash
requires explicit cancellation by `cancelCardOperation`, then a fresh creation
action if desired; replay never resumes a provider call. Use a bounded lease no
longer than the 30-second model deadline plus 5-second commit allowance; a late
worker checks its exact lease and cannot commit after cancellation/expiry.
Operation state transitions are pending → completed (canonical commit and receipt
atomic), pending → failed (known failure, fixed error), pending → interrupted
(expired owner lease with provider outcome unknown), and pending/interrupted →
cancelled (explicit CAS action). Terminal completed/failed/cancelled records are
immutable; exact replay returns the original receipt/error. Inspection may
transactionally mark an expired pending lease interrupted and increment its
operation revision; it never dispatches model work. Every persisted state change
increments that revision. Failed/interrupted records retain no generated payload.
A new provider attempt needs a fresh explicitly budgeted action, and unknown
prior provider outcome remains visible for accounting. No recovery daemon.

`cancelCardOperation` requires the inspected operation `expectedRevision`,
not a nonexistent Card revision, and fences pending/interrupted work transactionally.
If creation already committed, matching-R cancellation returns its original
receipt without changing terminal state and requires `cancelCardDraft`
at the current revision; cancellation cannot erase a confirmed Card. Double
confirm, confirm versus cancel, edit versus confirm and delete versus edit
serialize under CAS. Only one action at a revision succeeds. A cancelled lease,
source deletion, D6 exclusion, forgotten Memory dependency or revoked scope
between model dispatch and commit blocks publication of the prepared draft.

Conversation read revision is a coarse read/CAS snapshot, **not cited content
identity**. RL-0 parts are immutable. Core re-resolves exact message/span identity
against retained parts, source fences and exclusions. An unrelated append bumps
the conversation revision and stales its read cursor; refresh that read before
commit, but unchanged cited content stays eligible. Corrections cannot overwrite
RL-0 immutable parts in place: an approved replacement source retires the old
binding and fences it. Never invent receipt versions, public text hashes or
substring-derived offsets; use validated normalization mappings and whole-message
precision where exact mapping is ambiguous.

An interpretation dependency binds Memory ID/revision in addition to original
source identity. A locator-only trigger is audit/navigation metadata: changes to
its filing or interpretation require source/fence rechecking, not automatic
rewriting of the source's meaning or invalidation of unchanged source-only
support. Memory correction/forget may create D6 source exclusions that DO block
those same anchors. New receipt IDs or removal of the trigger cannot bypass them.
Material Memory changes and scope changes require explicit review before a
dependent interpretation is current again. Existing safe filing preservation
requires verified unchanged content/source/qualification, not a revision guess.

## 5. Invalidation and independent authorship

For an already persisted draft, V1 cancels the whole draft when **any** bound
source/support becomes changed, excluded, deleted or revoked, including
context-only bindings because copy-free separation is not assumed. Locator-only
trigger changes with unchanged eligible sources retain §4's exception. The source
mutation transaction replaces draft revision r with a cancelled tombstone r+1,
purges title/body/bindings/private copies, advances affected index/namespace
generations and emits `evidence_invalidated` effects under its stable cause action
identity. Repeated invalidation is a no-op on that tombstone; no second revision
or duplicate effect. Pending operations on it become cancelled with incremented
operation revisions and `operation_cancelled`; late workers cannot commit.
Pending creation with no Card yet rechecks the same source fences before any
persistence; prepared plaintext stays ephemeral and is discarded on refusal.
Completed operation receipts remain immutable: retrying original create/edit A
returns its original content-free receipt, never the purged draft or resurrection.
After restart `getCard` is null, listings omit it and old cursors are stale.
For a known same-scope tombstone, a new edit/confirm/cancel action with old R fails
`revision_conflict`; matching current R fails `card_state_conflict`. Foreign or
missing IDs retain `card_not_found`. This automatic transition does not change
the separate confirmed-authored-body retention policy below.

| Mutation | Canonical eligibility effect and required action |
| --- | --- |
| Raw append, unrelated message | Refresh coarse read/cursor snapshot; exact unchanged cited spans remain eligible. No automatic Card expiry or authored-body edit. |
| Correct/retire cited source | Mark its bindings unavailable/needs-review; purge source-derived draft/cache payloads; block dependent current evidence. Reviewed replacement/rebinding is explicit. |
| Delete conversation/source | Apply RL-0 D5 source-only/surviving-receipt cascade unchanged; remove deleted-source excerpts/lineage, fence pending drafts and source consumers, purge affected generated payloads. Confirmed authored Card body follows policy below. |
| Memory correct | Invalidate interpretation dependencies and old-source exclusions where required; source-only bindings with actually unchanged allowed anchors can survive canonical recheck. Locator triggers alone are not support. |
| Memory supersede | Preserve explicit history; dependent interpretation is not current support. No inference that a replacement proposal was adopted; review/rebind current Card evidence. |
| Memory forget with Raw retained | Apply suppression plus D6 anchor exclusions before receipt removal. Invalidate dependent drafts, summaries and Cards; future reads/drafting/re-extraction cannot recover the forgotten assertion from that Raw span. Disjoint permitted sources remain possible. |
| Card edit | Advance Card revision and bodyRevision when content changes; invalidate evidence refs, derived summaries and publication projections bound to old revision. No rewriting other authored Cards. |
| Card delete | Remove current body, private excerpts and memberships; fence old refs and pending attachments, emit content-free effects. Shared copies require separate host withdrawal/retention policy. |
| Scope/access revoke | Refuse reads/confirmation/model dispatch and invalidate snapshots/attachments immediately. Content retention follows its owner policy; ACL revocation never grants another namespace access. |
| MOC mapping change/revoke | Advance mapping/projection version and stale dependent routing snapshots; remove traversal authority, retain canonical content and unfiled recall. It does not independently change evidence meaning. |

V1 conservatively blocks the **whole Card** from `intent:'current'` whenever any
required support is stale, unavailable, excluded or awaits review. This is engine
filtering, not a UI badge. Context-only bindings do not establish an assertion;
their removed text is still purged. Multiple independent sources are counted as
such only after canonical provenance deduplication; after a required source loss,
a trusted review may retain the body with surviving/replacement bindings and
revalidated applicability. No automatic promotion to truth or silent rewrite.
An owner may edit a retained confirmed artifact while support is unavailable;
the write remains `needs-review`/`unavailable`. It cannot set its own support
eligibility by submitting a label. Only a successful canonical source/fence and
required interpretation check can clear the block. Even eligible support proves
retained attribution, not semantic truth; unknown/conflict/proposal qualifiers
remain visible and never become an adopted current assertion by confirmation.

Recommended independent authorship policy, requiring owner approval: confirmed
title/body remains an owner-private authored artifact until explicit Card or
account deletion, even if support later disappears. Its private `getCard`
inspection reports `needs-review`/`unavailable` and is **not current answer
evidence**. Source-derived excerpts, draft text, generated caches, superseded
bodies and hidden source-only prose have no such exemption. Confirmation of a
model-assisted draft records explicit curation under this policy; it cannot
authorize retaining separate forgotten-source copies. An owner must consciously
review/rebind retained content before common current reads can use it again.
`history` can show the retained authored body with these qualifications, never
deleted/forgotten support text. A source deletion prompt must disclose retained
independent authored Cards without pretending that their evidence survived.

Raw D5 still preserves a Memory with actual independent surviving support and
forgets a source-only Memory. Card lifecycle is separate from that cascade;
it does not remove deletion fences, validate ambiguous lineage or grant an
exemption to source copies. If required lineage is unavailable, fail closed
with RL-0 `raw_lineage_unavailable`, not a fabricated independent source.
Every invalidation and its canonical fences/effect rows commits in the same
transaction. Consumers recheck before serving content even if effects are pending.

## 6. Two typed MOCs and their mapping

Keep the existing Memory primitive. Add Card L2 groups → L1 topics → Card refs,
using the same index/runtime design with type-discriminated tables/projections.
`mapEvidence.type` chooses one index; no duplicate retrieval engine or mixing
Card refs into the old Memory `map` DTO. Topic titles/labels are untrusted and
source-derived titles lose authority when their source changes.

Mapping is same-owner, **exact same namespace**, same-level L1↔L1 or L2↔L2.
`TopicRef={type:'memory-topic'|'card-topic',id,level:1|2,revision}`; parentRef
must match the selected index and canonical level/revision. Mapping endpoints
are `{memoryTopic,cardTopic,expectedMemoryIndexRevision,expectedCardIndexRevision}`.
`transition:'propose'` requires endpoints/new mappingId and omits R; `activate`
requires R/endpoints and exact canonical topic/index guards; `remove` requires R
and omits endpoints. Other field combinations fail `invalid_input`.
Create is proposed; proposed → active and active → removed are allowed.
Active → active is only a trusted stale-projection refresh of the same endpoint
IDs/levels with new checked revisions. Different endpoints require a new proposed
mapping; removed mappings never reactivate. Topic/index mutation stops stale
traversal until reviewed refresh. L2 mappings select the typed broad Card island
and consume the same bounded traversal allowance; no cross-level inferred links.
Mapping grants navigation only, never ACL or publication.
At most 16 active incident mappings per topic; traversal depth 1, at most 8
mapped topics per read, deduplicate cycles/refs and report omissions. No title
match automatically merges topics. Unmapped and unfiled items remain recallable
from their canonical type and authorized scope.

`applyCardPlacement.proposal` follows the current bounded placement grammar
with `cardId` replacing `memoryId`: `{items:[{cardId,parentIds,newL1?:{title,
parentL2Ids,newL2Title?}}]}`. Parent IDs must resolve to Card L1/L2 at the required
level; new titles use current normalization/dedup rules. Card refs cover exactly
the 1–16 unique items; each has ≤3 existing parents and new-topic parents.
`expectedIndexRevision` guards all canonical topic resolution/creation atomically.

Content-unchanged, same-scope filing can preserve bindings/placement atomically
after proving source and qualification unchanged, as current rationale filing
preservation does. Semantic/body/scope change requires reviewed valid placement
or unfiled fallback. Classification is optional follow-up work outside writes;
failure never fails an otherwise valid canonical Card/Memory write or blindly
inherits old topics. Generated topic summaries remain later derived caches,
not a fourth canonical layer; if added, stale support immediately excludes them
from common evidence reads, independently of UI status or recomputation.

## 7. Common bounded reads

`intent` is `current`, `history` or `why`; it is not a permission grant.
`types` is a unique nonempty subset of `memory`, `card`, `source-anchor`.
`EvidenceRef = MemoryRef | CardRef | SourceRef`; source-anchor candidates are
only already authorized cited anchors, never arbitrary Raw full-text search.
The selected conservative V1 baseline is keyless literal query selection, reusing
the existing Memory query-score/excerpt helpers with a compatible Card selector
over typed Card MOC/list pages. `query` is required, 1–4,000 units.
Enumerate canonical eligible records in stable ID order per type/namespace,
including filed AND unfiled records without requiring any mapping. Optional
requested mapping traversal adds bounded candidates; it is not the fallback's
authority. Score literal Unicode query-word overlap against bounded retained
bodies; zero-overlap candidates remain possible, ties use stable IDs. Interleave
type/namespace streams before the shared candidate cap so one stream cannot
consume the entire allowance. Deduplicate before bounded top-item selection,
then fetch and final-revalidate canonical evidence. This extends the existing
literal mechanism; it does not invoke old model-backed `recall` as a hidden call.
Synonym/CJK/paraphrase relevance and semantic performance remain unverified.
No generative model/network call occurs in these three V1 reads.
The old `recall` signature and strict return DTO are unchanged; migrating a
caller to these proposed capabilities is explicit.
Card candidates are **confirmed only**; drafts are inspection-only. `current`
uses active Memories and supported current-applicability Cards, retaining
proposal/conflict/unknown distinctions rather than calling them adopted facts.
`history` explicitly selects retained historical Memories and qualified confirmed
Card artifacts, including the retained current authored body when support is
stale; it never exposes old purged bodies or forgotten sources. `why` selects
decision candidates then expands only guarded rationale/source bindings. Existing
current-only rationale that cannot explain a historical version is unavailable,
not fabricated. Source anchors arise only from selected canonical records.

`B = {candidateLimit,itemLimit,sourceByteLimit,responseByteLimit,maxPages,
maxMappedTopics,maxEdges,deadlineMs,scanRowLimit,scanBodyUnitLimit}`; omitted
fields use proposed defaults 64/12/16000/65536/2/8/10/1000/128/256000
respectively; maxima are 128/24/64000/65536/4/8/10/5000/1024/2000000.
Scan-row and body-unit allowances cover the entire selection across requested
types/namespaces, not a fresh allowance per path. Stop/report coverage when
either is reached; no unbounded SQL/body scan fallback. All are positive safe integers, except edges
and mapped-topic limits may be zero. Time budget is a deadline, not a latency
claim. Candidate scanning/selection limits are separate from keyless canonical
fetch/revalidation limits. Tokenized downstream model packing, or a future
explicit injected semantic selector, needs its own model budget and capability;
neither is implicitly selected by V1.
Bound every path and final serialized success envelope; stop before a whole
item/source cannot fit. Never trim source spans into falsely complete evidence.
An envelope/first whole item that cannot fit fails `context_item_too_large`.

Each path (`memory-index`, `card-index`, `mapping`, `unfiled`, `source`,
`rationale`) reports `{status:'complete'|'budget_exhausted'|'timed_out'|
'unavailable',included:number,omitted:number|null,unknown:boolean,reason:Code|null}`.
Known omitted zero and unknown totals differ. If any canonical candidate prefix
remains unscanned, status is `budget_exhausted`, omitted is unknown unless counted,
even when all scanned candidates fit. `complete` requires exhaustion of that
declared eligible traversal, not proof of relevance or complete real-world
history. Aggregate coverage is partial if any requested path is partial;
an unavailable optional path returns qualified partial results, while required
source inability never returns a current Card assertion. Cursors bind store,
exact read set, intent, types, budgets, versions, mapping/index generations and
query identity; mutations return `cursor_stale`, not a silently mixed snapshot.

`fetchEvidence` returns discriminated items with canonical content, revision,
applicability/support, source anchors and coverage; current assertions, retained
history, conflict and unknown are distinguishable. `why` returns source-attributed
rationale and its limited coverage, not reconstructed motives. Provenance dedup
unifies the same original span across Raw, receipts, Memory, Cards and derived
projections before counting corroboration. Unknown lineage is unknown, not an
independent vote. Multiple copies never multiply source support.

`snapshot` is an opaque bounded handle binding exact item/source versions,
scope/access generations, exclusions and mapping/index generations. It grants
no durable permission. `revalidateEvidence` checks trusted scope then resolves
canonical items, content identities, D5/D6 fences and interpretation dependencies;
it returns fresh qualified items, or no stale text with a fixed error. Selection
and fetch each do their own final canonical reread; injected counters/openers run
outside locks, then revisions/fences are checked again with no callback after
the final read. Hosts revalidate before later answer/effect use when relevant
versions/access may have changed. Retained authored stale Cards can be inspected
privately but cannot enter `current` as assertions via another path.

## 8. Rationale, adoption and optional conflict review

Reuse `supports-decision` (premise → decision) and `challenges-premise` (update →
premise), exact namespace, endpoint Memory revisions, retained receipt identities
and existing source-content guards. Proposed Card bindings reference this
evidence; they do not fork a general relationship graph or relax current limits
(six sources/ten linked edges in the existing rationale context).
A challenge is `reconfirmation-suggested`, not proof the premise failed.
Supported failure of a premise can require reconfirmation without adopting B.
Only actual supported adoption plus existing qualified transition guards changes
which decision is current. Older event time does not win by later ingestion.

E8 remains optional later work: a trusted exact pair-of-versions and scope action
may record both-valid-for-these-conditions. It neither changes universal truth
nor bypasses qualification, currentness or source checks. Any endpoint/evidence/
scope change reopens review. No model-emitted human-confirmed label counts.
No E8 method is advertised by this proposed V1 API.

## 9. Transactions, migration and host attachments

Card payload/bindings, lifecycle revision, index invalidation, suppression fences,
operation receipt and outbox effects commit atomically in the shared runtime.
Model calls, sealing and host transport occur outside locks with pre/post fences.
Restart never trusts old plaintext snapshots, resumes a cancelled lease or
implicitly calls a paid provider. Content-free history is not an old-body archive.

At implementation time choose the next available additive schema after existing
and approved Raw migrations; **do not reserve v19 again**. Before upgrade: close
writers, create/verify a backup, run a read-only inventory and preview counts,
confirm restore/erasure procedures and test the migration on synthetic copies.
Old openers must refuse the new version; stop mixed-version writers rather than
trying dual canonical stores. New databases start with empty Card/source-note
tables; never infer old drafts, missing raw or adoption from host collections.
Rollback after new writes needs a reviewed export/restore procedure and erasure
replay; an old binary or backup alone is not safe rollback. Disabling a feature
does not drop records, fences, tombstones or usage. RL-0 G1/G2/H6-T/H6-E,
notice/copy/quota and explicit production-flag approval remain separate gates.

Hosted publication is a separately authorized attachment, e.g.
`{hostAttachmentId,cardId,cardRevision,destinationId,projectionVersion,state}`
in the host's private metadata. Its proposed public artifact is a versioned
approved projection `{publicationId,projectionVersion,title,body}` containing no
private Card/Memory/source IDs, source counts, excerpts or provenance. It is an
immutable projection of one engine Card revision, not another independently
mutable Card engine. The host validates destination ACLs/quotas/moderation at
request AND effect drain, keeps its idempotency/outbox state and publishes only
that permitted projection. Serving also checks the authoritative version/fence
before returning an old projection, even before invalidation outbox drain.
Engine commit and host publication are not a distributed transaction. Canonical
read/invalidation fences apply before drain, so delayed withdrawal cannot make
stale support current. The host reports pending/failed publication honestly and
retries effects idempotently after restart. Private source refs/excerpts do not
enter public attachments merely because their Card body is publishable.

Confirmation is private curation; publication is another authority. One UI
confirmation may convey two explicit intents, but they have distinct payloads,
grants and results. Existing host collection records/own excerpts retain their
separate retention policy; they are not the new canonical engine Card store.
Product migration follows accepted standalone behavior, with adapter conformance
and unchanged UX absent explicit signoff; it is not a standalone V1 prerequisite.
Standalone V1 is owner-private. Existing same-owner readSet semantics do not
authorize shared multiowner reads, another owner's private namespace/provenance
or destination authority. Hosted shared-read/authentication projection semantics
remain unresolved and block that integration separately until owner review;
they do not block otherwise accepted standalone V1.
Local MCP needs no hosted service. Its advertised new capability must bind the
installed artifact/version, trusted namespace and optional disclosed remote
model. Unsupported hosts refuse the new tool, not silently widen old DTOs.

## 10. Ordered build slices after owner review

The following paths are **anticipated implementation seams, not a delivery
manifest or claims that proposed modules already exist**. Existing examples are
nonexhaustive callers to inspect, mechanically expanding before each runtime PR.

| Slice / dependency | Components to reuse or add | Observable done condition |
| --- | --- | --- |
| S0 shared sources; owner-approved source policy and verified Raw gates first | Existing `core/database.mjs`, `runtime.mjs`, RL-1/RL-2 source/lineage work; proposed `core/card-source-input.mjs`, anchor resolver and optional note store | Bare retained Raw anchors resolve to bounded core-owned refs without Memory/Card/model; exact identities/unavailable coverage and D5/D6/read/control/crypto/restart fences pass. No excerpt masquerade; unknown prerequisite evidence blocks this slice. |
| S1 Card store/lifecycle; depends S0 | Proposed `core/card-schema.mjs`, `card-storage.mjs`, `card-input.mjs`; extend existing `contract.mjs`/runtime, not legacy DTOs | Model-free source → draft → confirm/edit/delete and cancel/retry races work in synthetic stores, with trusted action and current-body-only retention. |
| S2 provenance/invalidation; depends S1 | Existing correction/forget/supersession/episode paths, proposed shared source dependency/effect storage | Every §5 mutation blocks stale current evidence before effects drain; surviving independent source rules and no-resurrection fixtures pass after restart. |
| S3 typed MOC/common reads; depends S2 | Existing MOC/index/fetch/rationale helpers, proposed typed Card projection/mapping and evidence facade | Same-scope typed routing, unfiled fallback, bounded per-path coverage and final canonical revalidation; stale Cards/summaries cannot enter current evidence. |
| S4 installed standalone V1; depends S3 | Existing `adapters/mcp/server.mjs`, CLI, `packaging/artifact-files.json`, installed artifact/new-session harness; proposed tool schemas/intent adapter/tests | Install actual artifact, advertise capabilities, restart process and perform new-session lifecycle/read/forget via actual MCP and the verified user-intent adapter with synthetic data. In-process mocks do not pass this gate. |
| S5 product adapter; after standalone acceptance | Separately scoped host adapter, attachment/outbox and migration preview | Reuses canonical engine; destination authority, source projection, invalidation and erasure tested independently; production gates still required. |

Inspect existing `core/test/`, `adapters/mcp/test/`, `examples/`, packaging and
host integration callers before implementation. Old `remember_memory`, capture,
recall, review confirmation and receipt DTOs must continue their existing contract;
none becomes a Card/publication operation by inference. New tests use the owned
temporary-workspace runner and synthetic stores on Node 22.16 and 24, with cleanup
on success, assertion/setup failure and catchable termination. Mandatory generic
and feature-specific checks come from `CONTRIBUTING.md` at implementation time.
Optional model quality, summaries, semantic fusion, vectors and graph services
come later under separately frozen experiments, after a usable bounded V1.

## 11. Fixed acceptance fixtures, not passing results

All rows are required prospective observations; **none is claimed passing**.
M = mechanical synthetic conformance; S = real-model semantic evidence under a
separately authorized frozen probe; H = installed host/artifact evidence. Scripted
models prove orchestration only. Freeze source wording/chronology, expected
meaning, scope, artifact, budgets and scoring before S; normal extraction must
create links used for S, rather than inserting oracle relationships.

| ID / phase | Given and action | Required observable |
| --- | --- | --- |
| T01 M/S | A adopted because price is within budget; actual supported price update exceeds it; B only proposed; capture/read current and why | A needs reconfirmation when failure is supported, or only reconfirmation-suggested for an unverified challenge. No adopted B/current replacement is invented. |
| T02 M/S | Continue T01 with explicit supported B adoption and guarded transition | B is current within exact scope; A/history/rationale remains inspectable; execution/publication still needs separate authority. |
| T03 M/S | Import an older event after the latest supported decision; separately change price while still within budget | Ingestion recency does not replace the decision; within-budget update does not establish failed premise. Unknown event time is explicit. |
| T04 M | Bind a Card to one Raw span, append an unrelated message, refresh coarse source read | Old cursor stales; unchanged exact content identity remains eligible, no automatic Card invalidation. |
| T05 M/S | Similar assertions in another namespace; try refs/mappings/relationship expansion across it | No foreign content or access; wrong-scope claim cannot update the local decision. |
| T06 M | A cached generated topic summary depends on corrected/forgotten support; read current through all paths | Stale summary is excluded before recomputation/effect drain, not merely badged. If summary feature absent, capability is unavailable; no fabricated cache is used. |
| T07 M/S | Persist drafts with required and context-only source bindings; forget/correct their Memory with Raw retained; retry span-based drafting/extraction after restart | D6 excludes affected anchors; each affected draft is cancelled once at r+1 with no title/body/bindings left, get is null/list omits, effects persist once. Original operation receipt remains content-free; new IDs cannot resurrect it. Caches purge; disjoint anchors remain usable. |
| T08 M | Create/edit draft; race double-confirm, confirm/cancel, edit/delete and source invalidation; replay original A and stale/new CAS actions after restart | One CAS winner, no resurrection; original A returns its original content-free receipt even after automatic cancellation, changed payload refuses. Old R fails revision_conflict; current tombstone R fails card_state_conflict. Pending operations cancel/fence late commits; no stale provider output persists. |
| T09 M | Two independent source conversations support a Memory/Card; delete one, then review surviving support | D5 preserves actual surviving Memory/receipt, removes deleted-source text. Required Card loss blocks current use until trusted review; independent sources count correctly, duplicate receipts do not inflate corroboration. |
| T10 M/H | Delete a confirmed Card with active index/ref and pending publication effect; restart and drain | Body/private copies vanish, old refs fail, effects are idempotent; no reattachment or stale published support through delayed drain. |
| T11 M | Active same-scope typed mapping, then revoke it; query previously mapped/unfiled Card | Traversal stops immediately; canonical content remains recallable in its own authorized type, no ACL change. |
| T12 M/H | (a) Navigate bare retained Raw, resolve actual anchors and author/confirm a Card with no Memory/note/model. (b) Submit complete provided note under approved note capability and author/confirm a Card with no Memory/provider | (a) Bounded core-owned exact refs enable Raw → Card with zero model calls; bad/forgotten/foreign anchors refuse, unrelated append needs fresh coarse resolution but unchanged content stays valid. (b) Exactly note source + private draft/confirmation persist; zero model calls; provided-note never means conversation-complete. Missing capability refuses before retention. |
| T13 M/H | Ordinary capture hook and existing Memory `confirm` run; inspect Card store/tools | No automatic Card creation/publication or expanded authority; old tool/DTO shape remains compatible. |
| T14 H | Install exact generated artifact, create private draft through new MCP tools, confirm through actual verified host/CLI intent adapter, stop server, start new process/new session and read/forget | Capability/version/scope match, lifecycle/evidence/fences survive actual stdio restart. Missing approval adapter refuses; stale draft approval fails. A source-checkout demo, model flag or mock client cannot substitute. |
| T15 M | Synthetic oversized/Unicode source, many topics, cyclic mappings, time/byte/page limits, missing source/crypto | Finite work/response, explicit per-path exhaustion/unknown/unavailable counts, no false completeness, no guessed offsets/plaintext fallback or network/model read. |
| T16 M | Inject successful, assertion-failed, setup-failed and cancelled test runs with owned temporary stores/processes | Exit codes recorded; owned scratch/resources clean up on success/failure, cleanup errors fail visibly. No user DB, transcript, operational ledger or broad historical temp sweep. |
| T17 M | Memory only locates a Raw source; change its filing/interpretation, then separately exclude the cited span | Locator revision alone does not rewrite/expire unchanged source-only meaning; canonical source/exclusion change blocks use. Interpretation-dependent Card requires renewed review. |
| T18 M | Revoke scope during model preparation/final read or between engine commit and host effect drain | No stale plaintext/draft/attachment escapes final fence; retained body accessible only under currently authorized private inspection. |

Preserve the [alignment plan's closed results, milestones, denominators and
resource gates](memory-architecture-alignment.md#preserve-milestones-denominators-and-resource-gates).
The cumulative US$400 ceiling, protected US$30 and requirement for separately
frozen/reviewed new paid scope plus conservative affordability check remain;
historical balances are not current affordability. This draft authorizes **no
paid work**, benchmark rerun or real user/production database access. Mechanism,
semantic quality and installed-host evidence must be reported separately.

## Execution addendum: bounded local private Cards

The authorized implementation slice is **S0-note + S1 + note invalidation**,
partial V1. Product integration belongs to the product team. Full retained Raw,
its unknown G1/G2 gates, typed Card MOC/common retrieval and installed MCP remain
later work; this slice does not claim those gates or current-query filtering.
It uses the existing `openMemoryCore` and SQLite runtime, with explicit trusted
host selection of `private-cards-local-v1`, `submitted-note-v1`, disclosed
one-off submission and `local-plain-v1`. Default is off; no chat capture,
backfill, model, provider, vector API, publication or hosted encryption is added.

Schema 20 adds only local note/Card/operation/effect/usage tables. Schema 19 was
reserved for future Raw and is unimplemented; it is not an applied prerequisite.
Unselected v18 remains v18; only explicit opt-in upgrades v18 to v20. New code
can reopen v20 with the capability off without deleting data. Old openers reject
v20. Operators must stop mixed-version writers before any migration. No user
database is migrated here; future Raw must use the next real available version.

Authored notes and Cards retain exact redacted formatting, required same-scope
note refs, unknown applicability and unassessed attribution. Confirmation records
private curation. Notes are immutable; deletion purges note text, cancels bound
drafts once and preserves confirmed current authored bodies privately with lost
support. CAS, content-free operation replay and durable effects share one atomic
transaction. Only the current Card body is retained. A trusted host port, outside
serialized arguments, binds exact scope, action class, payload, action ID, target,
revision and access generation; no model boolean or claimed role is authority.

Acceptance roster: C01 default/legacy unchanged; C02 atomic authored note+draft,
zero model calls and exact formatting/provenance; C03 CAS/replay/restart lifecycle;
C04 forged/wrong-scope/changed/revoked grants refuse without leak; C05 source
deletion cancels drafts and retains unsupported confirmed authorship without
resurrection; C06 UTF-16/redaction/cap/response/cursor bounds; C07 fresh18,
explicit20/reopen/migration/old-opener rejection; C08 logical purge/content-free
audit/effects; C09 truthful capability and explicit versioned note usage.
Synthetic checks use the owned workspace runner on Node 22.16 and 24; results
are recorded after execution. This is implementation authorization for this
bounded local opt-in slice, not production-flag or full RL1 authorization.

Worker implementation checkpoint (2026-10-20): base
`82fa5bc53c03c06194beee67c900651706db5dd7`, isolated
`feat/private-card-engine-v1`; worker model/effort comes from the primary's
dispatch record, bounded by primary acceptance/review. C01–C09 targeted suite
`node tools/testing/run.mjs core/test/private-cards.test.mjs` passed 17/17,
exit **0**, with actual Node **22.16.0** and **24.15.0**. It includes real
concurrent SQLite writers (owner quota and confirm/cancel CAS), atomic quota/
fanout refusal, callback-time source invalidation, revocation/forged/stale
tokens, source formatting, purge/replay and unsupported schema versions. The
synthetic `node examples/private-cards.mjs` close/reopen lifecycle passed both
versions, exit **0**. An earlier malformed-Unicode test-helper failure (exit 1)
was corrected to pass bad input to the API rather than reject in the helper;
no production failure or provider call occurred. A manual actual pre-v20
opener check passed both versions; the unit suite deliberately does not depend
on historical git objects unavailable in shallow CI. Primary repeats cross-
version and installed-artifact acceptance independently.

The live-dependent cap is 128 per note, with atomic admission/rebinding checks;
this bounds note deletion to 128 affected Cards. Only completed synchronous
operations persist in this slice; failed transactions roll back without an
operation row. Pending leases/provider cancellation/full Operation failure
states remain future work. The worker changed 13 files, cross-checked using
`git diff --name-only` plus untracked files against independent porcelain
status. Runtime entrypoints are the optional facade spread on `openMemoryCore`,
its same-runtime storage attachment and opt-in database opening; the existing
`core/index.mjs` re-export needs no new parallel engine. The source example,
unit suite, protocol, local guide and changelog are included. Packaging/CI and
installed-import checks have a separate owner. Primary owns final combined
checks, exact candidate commit and independent Standards/Spec reviews; this
checkpoint does not mark those gates or full V1 complete.

## 12. Owner review: decisions and implementation gate

Recommended defaults are concrete proposals; checking this draft's completeness
does not approve runtime work, new retention or a production flag. Record owner
decisions and evidence in this packet before authorizing implementation.

- [ ] Approve current-body-only storage, positive revisions, content-free audit/
  replay receipts and the finite proposed API; resolve exact trusted-action host
  binding before exposing mutation tools (§2–4).
- [ ] Approve independent confirmed-authored-body retention with engine-level
  current-evidence blocking after support loss; source/draft/cache copies purge
  and reviewed rebinding is required (§5).
- [ ] Approve or defer `submitted-note-v1`, its disclosure/control/sealing,
  same-owner cap accounting and deletion projection. Until approved, explicit
  authored-input drafting is `source_unavailable`; no chat-history capture (§2).
- [ ] Approve same-exact-namespace same-level L1/L2 mappings, whole-Card required-support rule,
  proposed budgets and typed bounded read/revalidation semantics (§5–7).
- [ ] Confirm S0's actual source availability and supply G1/G2/H6 prerequisite
  evidence. These are unknown blockers, not completed or waived local gates.
- [ ] Approve the ordered standalone V1 scope and T01–T18 acceptance roster;
  separately authorize implementation PRs. Model/summary/vector research and
  hosted migration retain separate approval/evidence/resource gates (§9–11).

Plain-English walkthrough: retain permitted sources, and let ordinary capture
remember an interpretation. When a person wants a private Card, resolve the
actual source, draft or accept their authored text, and ask them to confirm that
exact version. File it in the Card index; use explicit mappings for navigation.
When support changes, keep reviewed authored content privately under its policy
but block it from current answers until the person reviews its support. Sharing
still needs destination permission. A fresh session reads the same engine and
rechecks sources; it does not infer permission from an old snapshot.
