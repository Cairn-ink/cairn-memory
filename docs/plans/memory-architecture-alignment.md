# Memory architecture alignment

Status: agreed design direction, not implemented capability or benchmark success.
Recorded 2026-10-15 against public main `ad274b6117f86446fbf0ff16f503ae69d0278ce5`.
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

The latest checkpoint is **STOP the closed readable-source presentation probe**.
Its required-conclusion gain was zero, without a baseline agreed-incorrect
opportunity. No effective successor is selected. Existing failures and all closed
results remain retained; this architecture agreement does not repair them.

## Three roles, with optional paths

```text
Permitted, redacted Raw/source evidence
   |                         |
   | capture/interpret       | direct authoring from sources is possible
   v                         v
Memory -----------------> proposed Knowledge Card
   | optional derivation       |
   |                           | explicit human confirmation before sharing
   |                           v
   |                      governed shared Card
   +---- source bindings, record revisions, attribution and lineage -----+
```

Raw preserves permitted source evidence; Memory is the engine's source-backed
remembered interpretation; a Knowledge Card is an authored or curated knowledge
artifact governed by its host. These are roles, not a mandatory three-step
pipeline or three model calls. A Memory may be durable. A Card is not inherently
truer than a Memory, and a Raw-to-Card path need not create an intermediate
Memory. The full raw archive remains a future implementation contract.

Private and shared Card governance belongs to the product/host boundary.
Memory-to-Card derivation is optional; sharing requires explicit human
confirmation and authorized scope. Never silently overwrite a human-authored
Card. Preserve provenance and version links through derivation and updates.
When a supporting source changes, mark derived material stale/needs review;
do not copy an obsolete interpretation into a new current answer.
No private issue/corpus contents or raw/sharing authority are added.

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

The public core's present query boundary is Memory/episodes. Any future Card
query contract belongs at the host boundary and reuses the shared engine where
applicable; the diagram does not announce a unified Card API or second engine.
MOC routing, lexical fusion, local embeddings and broader relationships remain
unselected hypotheses requiring separate evidence before default promotion.

## Next smallest packet: inspect losses before choosing a mechanism

The next packet is offline, source-free in its public reporting, and changes no
retrieval algorithm. Primary owns scope, classification acceptance and any
successor selection; one bounded worker traces retained RQ12/RQ19/RQ22 evidence
from the closed canonical comparison using existing first verdicts only.
No rerun, rescore, new labels or old-case tuning is permitted.

Deliver a three-row public boundary table with content-free aliases, digests and
check results; keep source IDs and owner/session bindings in local retained
artifacts. Trace these possible losses: extraction/link absent;
retrieved but not packed; packed but misused. Distinguish missing observations
from observed absence and mark unavailable evidence unknown. Record selected,
fetched and actually sent evidence separately. The table must show whether an
intervention has a real opportunity to change the failed boundary; increased
source presence does not prove better answer use or a model-internal cause.

Only after this inspection may primary select at most one falsifiable mechanism
with opportunity evidence and freeze a prospective probe. A bounded,
source-grounded event/state relationship probe is a candidate, not the selected
successor, an implementation or an observed quality gain. If evidence does not
support it, record stop/re-scope rather than inventing a treatment.

Before implementation, map existing fields/contracts to an input/output manifest;
receipts have no independent revision. Add schema only for demonstrated gaps:

| Input or output | Required identity/qualification |
| --- | --- |
| Source and canonical record | Canonical memory ID/revision; immutable source ID + content digest/span, lineage; source version only where its backing contract supports one. |
| Event/state observation | Event time distinct from ingestion time; unknown times remain unknown. |
| Attribution and authority | Source author, claimant/subject as applicable, authorized namespace/scope. |
| Commitment and record state | Proposed versus confirmed/adopted; current, historical, forgotten or unresolved. |
| Relationship proposal | Typed edge, direction, endpoint IDs/revisions, supporting anchors and support/review status. |
| Evidence output | Included/omitted/unknown evidence, applicability and stale/review qualifications, bounded expansion trace. |

Freeze only a necessary relationship vocabulary subset, direction and traversal
cap. Normal capture/extraction must create any relationships tested for semantic
success; hand-authored or oracle edges establish mechanics only. Neither a
source citation nor a valid edge shape proves the relationship's meaning.

One acceptance example: a source adopted A because its price was within an
explicit budget; a supported new quote exceeds that budget, while B is only
proposed. Expected qualification: "A needs reconfirmation," not "B was adopted."
An unverified edge alone only warrants `reconfirmation-suggested`; sources must
establish the premise change. Preserve A's historical rationale.
Negative controls include a late-imported older event, a similar claim in the
wrong scope, unrelated/unsupported edges, and a changed price still within the
budget, which must not blindly invalidate A. Controls must fail unsafe mechanisms.
Do not change retrieval and interpretation together, or enable vector retrieval
in the same comparison.

Outputs are the boundary table, existing-field mapping, evidence-backed
advance/revise/stop recommendation, and, only if justified, one prospective
probe contract with exact artifact/model/rubric and resource ceilings.
Primary verifies the packet and obtains separate nonauthor Standards/Spec
review; no runtime implementation or paid execution is authorized by this
docs-only delivery.

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

## Is the planning concrete enough?

Yes for the next bounded offline packet; no for implementing the whole system.
The goal, evidence boundaries and next decision suffice for retained-loss
inspection without a broad product redesign. Before implementation, freeze its paired baseline,
artifact, model, rubric, relationship vocabulary/direction, traversal cap and
resource ceilings. Choose fusion/embedding backend only when that experiment
is scheduled.

One bounded actual GPT-6.1 Sol/high worker authors these docs; primary owns final
verification, fixed-candidate independent reviews, commit and PR delivery. Base
is recorded above; no browser flow, runtime caller or historical result changes.

[reliability]: https://github.com/Cairn-ink/cairn-memory/blob/36c566013d615bc29852428bbf5fb1c77b80c70f/docs/plans/reliability-three-stage.md
