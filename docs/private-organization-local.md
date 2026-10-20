# Typed local evidence organization

The optional private Card facade exposes deterministic `mapEvidence`,
`applyCardPlacement`, `refreshCardTopic`, `proposeEvidenceMapping`, `reviewEvidenceMapping` and
`listEvidenceMappings`. Every method uses the existing exact-namespace opaque
authority protocol and shared SQLite transaction. No classifier or model call
is introduced. [Common evidence reads](private-evidence-local.md) continue to
enumerate canonical records without requiring filing or mappings.

## Typed navigation

```js
core.mapEvidence({namespace, type: 'memory', limit: 20}, readAuthority);
core.mapEvidence({namespace, type: 'card', purpose: 'classification',
  parentRef: {mocId, revision}, limit: 20, cursor}, readAuthority);
```

Type is exactly memory or card; purpose is recall (default) or classification.
The optional exact `parentRef` restricts direct children. L2 topics contain L1
topics; L1 topics contain typed record refs. A page returns
`{type,items,indexRevision,coverage,nextCursor,invalidRefs}`. Items are:

- `{type:'topic',topic:{type:'memory'|'card',id,level,title,revision,...}}`;
- `{type:'ref',ref:{parentId,parentRevision,childType:'topic'|'memory'|'card',
  childId,childRevision,relation:'contains',bodyRevision?},label?}`;
- `{type:'unfiled',ref:TypedEvidenceRef,label?}`.

Memory pages delegate to the existing authoritative Memory MOC reader and active
index views, including rebuild unavailability, filtering, invalid-ref reporting
and source-bound labels. This byte-bounded wrapper requires no model token
counter. The original Memory `map` DTO and counter-based contract are unchanged;
Card IDs never enter it.

Card pages include confirmed Cards with eligible canonical source support,
regardless of applicability. Navigation is not a current assertion: current
`selectEvidence` still requires explicitly reviewed current applicability.
Card topic titles bind 1–5 exact supporting Card revision/body-revision pairs.
Changed or unavailable support produces a null title; stale Card membership is
hidden. Empty Card topics and their valid hierarchy edges remain inspectable in
both purposes with null stale titles. Card navigation returns no authored bodies
or note/receipt text. History inspection of unsupported authored Cards remains
available through common evidence reads.

Limits default to 20/max 50 items. Card pages consume at most 256 physical
candidates before returning an explicit partial marker; stale/skipped rows also
consume work. SQLite still performs sorting/joins; this is not a measured
large-store latency bound. Coverage reports `{status,scanned,included,partial}`.
A bounded prefix is not complete organization or recall. Follow `nextCursor`
until coverage is complete. Cursors bind store, namespace, type, purpose,
parent, page size, Memory/Card index/routing generations and read generation.
Changing a setting refuses `invalid_cursor`; a relevant mutation or grant change
refuses `cursor_stale`. Whole success envelopes are at most 65,536 UTF-8 bytes.

## Explicit Card placement

```js
core.applyCardPlacement({namespace, actionId, expectedIndexRevision,
  refs: [{type:'card',namespace,cardId,revision,bodyRevision}],
  proposal: {items: [{cardId, parentIds: [], newL1: {
    title: 'Tea experiments', parentL2Ids: [], newL2Title: 'Personal practice',
  }}]},
}, organizationAuthority);
```

An exact `organization` grant permits this bounded organization action. The host
must independently decide which inspected payload it permits; namespace fields,
model calls or serialized flags cannot issue that grant. Up to five unique Cards
and three actual parents per item are accepted. The existing placement grammar
and title validator are reused with cardId substituted for memoryId. Parent IDs
refer to same-namespace topics at the expected level; index revision guards their
versions. The engine refuses unavailable Card support, stale Card/body/index refs,
wrong scope/level, duplicate canonical titles and over-limit batches atomically.

Placement creates or replaces the selected memberships. Empty parentIds without
newL1 unfiles a Card. It never changes Card authorship, body revision,
applicability review or evidence meaning. Failure leaves the Card retrievable.
Success is a content-free operation receipt with `cardRefs`, `createdMocRefs`
and `indexRevision`; call map separately for derived titles. Exact action replay
does not recreate stale organization or expose old bodies.

## Explicit topic recovery (M07)

An edited or rebound Card has a new exact revision, so its old topic title support
becomes stale even if the authored body did not change. Refresh that existing
topic explicitly instead of creating a duplicate canonical title:

```js
core.refreshCardTopic({namespace, actionId,
  topicRef: {mocId, revision: inspectedTopicRevision}, expectedIndexRevision,
  title: 'Tea experiments',
  refs: [{type:'card',namespace,cardId,revision,bodyRevision}],
}, organizationAuthority);
```

The operation accepts 1–5 unique exact confirmed Card refs with eligible current
canonical source support, an exact topic/index version and a deliberately supplied
title under the existing placement title validator. The old topic may have a null
stale title. Refresh replaces its title-support bindings atomically and preserves
topic ID/level, refusing wrong scope, unavailable/stale refs and another same-level
topic's canonical title. No schema migration or model call is added.

Success is a content-free receipt with `id`, the new topic `revision`,
`state:'completed'`, `bodyRevision:null`, `effectCount:0`, `topicRef`, `level`,
`cardRefs` and the new Card `indexRevision`. Existing guarded hierarchy references
follow the new topic version. Card bodies/revisions/applicability are unchanged;
stale Card memberships require a separate fresh `applyCardPlacement`. Mapping
navigation also stays stale until separately reviewed through explicit-user
`reviewEvidenceMapping`. Refresh never supplies mapping review authority. Exact
action replay returns the original receipt across restart without refreshing
later state or copying title/body text into the operation ledger.

## Proposed and reviewed mappings

```js
const exactEndpoints = {
  memoryTopic: {mocId: memoryMocId, revision: memoryMocRevision},
  cardTopic: {mocId: cardMocId, revision: cardMocRevision},
  expectedMemoryIndexRevision, expectedCardIndexRevision,
};
core.proposeEvidenceMapping({namespace, actionId, ...exactEndpoints},
  organizationAuthority);
core.reviewEvidenceMapping({namespace, actionId, mappingId, expectedRevision,
  state: 'active', ...exactEndpoints}, explicitUserAuthority);
core.listEvidenceMappings({namespace, type: 'card', mocId: cardMocId,
  limit: 20, cursor}, readAuthority);
```

Mappings join same-namespace same-level Memory and Card topics. Proposal requires
an organization grant and creates only proposed metadata. Activation, reviewed
refresh of an active mapping, and removal (`state:'removed'`) require an exact
`explicit-user` grant. Both endpoint and index versions plus mapping CAS are
checked after host authority callbacks. Removed mappings never reactivate; an
exact successful action replay still returns its original content-free receipt.

At most 16 active incident mappings are permitted per topic, including stale
active entries until explicitly removed. Listing is paged and returns each
mapping's exact endpoint/index versions, state, revision, `navigable`, reason and
`meaning:'navigation-only'`. Only active mappings with current supported
endpoints and exact index versions are navigable. Any changed endpoint/index or
unavailable support stops that navigation until an explicit reviewed refresh.
Mapping writes advance routing generation independently from the Card index, so
activation does not invalidate itself. Default literal selection performs no
implicit mapping traversal, graph expansion or generated summarization.
Mappings neither grant read permission nor establish evidence support.

The MCP host may grant bounded read and organization operations, including
placement, topic refresh and proposal. It must never mint explicit-user mapping activation,
refresh or removal authority. Those remain trusted host APIs pending a separately
verified user-action interface.

## Migration and checks

Opt-in schema v23 adds typed Card topics, exact metadata bindings and mappings
to the same SQLite file. v18/v20/v21/v22 data upgrades additively; feature-off
reopening preserves it. Canonical Card changes advance the Card index through SQL
triggers, including Memory invalidation through a feature-off opener. Applicability
and source support remain independent of filing. No new index table stores Card
or source bodies. Operators must close mixed-version writers and perform their
deployment backup gates; these synthetic checks authorize no user-store upgrade.

Run `node tools/testing/run.mjs core/test/private-organization.test.mjs` on Node
22.16 and 24.15. Owned synthetic workspaces cover typed maps, old Memory-map
compatibility, authoritative index unavailability, bounded placement, source
invalidation, mappings, cursor scope/revocation, migration and process restart.
Installed MCP/artifact evidence and independent final reviews remain separate
integration gates. No semantic quality or retrieval improvement is claimed.
