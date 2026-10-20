# Memory architecture alignment

Status: agreed engine ownership and design requirements; technical contract
pending owner review. No implementation or benchmark success is claimed.
Recorded 2026-10-15 against public main `ad274b6117f86446fbf0ff16f503ae69d0278ce5`;
ownership and acceptance sequence updated by owner decision on 2026-10-20.
This is a bounded architecture addendum to the [single reliability plan][reliability], not another roadmap.
The pinned plan is in open PR #422, not merged behavior.

The goal remains a lightweight, source-backed, reliable public memory engine
usable through Hermes and other harnesses. Hosts use one shared engine rather
than maintaining separate memory implementations. This document changes no
runtime, defaults, schema, retention, permissions, model usage or release.

## Present capability and open boundaries

Current main has Memories, source receipts, revisions, explicit supersession,
[session episodes](session-episodes.md), and
[source-backed rationale](../source-backed-rationale.md). These are existing
building blocks, not missing features to recreate or proof of reliable end-to-end
extraction, relationship interpretation, retrieval or answer use.

Existing relationship proposals include `supports-decision` (premise -> decision)
and `challenges-premise` (new evidence -> premise). They remain model-proposed,
not adjudicated semantic truth. Current rationale reads already enforce revision,
source and namespace guards with bounded linked evidence. A challenge suggests
reconfirmation; it does not establish a failed premise or replace the decision.
Any prospective change first reuses this contract and identifies a specific gap,
rather than assuming a new general relationship graph is required.

[Current recall](../fetch-recall.md) uses injected selection/ranking and bounded
literal candidate pages. Those private pages omit group headers/edges, losing
group routing context. Stored [MOC organization](../moc-placement.md) is
`L2 broad groups -> L1 topics -> memory references`; current default recall
does not fully route through that hierarchy. Filing establishes neither truth
nor permission. Vector/hybrid retrieval and unified Memory/Card queries are
not shipped claims made by this plan.

The [raw-layer contract](raw-layer-contract.md#scope-ownership-and-gates) is
decided but not implemented. It archives only permitted, locally redacted,
selected user/assistant text; RL-0 excludes tool calls/results and file reads.
It authorizes no raw search or read-triggered model work: recall continues to
use Memories and episodes. Existing capture allowlists, notice, retention,
namespace, deletion and production gates remain authoritative.

The retained evaluation checkpoint is **STOP the closed readable-source presentation probe**.
Its required-conclusion gain was zero, without a baseline agreed-incorrect
opportunity. No effective successor is selected. Existing failures and all closed
results remain retained; this architecture agreement does not repair them.

## Settled ownership: one public engine, three data roles, optional paths

```text
Same public engine
  Permitted, redacted Raw/Source -> Memory
             |                       |
             +---- retained sources <-+ original-source lookup for drafting
                          |
                          v
                   private Card draft -> confirmed private Knowledge Card
                          |                    |
                          +---- edit/cancel     +---- edit/delete

Product/harness: explicit authorized publication into a governed destination
```

Raw preserves permitted source evidence; Memory is the engine's source-backed
remembered interpretation; a Knowledge Card is an authored or curated knowledge
artifact that may remain private. These are roles, not a mandatory three-step
pipeline or three model calls. A Memory may be durable. A Card is not inherently
truer than a Memory, and a Raw-to-Card path need not create an intermediate
Memory. A retained receipt or episode excerpt is not a full Raw archive. Full
Raw and the Card lifecycle below remain target contracts, not shipped features.

The 2026-10-20 decision supersedes this addendum's earlier host-only Card and
Card-query ownership. It assigns all three canonical object kinds to the same
public memory engine; adapters must not duplicate its Card implementation.

| Public engine owns | Product or harness owns |
| --- | --- |
| Raw/Source, Memory and Knowledge Card storage/lifecycle; Card creation from retained sources or Memory-triggered original-source drafting; draft confirmation, cancellation, editing and deletion. | UI and final answer rendering; collections, team/community publication and moderation; destination ACLs, quotas and explicit sharing authority. |
| Source identity/available version and Memory ID/revision provenance, invalidation, Memory and Card MOC organization/mapping, shared typed bounded evidence reads and coverage. | Authentication and trusted scope supplied to core; capture notice/controls and host encryption ports under the existing raw contract; publication attachments and consumption of engine invalidation. |

Local standalone must work without hosted Cairn services. Model providers remain
an explicit injected choice; using a remote provider can send bounded model input
over the network. This requirement does not waive RL-0 implementation, notice,
retention, deletion, encryption or production gates.

Private Card confirmation requires a trusted user action and is distinct from
publication; model output cannot grant that authority. No automatic mass Card
publication or private-to-shared scope expansion follows from capture, drafting,
confirmation, retrieval or MOC filing. Source support, adoption evidence and
authorization remain separate checks. Source changes/deletion invalidate affected
support and derived applicability without silently overwriting a human Card.
Authored content may remain under its own lifecycle, but stale evidence must be
blocked in engine evidence reads, not merely marked in the UI. Exact deletion,
attachment and surviving-support effects need the technical owner review below.

## Retrieval: two responsibilities, not two fixed model calls

The agreed target separates finding possible evidence from checking what that
evidence can currently support. Each path remains within the host-authorized
read set; no mandatory new service or graph database follows.

```text
Query + authorized scope
          |
          v
Scoped candidate retrieval (parallel where appropriate)
   +----------------+----------------+----------------------+
   | MOC navigation | lexical index  | optional local vector|
   | L2 -> L1 -> ref|                | index (unselected)   |
   +----------------+----------------+----------------------+
          | candidate record IDs + versions
          v
Union / deduplicate / bound candidate and context budgets
          |
          v
Fetch canonical records (current; explicit history when needed)
          + bounded validated relationship expansion
          |
          v
Check scope / event time / proposal-adoption / state / source support
          |
          v
Evidence context: current assertions / history / conflict or unknown
          |
          v
Host answer with qualifications and source attribution
```

MOC remains navigation, not a third memory tier. Index hits resolve to canonical
records by identity and version; index text or an old snapshot cannot become
answer authority. Recheck current records, evidence and scope after expansion.
History questions may deliberately read retained historical evidence under the
same revision/source/scope guards; no new `asOf` support is claimed.
Relationships are logical typed links with support, not a requirement to adopt
a graph database. Topic similarity never shares ACLs. Multiple copies derived
from one source are not independent corroboration. Stale index hits/edges cannot
resurrect forgotten records or present superseded evidence as current.

The public core's present query boundary is Memory/episodes. The target shared
engine read contract includes typed Memory/Card evidence and bounded authorized
source anchors; it does not authorize arbitrary Raw full-text search. A response
is a revalidated snapshot for its authorized scope, not perpetual permission;
consumers must not reuse it after relevant scope/source/version changes as if
still current. Receipts have no independent revision to invent.

One engine/common retrieval contract does not require one physical merged MOC
tree. The latest product request is two typed Memory/Card indexes with explicit,
scoped, revision-bound and revocable mappings. A title match cannot merge topics
or widen ACLs. Unmapped/unfiled records must remain recallable under their own
scope; mapping removal cannot erase canonical content. The mapping schema and
traversal bounds need owner review. MOC routing, lexical fusion, local embeddings
and broader relationships remain unselected retrieval mechanisms requiring
separate evidence before default promotion.

## Design review before implementation

Settled ownership above is sufficient to prepare a reviewable design, not an
approved schema. Before implementation, the technical-contract owner must review
the following observable requirements and resolve their exact representation:

| Contract area | Required review result |
| --- | --- |
| Objects and lifecycle | Identity/scope/version and transitions for Raw/Source, Memory and private Card; source- or Memory-initiated drafting; explicit confirm/cancel/edit/delete, retries and concurrent changes. Confirmation is not sharing. |
| Provenance and invalidation | Source IDs/digests/spans and supported source versions; Memory IDs/revisions; attribution, commitment and applicability. Source/Memory correction, forgetting, deletion and loss of support invalidate dependents without rewriting human content or restoring forgotten text. Protect private provenance across publication. |
| Event and relationship evidence | Event time distinct from ingestion time, with unknown times explicit; typed directed links bind endpoint IDs/revisions, supporting anchors and support/review status. Reuse current rationale guards; a model proposal is not a verified premise or adopted decision. |
| Organization | Two typed MOCs and explicit bounded mappings; revision/scope guards, revocation and unfiled fallback; placement preservation only for reviewed safe transitions. |
| Shared reads | Typed authorized evidence, bounded source anchors, paging/budgets, included/omitted/unknown coverage, stale/review qualifications and final canonical revalidation. Preserve explicit history without presenting it as current. |
| Local storage and migration | Restart-safe transactions, cancellation/retry/deletion fences, schema compatibility, migration/rollback limits and cleanup. Reuse existing core fields before adding schema; never infer missing raw or source versions. |
| Sharing attachment | Engine-owned Card versus host-owned destination/publication records; explicit destination authority, copied versus referenced support, private provenance projection, withdrawal/invalidation and durable cross-boundary effects. No assumed cross-database transaction. |

The owner-reviewed output must identify existing contracts, demonstrated gaps,
exact state transitions and required conformance fixtures. It must also say
which proposed capabilities below enter the first slice and which remain later.
This document does not settle field names, API signatures or an approved V1
schema by implication.

The proposed [three-layer engine contract](three-layer-engine-contract.md)
supplies concrete objects, APIs, transitions, source fences, typed reads and
standalone acceptance fixtures for that review. It remains a draft requiring
owner decisions; it is not runtime approval or evidence of passing behavior.

## Product capability proposals: constraints, not blanket V1 approval

These proposals inform the review above. A product capability request does not
by itself approve a schema, a paid maintenance job or a V1 release commitment.

| Proposal | Required boundary before adoption |
| --- | --- |
| E1: topic overview | Exact authorized namespace and bounded traversal/counts; deduplicate descendants in a DAG and expose partial/unknown coverage. An added-time view uses actual addition time, not an arbitrary record revision timestamp. |
| E2: generated topic summaries | Optional later derived cache, neither a fourth canonical layer nor a user-authored Card. Bind every sentence to support IDs/versions; support changes immediately make old summary evidence ineligible. Explicit budgeted maintenance uses an injected model, never a read-triggered paid call. UI staleness alone is insufficient. Not mandatory standalone V1. |
| E3: two-MOC mapping | Engine-owned typed Memory/Card indexes, scoped revision-bound revocable mappings and unfiled recall as specified above; no title-based merge or ACL inheritance. |
| E4: source invalidation | Propagate changed/removed support through Memory, Card and derived evidence, with private provenance protected. Authored Card retention does not preserve invalid source authority. |
| E5: placement preservation | Same-scope navigation-only changes with unchanged content may preserve placement atomically. Semantic or scope changes require revalidation/reclassification or unfiled fallback; no blind inheritance. |
| E6: reverse source navigation | Bounded links from Memory to actually retained episode/source references. No recovery claim for deleted or never-retained originals. |
| E7: Raw navigation | Paged retained-source navigation under existing RL-0 policies and gates; expose unknown times, scope and partial coverage. No Raw full-text search expansion. |
| E8: both-valid conflict dismissal | A trusted human decision binds to the exact pair of versions and scope; changed evidence requires renewed review. It does not establish universal truth. A model-supplied human-confirmed label is not authority, and existing qualification transition guards remain. |
| E9: shared evidence | A common typed bounded read over the authorized set, including source anchors, with final scope/version/source checks. No arbitrary Raw search or invented receipt revision; consumers use a fresh snapshot rather than permanent authorization. |

## Acceptance sequence

1. **Design review:** complete the technical-contract review above before runtime
   implementation. Retain unresolved questions explicitly rather than marking
   this requirements document an approved implementation contract.
2. **Local usable slice:** implement only the reviewed bounded source/Memory/Card
   path, with local persistence and inspection. Demonstrating a useful slice is
   not completion of standalone V1 or semantic reliability.
3. **Full standalone V1:** require reliable bounded reads, source invalidation,
   lifecycle and scope safety, and actual MCP use in a new session after a
   process restart.
   A scripted in-process demonstration alone cannot pass this gate. Hosted
   product integration is not a prerequisite for standalone acceptance.
4. **Product adapter and migration:** reuse the accepted engine through a
   separately tested adapter. Existing product UX stays unchanged absent explicit
   signoff; publication and migration retain their own safety/production gates.

Acceptance follows one decision over time: A is adopted because its price is
within a recorded budget; a supported new price exceeds that budget; B is only
proposed; A needs reconfirmation, with no adopted B inferred. If the source later
explicitly adopts B, record the change while preserving A's historical rationale.
An unverified challenge only warrants `reconfirmation-suggested` until source
support establishes the premise change. Source support never grants execution or
publication authority.

Controls cover a late-imported older event, a similar claim in the wrong scope,
an unrelated/unsupported edge and a changed price still within budget. Lifecycle
fixtures also cover correction, forgetting with retained Raw exclusions, cancelled
drafts, idempotent retry/restart, scope revocation, source/Card deletion and
cleanup without resurrecting removed evidence. Normal capture/extraction must
create relationships used for semantic acceptance; hand-authored/oracle links
establish mechanics only. Neither a citation nor a valid edge proves meaning.

Report mechanical conformance, real-model semantic reliability and installed-host
evidence separately. No full benchmark success, new paid scope or changed budget
follows from this sequence. Freeze any prospective probe's baseline, exact
artifact/model/rubric, vocabulary/direction, traversal cap and resource ceilings;
do not change retrieval and interpretation together or add vectors in the same
comparison.

## Historical diagnostic packet

The earlier three-case loss inspection and its NEXT instructions are historical,
not current pending work or a selected successor. Keep its closed evidence and
first verdicts unchanged. Its useful diagnostic distinctions remain extraction/
link absent, retrieved but not packed, and packed but misused; missing observation
is unknown, not observed absence. Increased source presence alone proves neither
better answer use nor a model-internal cause. Any new experiment needs a fresh
prospective contract and the unchanged reliability/resource gates below.

## Preserve milestones, denominators and resource gates

Data roles above are separate from the original evaluation stages:

| Stage | Unchanged destination |
| --- | --- |
| 1 | Diagnose retained losses and unknowns with red-capable controlled evidence. |
| 2 | Freeze 24 development cases and a paired baseline before one-factor candidate selection. |
| 3 | Fresh 30-case paired pilot, plus separate independent reliability, real installed Hermes new-session use and resource gates. |

P4 still requires net correct gain >=3/24 over that candidate's same-roster paired
baseline, improved targeted-stage evidence, no increased unsupported/stale use,
and no newly failing severe case. Unknown safety blocks advancement. Two
unsuccessful controlled rounds trigger hypothesis/ownership re-scope; candidate
selection remains bounded by the original plan, not unlimited retries of closed
runs. Preserve all failures and prohibit old-case tuning or closed-run retry.

Stage 3 still needs completion >=29/30 and Cairn correct count >= same-batch
Mem0, with every failure/unresolved case in the fixed denominator and paired
uncertainty reported. This is not population parity proof or product acceptance.
Reliability and genuine installed-host behavior remain independent gates.

Measure calls, input/output tokens, latency and storage across the full
write/update/read lifecycle, including extraction, filing/indexing, relationship
updates and invalidation, not only final recall. Freeze affordable ceilings
before an experiment; first candidates require no external database service.
The original cumulative US$400 ceiling and protected US$30 remain intact with
no reset. Historical balances are not current affordability. Later paid work
requires separately frozen/reviewed scope and a fresh conservative affordability
check under that original budget; this document supplies no spending authority.

## Delivery boundary

This addendum records settled ownership and design acceptance requirements.
Technical-contract owner review remains pending; no runtime work or paid execution
is authorized by this docs-only delivery. Choose fusion/embedding backends only
with an independently justified, frozen experiment.

One bounded actual GPT-6.1 Sol/high worker authors these docs; primary owns final
verification, fixed-candidate independent reviews, commit and PR delivery. Base
is recorded above; no browser flow, runtime caller or historical result changes.

[reliability]: https://github.com/Cairn-ink/cairn-memory/blob/36c566013d615bc29852428bbf5fb1c77b80c70f/docs/plans/reliability-three-stage.md
