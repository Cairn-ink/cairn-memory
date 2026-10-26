# Local private Cards preview

`private-cards-local-v1` is a bounded authored engine slice in the existing
`openMemoryCore` SQLite runtime. It implements an explicitly submitted note,
private draft/confirm/edit/cancel/delete, source-note deletion, content-free
operation replay and invalidation effects. Existing Memory APIs are unchanged.
It also supports an explicit retained-receipt Memory interpretation input with
transactional invalidation. The integrated local preview adds
[common evidence reads](private-evidence-local.md),
[typed organization](private-organization-local.md), and
[installed MCP with real-TTY private confirmation](private-card-terminal-review.md).
This is bounded local source/Memory/Card behavior, not completion of full Raw
RL1/G1/G2, hosted approval/encryption, publication or product integration.
The separate [retained-profile MCP path](private-card-terminal-review.md#retained-raw-profile)
can discover existing Raw, resolve exact references and draft an explicitly
authored Card without creating an intermediary Memory. It selects the same
engine, not a second store or automatic promotion. MCP never confirms: the
separate real-TTY review still binds the exact inspected revision and sources.
Ordinary private-Card MCP remains receipt-only unless that profile is selected.

Core owns private Cards; the product supplies UI, authority and publication
around that core. See [the run/handoff guide](private-engine-v1-local.md).

Run `node examples/private-cards.mjs` with Node 22.16 or 24. It creates a fresh
synthetic SQLite file, closes/reopens it and performs no model or network call.
It retains its printed synthetic database like the other core examples.
The example's scripted intent is not a real CLI confirmation adapter.

## Trusted host construction

Default construction exposes none of the new methods and retains no note.
Trusted local hosts explicitly select:

```js
openMemoryCore({ path, privateCards: {
  version: 'private-cards-local-v1', source: 'submitted-note-v1',
  storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1',
  authority: { authorize(request, authority), isCurrent(grant, request) },
} });
```

The source must be deliberately provided for this private Card under a disclosed
one-off retention policy. This submitted-note configuration alone never authorizes
chat capture, history access, file/URL fetch, backfill, providers or production enablement.
Only local plaintext storage is implemented. Unsupported encryption/hosted
configuration fails `source_unavailable`; there is no plaintext hosted fallback.
Secrets use the existing best-effort redactor, not a guarantee of secret removal.

Every data method takes `(input, authority)`; the second argument is an opaque
host object outside serialized/model/tool arguments. The example uses WeakMap
tokens issued for an independently approved exact method, payload and action
class. JSON cannot mint a token. Do not issue tokens merely because a model
invoked a tool or supplied `humanConfirmed`, `role:'user'` or a namespace.

`authorize` receives a deeply frozen strict JSON snapshot:
`{method,namespace,actionClass,actionId,targetId,expectedRevision,payloadBinding,input}`.
The ephemeral `input` lets the host compare with the exact payload previously
approved by its trusted user channel; it is never logged or retained by core.
`payloadBinding` is a core HMAC over store, method and complete original input.
The host returns an opaque grant object or null. `isCurrent` returns exactly the
same fields **except input**, plus positive integer `accessGeneration`, or null.
Core verifies exact field equality and generation twice outside SQLite locks,
then synchronously rereads canonical revisions/sources and commits with no
callback or asynchronous gap. Async/Promise grants are unsupported. The host
owns authentication, exact-scope access, generation/revocation checks and the
verified user-intent channel. An initial missing/bad grant returns
`authority_required`; final revocation/generation change returns `scope_changed`.

Reads require exact-scope read authority too. Draft creation from existing sources,
draft edits and cancellation use `actionClass:'draft'`. Authored-input creation
retains a new note and requires `explicit-user`, as do separate note submission,
note deletion, confirmation, confirmed edits and confirmed deletion. Before
confirming, the host shows/obtains approval for the exact inspected draft's
title, body, bindings and revision. Core binds confirmation to that revision;
confirmation records private curation, never truth, adoption or publication.
An optional explicit applicability choice is displayed and bound to that same
confirmation payload; omission remains unknown. Card placement and mapping
proposal use bounded `organization` authority. Mapping activation/refresh/removal
requires independent `explicit-user` authority and is not exposed by MCP startup.

## Implemented methods

All return existing `{ok:true,value}` / `{ok:false,error:{code,retryable}}`
envelopes. Only `storage_busy` is retryable. The capability descriptor
`getPrivateCardCapabilities()` lists the exact subset; it contains no private
data and requires no authority. No new method accepts a serialized grant.

| Method | Strict input fields beyond `namespace` | Success value |
| --- | --- | --- |
| `submitSourceNote` | `actionId,text,occurredAt` | `{source:NoteSourceRef}` |
| `getSource` | `source,limit?,cursor?` | `{source,parts,coverage,nextCursor}` |
| `deleteSourceNote` | `sourceId,expectedRevision,actionId` | mutation receipt |
| `createCardDraft` | `actionId,drafting:'authored',input` | mutation receipt |
| `getCard` | `cardId,responseByteLimit?` | `{card}` or `{card:null}` |
| `listCards` | `states:['draft'|'confirmed'],limit?,cursor?` | `{cards,coverage,nextCursor}` metadata only |
| `editCardDraft` | `cardId,expectedRevision,actionId,title,body,bindings` | mutation receipt |
| `confirmCardDraft` | `cardId,expectedRevision,actionId,applicability?` | mutation receipt |
| `cancelCardDraft`, `deleteKnowledgeCard` | `cardId,expectedRevision,actionId` | mutation receipt |
| `editKnowledgeCard` | draft-edit fields plus `applicability:'current'|'historical'|'conflict'|'unknown'` | mutation receipt |
| `inspectCardOperation` | `operationActionId` | `{operation}` or `{operation:null}` |
| `listCardEffects` | `limit?,cursor?` | `{effects,coverage,nextCursor}` |
| `getPrivateCardUsage` | none | explicit `submitted-note-usage-v1` projection |

The same facade advertises `selectEvidence`, `fetchEvidence`,
`revalidateEvidence`, `mapEvidence`, `applyCardPlacement`,
`proposeEvidenceMapping`, `reviewEvidenceMapping` and `listEvidenceMappings`.
Their typed refs, bounds and qualification rules are documented in the linked
read and organization contracts; existing Memory DTOs remain unchanged.

The existing note variants of `createCardDraft.input` are `{title,body,sources:[NoteSourceRef]}` or
`{title,body,authoredInput:{text,occurredAt}}`. The latter saves note+draft
atomically, with no orphan note on failure. `occurredAt` is null or canonical
UTC (`2026-10-20T00:00:00.000Z`). Note refs are core-issued
`{type:'submitted-note',namespace,sourceId,revision,contentIdentity,
completeness:'provided-note'}`. Identity is opaque HMAC bound to store, exact
scope, purpose and exact saved redacted text. Unknown source, foreign note,
deleted note, tampered identity, Raw refs or model-assisted drafting refuse
before retaining input. Direct `sources` drafting remains note-only.

An additional explicit authored variant is:

```js
{ title, body, sourcePolicy: 'retained-receipts-v1', memoryRefs: [
  { type: 'memory', namespace, memoryId, revision }
] }
```

It resolves 1–6 unique exact same-namespace current Memory refs to **all** their
1–16 actual retained receipts. Zero or too many receipts refuses atomically;
there is no silent prefix selection. Foreign/stale/deleted/historical/awaiting
Memories refuse. This mode uses existing evidence, not a new source archive or
implicit Card promotion. It makes zero model calls. Its refs are
`{type:'receipt',namespace,memoryId,memoryRevision,receiptId,contentIdentity,
completeness:'excerpt-only'}`. Receipts have no independent invented revision.
The HMAC binds store, namespace, Memory version, actual receipt identity and
exact retained text/attribution metadata. `getSource` returns exactly that
retained excerpt with `conversationCoverage:'unknown'`, never a complete Raw
conversation. No Memory/receipt prose is copied into dependency rows or effects.

Receipt bindings are required `memory-interpretation` dependencies, with an
explicit `memoryRef` and `receiptId`. Any Memory revision invalidates them,
including receipt additions, explicit promotion, filing, correction, retirement,
confirmation/rejection and episode forgetting where those paths revise a
Memory. Filing-only invalidation is deliberately conservative; no unchanged-
meaning equivalence is claimed. The schema trigger runs even through a
feature-off or legacy opener. Drafts cancel once and lose title/body/all bindings.
Confirmed authored current bodies remain private and report unavailable support;
their prior applicability review no longer applies to the changed revision.
Original successful actions replay their original
content-free receipts without reviving cancelled content. A failed enclosing
Memory mutation rolls back its dependent Card/effect changes too.

Each Memory supports at most 128 live dependent Cards, counted once per Card
even when it has several receipts. Over-bound Card writes or invariant-violating
Memory fanout fail `dependency_limit_reached` atomically. New creation accepts
only canonical current sources. Confirmed edits may retain exact existing old
unavailable refs; new refs must resolve. To obtain fresh refs for an explicit
reviewed rebind, create an intentionally authored draft from the current Memory
refs, inspect its core-issued source bindings, then use those in the existing
`editKnowledgeCard.bindings` input and cancel the temporary draft. There is no
silent reinterpretation or new edit-time model work. Editing accepts the union
of core-issued note and receipt refs, within the same 16-binding bound.

Each draft has 1–16 unique required same-namespace source refs, at most 64,000
total UTF-8 source bytes. Note refs remain source-only; receipt refs require the
exact Memory interpretation. There are no locator-only/context bindings.
Each note supports at most 128 live drafts/confirmed Cards, enforced in the
transaction, including rebinds. A further binding fails
`dependency_limit_reached` atomically. Deletion verifies this invariant and
cancels/invalidates at most 128 Cards in the same transaction.

Title ≤200, body/source ≤20,000 UTF-16 units. Invalid Unicode/NUL/oversize input
is rejected. Formatting is preserved after redaction; no NFKC/whitespace rewrite.
Sources return half-open UTF-16 parts of ≤4,000 units at code-point boundaries.
`provided-note` means the provided note, never a complete conversation;
`conversationCoverage:'unknown'` is explicit. Pages default 20/max 50 items.
Every whole success envelope has a 65,536 UTF-8 byte ceiling; indivisible Cards
that cannot fit fail `context_item_too_large`. HMAC cursors bind exact scope,
store, method, source/filter and page size; any namespace mutation makes them
`cursor_stale`. Lists contain no title/body/source text.

## Retention, invalidation and replay

Attribution is unassessed and commitment unknown. Applicability defaults to
unknown; an explicit confirmation choice or confirmed edit can review current,
historical, conflict or unknown applicability for the resulting exact revision.
`support.applicabilityReviewedRevision` identifies that revision; invalidation
resets the effective review to unknown/null. Availability never overrides it.
Available canonical required sources yield support `eligible`; this describes
retained evidence only. Current common reads require eligible support plus an
explicit current review; unsupported authored artifacts remain qualified history.
Deleting a note purges its active logical text/bytes, cancels every bound draft
once at r+1 and purges that draft's title/body/bindings. Confirmed authored current
bodies remain private, with original note-reference metadata and support
`unavailable`; no deleted note text is copied into a side table. Confirmed edits
can retain an existing unavailable note ref while keeping support unavailable;
reviewed replacement refs must actually resolve. Editing never retains prior
bodies. Cancelled/deleted tombstones have no title/body/bindings and never revive.

Every existing-object mutation requires exact positive `expectedRevision` and
every mutation an `actionId`. One namespace ledger binds action ID to complete
payload, method, scope, target and revision. Exact successful replay returns the
original content-free receipt after editing, deletion and process restart;
changed payload/method under that ID fails `action_conflict`. Receipt is
`{id,revision,state,bodyRevision,effectCount}`; note submission returns only its
ref. Failed transactions retain no action/source/draft payload. Only synchronous
authored operations are advertised: no pending provider operation, leases,
asynchronous cancellation or automatic retry exists in this slice.

`listCardEffects` replays durable content-free effects with bounded pagination;
there is no host delivery or acknowledgement protocol. Effects include entity
ID/revision, stable action ID and kind. Consumers deduplicate `effectId` and
revalidate canonical state; they must not treat effect delivery as permission.
The explicit usage projection counts retained redacted note UTF-8 bytes across
all namespaces of the same owner against 200,000,000 bytes. No Raw exists here;
old Raw counters are not silently modified. The cap excludes authored Card
bodies, operation/effect metadata, SQLite overhead, WAL and backups.

Deletion guarantees active logical-row purge, not secure physical erasure from
SQLite free pages, WAL, filesystem snapshots or backups. Operators own those
retention/erasure policies and should not present this preview as hosted-safe.

## Schema and handoff

Unselected fresh/existing v18 stays v18. Explicit private-Card opt-in now upgrades
v18/v20/v21/v22 to additive v23 in the same SQLite file: v20 note/Card data,
v21 metadata-only Memory/receipt bindings and invalidation, v22 applicability
reviews, and v23 typed Card MOCs/mappings. Existing note contents and refs are
preserved. Version 19 was reserved for unimplemented future Raw; no v19
feature/migration is claimed.
The new binary can reopen retained v20/v21/v22/v23 with the feature off without
dropping data; installed invalidation triggers remain effective. Old binaries
reject newer schemas. Operators must stop
mixed-version writers before upgrading and follow backup/inventory/restore gates
for actual deployment. No user database is migrated by the tests/example. Future
Raw must choose the next real available version rather than assuming v19 was
applied. The installed tool adapter remains default-off; its availability does
not authorize production flag enablement or product migration.
