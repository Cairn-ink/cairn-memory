# Complete canonical comparison delta, revision 3

Status: revised design for review; no runtime implementation is authorized by this document.
Evidence baseline: main `c1019314`; S1 `pr/504` at `f17f0d96`; cutoff at `f4077b62`.
These are inspected Git revisions, not runtime qualification results.
**P** means `docs/plans/context-read-incremental-catchup.md`; unqualified source anchors
refer to the evidence baseline. Explicit ref prefixes identify other inspected revisions.
This revision amends the agreed Memory suppression interface and its equality input.
All other rules from revision 2, including staged safety and legacy-cell policy, remain unchanged.

## Amendment boundary and conflicts

This separate delta follows `docs/plans/context-read-maintenance-cutoff.md:3–5`.
It does not edit P, change canonical safety storage, or select a conditional delta engine.

| Text amended or superseded on approval | Replacement and evidence |
| --- | --- |
| P §3.1:647–665: intent and complete inputs | Safety-owned per-intent policy and complete observations below replace Boolean-only equality; current mapping is `core/context-product-sidecar.mjs:360–385`. |
| P §3.1:655,676: fence payload | Explicit scope and lossless stored-byte comparison apply even with an empty document delta; existing fences: `core/context-product-sidecar.mjs:98–105`. |
| P §3.2:738–763: capture/output | Bounded coherent capture, observable result/lookup accounting and string manifests below; completeness and no-stitching remain mandatory. |
| P §9:1759–1769: complete B3S prerequisite | The decided A/B/C staging below replaces the blanket prerequisite; restore admission remains an independent mandatory gate. |
| P §9:1769–1770: B3/B4 split and estimate | The handoff and estimate below apply; B4 owns durable credit installation and bounded-as-of readiness. |

**History conflict:** P:244–250,652–654 requires current Card eligibility for history;
the S1 clauses at `pr/504:docs/plans/context-read-incremental-catchup.md:246–258,661–671`
differ. This delta adopts those revised clauses.
**Prerequisite conflict:** P:1759–1769 requires complete B3S. The decided staged capability
policy below replaces that package-order requirement; it does not waive P §3.4 admission.
**Format/staging conflict:** P:1333–1344 requires new-format records, while P:1774 assigns
cutover later. In-memory B3 output does not reinterpret existing certificates; production
credit waits for B4's reviewed storage/activation path and all applicable admission gates.

## Intent rule

Project-owner intent policy, as adopted by the cited S1 clauses:

- A superseded Memory, rather than corrected old text, is readable and labelled in history.
- A Card in history does not require that it still holds now; current mode is unchanged.
- Forgotten, deleted, purged, privacy-erased or unauthorized content and pre-correction text
  never appear in any mode.

B3 reevaluates every selected Card, including previously denied Cards and unchanged revisions,
under the requested intent. It never forces `intent:'current'` for history or selects an
authoring purpose. The safety track owns retrieval policy and historical labels.
Common safety and current-only eligibility follow
`pr/504:docs/plans/context-read-incremental-catchup.md:246–258,661–671`;
dispatch/policy evidence is `pr/504:core/content-safety.mjs:17–30,186–201`.

## Decided safety staging and universal restore gate

The minimal safety delivery defers the external erasure ledger and recovery inspection;
conditional packages remain subject to the later architecture gate. Suppression is S2h and
lineage is S2c. Staging is decided; capability delivery and attestation must still be verified.

| Stage | Selected capability and claims | Mandatory fail-closed boundary |
| --- | --- | --- |
| A — until the suppression package lands | S1 only: preparation and diagnosis; no closure or renewal credit. | Missing required observations or interrupted work is incomplete, never equal; Boolean decisions do not stand in for fingerprints. The restore gate below applies. |
| B — after the suppression package lands | S1 plus the agreed suppression interface: credit-eligible evidence for explicitly Memory-only `types:['memory']` selections. **This is the implementation priority.** | Require complete bounded capture, layout attestation, the legacy policy below where applicable, restore admission and B4 validation. No implicit type downgrade; missing/interrupted means incomplete. |
| C — after the lineage package lands | Card selections also become credit-eligible with S1, suppression and lineage commitments plus the later Card interface. | Require complete bounded capture, attested applicable observations, restore admission and B4 validation. A package label or Boolean-only adapter grants no credit. |

**Safety choice:** Card selections remain preparation-only until lineage commitments exist.
**Hypothesis:** equal current-binding/suppression observations can miss former-source lineage
changes. This restriction is a conservative policy choice, not a measured implementation gap.
S1 currently enumerates surviving bindings and returns decisions
(`pr/504:core/content-safety.mjs:87–98,160–201`); P:415–426 specifies durable provenance.
**Hypothesis:** a Boolean-only comparison can falsely equate changed facts with the same
decision bit. Complete observations, not eligibility alone, are the equality inputs.

**Restore restriction — every stage and every layout, including legacy:** until the external
ledger restore-admission mechanism exists, a store restored from backup must not return
directly to service. The safety track or host owns and enforces this gate.
**Counterexample (hypothesis; no restore campaign):** a backup predating a forget can contain
internally consistent local identities, lineage and suppression while omitting that later
forget. Complete local comparison is not authoritative evidence of non-rollback.
No comparison, sidecar rebuild, new certificate or B4 installation substitutes for or bypasses
restore admission. Exact, fallback and indexed service remain denied without the required
proof; once available, admission follows quiescent ledger replay and handoff in P:869–889.

## Legacy layout policy for path B

After the suppression package lands, an attested legacy safety layout with no suppression
fact table returns a complete observation with capability `none` and suppression fence `null`.
B credit on this layout is an explicit policy choice; it is not proof of absent historical
erasures. A missing package/API or failed layout attestation is incomplete, not legacy success.
Until migration, this layout cannot record owner-erasure or pending-cleanup facts.
Widening service beyond the owner requires the safety migration. The restore gate still applies.
After migration the fence changes from `null` to non-null: treat this as a fence/capability
change, invalidate the prior comparison basis and recapture; never coerce `null` to an epoch.
Unknown or inconsistent layouts fail closed. Required regression: legacy B capture followed by
migration forces complete/different and a fresh capture, never equal renewal.

## Agreed suppression interface for path B

The following contract is agreed with the safety track; names are provisional and safety-owned.
It specifies the required interface, not a claim that the inspected S1 already exports it.
Calls are synchronous inside the caller's canonical transaction, content-free and charged;
B3 implements no suppression facts, matching policy, lineage reconstruction or migration.

**Fence:** `contentSuppressionFenceInside(db, ownerId)` executes one statement inside that
transaction. It returns the per-owner monotone two-limb epoch `"hi:lo"`, `'0:0'` for an owner
with no facts, or `null` for an attested legacy cell. Facts are append-only and every fact
insert advances the epoch. Bind store incarnation as store id plus suppression domain.
Keep limb strings exact; no floating-point conversion or namespace-only substitute.
Per-owner scope is intentionally coarser than the selected namespaces; include that scope
in the manifest. A fence change always requires recapture even if document contributions match.

**Per Memory:**
`memorySuppressionObservationInside(db, ns, {memoryId, revision}, {memo, reader})`.

| Outcome | Exact agreed shape |
| --- | --- |
| Complete | `{complete:true, suppressed, matchedCount, matchedEpoch, factId, reason, matchedSetDigest}` |
| Incomplete | `{complete:false, cause:'unavailable'\|'budget'}` |
| Attested legacy | `{complete:true, suppressed:false, capability:'none'}` |

`matchedEpoch`, `factId` and `reason` are nullable; preserve the agreed returned values.
The agreed amendment defines `matchedSetDigest` as SHA-256 (base64url) over the matched facts
in canonical order: sort by `(epoch_hi, epoch_lo)` and contribute `[epoch_hi, epoch_lo, fact_id]`
for each fact. Per-owner epochs are unique and facts immutable; the empty match uses the fixed
digest of the empty list. The safety track computes this from the matched facts with no extra reads.
Matching uses the safety-owned Memory predicate, including mutable Raw ancestry on Raw-capable
bases. The digest covers matched **facts**, not ancestry itself: unchanged matched sets compare
equal only if everything else is equal; altered matched sets change the digest.
B3's per-Memory suppression equality input is `(suppressed, matchedSetDigest)`, together with
the owner fence and incarnation/domain. `matchedCount`, `matchedEpoch`, `factId` and `reason`
are diagnostic/supporting fields, outside equality records and equality-root inputs.
A missing digest in a non-legacy complete observation is a contract violation: return incomplete.
The attested legacy and incomplete shapes above remain unchanged.
The charged `reader` **must forward `isTransaction`** and enforce the shared preflight account.
Use S1's snapshot-local `memo`, never a cross-attempt cache of denials or missing results
(`pr/504:core/content-safety.mjs:33–40`;
`pr/504:core/context-product-sidecar.mjs:362–365`).
A complete denial is comparable; unavailable required evidence or exhaustion is incomplete,
never an invented `suppressed:false` or `eligible:false` complete result.

**No receipt observation for Memory documents:** the indexed document is Memory `content`
only (`core/context-product-sidecar.mjs:736`). B3 does not request per-receipt suppression
observations for that document. Receipt suppression remains a read-time S1 decision
(`pr/504:core/content-safety.mjs:42–68,176–184`), independent of comparison credit.

## Later Card interface for path C

Keep this later request separate from the agreed Memory interface; it does not block path B.
Names, matching and intent policy remain safety-owned. Every selected Card, including denied
Cards, needs comparable policy-required facts with explicit completeness:

| Later observation family | Existing seam and requested owner |
| --- | --- |
| Item/body/source incarnations, exact versions and capability/policy revision | S1 exact-ref checks: `pr/504:core/content-safety.mjs:163–175`; suppression supplies its identities; lineage supplies body/provenance identities. |
| Header state, body/provenance revision and monotone contributor/ancestor commitments | S1's temporary binding enumeration: `pr/504:core/content-safety.mjs:87–98`; lineage owns authoritative commitments surviving binding/child deletion. |
| Live support/existence/content commitments and scoped suppression facts | S1 source checks: `pr/504:core/content-safety.mjs:102–155`; suppression and lineage bind all applicable ancestors without source text. |
| Applicability/declaration/context/vector and consulted method identities, absent slots, lifecycle/manifest commitments | S1 callback: `pr/504:core/context-read-sidecar.mjs:667–675`; comparator: `core/card-current-storage.mjs:27–62,84–90`; richer adapter is safety-owned. |

Require the same completeness, resource/preflight, transaction-aware reader, snapshot-local
memo and fence contract. Unknown lineage is a complete denial only when safety returns the
complete comparable denial required by its policy; interruption is incomplete.
Policy-irrelevant fields are tagged not-applicable, never fabricated successful checks.

## Aggregate capture budget and snapshot boundary

The public input remains `maxItems,maxMs` (`core/context-read-input.mjs:189–190`).
`maxItems` limits transformations. Private aggregate limits add no public knobs or time.
These are planning choices, not measured feasibility bounds:

- Row limit: **131,072 observable result/lookup units** per attempt, including base-map,
  canonical metadata, safety, support, dependency, fence and changed-byte queries.
  Derivation: supported ceiling **1,024** × batch **128**, independent of actual `maxItems`
  (`core/context-read-input.mjs:190`; `core/context-product-sidecar.mjs:686`;
  planning probe P-planning-arithmetic from revision 1).
  Each returned result row counts; an empty lookup counts as a lookup unit. Repeated native
  results count again; memo hits need time checks but no native-result unit.
  These wrappers do not count SQLite internal scan visits or physical pages. Charge elapsed
  native work and measure lock/writer effects separately; this cap is no internal-I/O bound.
- Byte limit: **32 MiB / 33,554,432 bytes** of materialized capture traffic, adopting P:1442's
  numeric ceiling as an additional traffic limit, not reinterpreting the original debt limit.
  Count UTF-8 metadata/manifest/text and binary plus encoded-string bytes, including expansion.
  All variable-length fields require preflight: IDs, keys, references, dependency records,
  bodies, blobs and output encodings. Fetch bounded byte lengths first in the same snapshot;
  use byte length such as `length(CAST(value AS BLOB))`, not NUL-truncating text length.
  Preflight the ID and its hex expansion before selecting either. Nothing is materialized
  past the remaining row/byte allowance; oversized fields or records make capture incomplete.
- Live retained payloads share that byte ceiling; it is not a JavaScript heap bound.
  Also enforce P:1442's owner/intent unprocessed-byte and pending-replacement limits across
  existing work plus capture. Unchanged metadata identities are not pending replacements.
  No hidden queue/spill bypass; release aborted output and charge base loading/chunk encoding.
- Preserve Raw per-source **64,000-byte / 1,024-row** allowances within the aggregate account
  (`core/card-raw-sources.mjs:87,113–124`; `pr/504:core/content-safety.mjs:196`).
  Per-source resets never reset aggregate allowance; all helper results/lookups debit that account.
- Time/lock: use `min(operationCutoff,refreshStart+maxMs)` and existing reserve/admission
  (`core/context-product-sidecar.mjs:866–870`; `core/context-product-quantum.mjs:3–10`).
  Finish capture before cutoff minus reserve. Check before/after bounded native statements and
  observations; acquisition/waits count. Record lock hold and actual DELETE writer interference.
  An overrun earns no complete result; retain parent cutoff and disposal enforcement.

Every admitted catch-up, including apparent ready/no-op work, compares completely despite
scalar equality (P:647–665); ordinary read/status requests remain scan-free (P:763).
Load the immutable authenticated base/work map before capture. Sample the coverage-clock
provider immediately before acquisition; use the attributed canonical read seam
(`core/context-product-sidecar.mjs:115–118`) for the entire capture, without nested transactions.
Metadata pages, applicable observations and fences share that snapshot; no canonical
transaction spans sidecar COMMIT, provider await or another quantum.
Per-page merge is preparation only (`core/context-product-sidecar.mjs:684–688`).
Abort/exhaustion retries from the beginning: **never stitch snapshots**.
Retain independently exact artifacts, not a partial closure cursor/sample. Validate prepared
content/provenance in capture or capture required bytes there; no newer body relabelled E
(P:742–763). **Hypothesis:** these limits admit realistic shapes; measure actual safety,
support and DELETE costs (P:678–734). Failure reports budget exhaustion; B4 applies expiry/fallback.

## Fence scope and byte-safe comparands

Bind content-free fence records in the capture snapshot, with attested capability tags.
Except for the explicitly admitted legacy suppression variant, missing required families or
failed attestation is incomplete. Distinguish absent epoch rows from present rows.

- Namespace: selected namespace identity, Memory epoch and selected Card epoch
  (`core/context-product-sidecar.mjs:98–105`).
- Raw, including Memory-only selections on Raw-capable layouts: exclusion-clock row,
  complete session-fence keys, conversation identity/revision pairs and exclusion tuples
  scoped through parent conversations, with presence tags, counts and ordered tuple digests
  (`core/raw-schema.mjs:18–21,28–34`; `core/raw-lineage-schema.mjs:22–29`).
  This aggregate fence does not introduce per-receipt Memory observations.
- Methods for Card selections: dependency-table capability, declaration presence per selected
  namespace and method epochs across the full selected readSet, under both intents even
  without declarations. This expands comparison scope at `core/card-current-storage.mjs:15–17`,
  not history eligibility or request-fence APIs. Absent capability queries no missing table;
  Memory-only methods are not-applicable; dependencies cannot expand the authorized readSet.
- Suppression: the agreed per-owner fence and store incarnation above, including legacy
  `null`; later Card provenance fences remain safety-owned, not binding-derived.

**Every new fence comparand follows stored-byte rules**, including Raw session/client keys,
namespace components, references and tuple fields. Use explicit `COLLATE BINARY` in TEXT
keyset predicates and `ORDER BY` for every tuple cursor component; an index name or primary-key
collation is not sufficient. Preserve exact stored-byte ordering in the merge and digest.
Preflight lengths before materializing text/hex. Validate lossless stored-byte round trips
under the attested encoding, or use a lossless byte encoding with native byte-preserving cursors.
Do not bind a decoded alias or compare encoded text using the original column's collation.
Failed validation/binding or unsupported encoding makes comparison **incomplete**, never equal.
Existing item guard evidence: `core/context-product-sidecar.mjs:360–377,640–643`.
Probe P-fence-bytes reproduced ordinary pagination `[Z]` versus BINARY `[Z,z]`, and
`session\0old` / `session\0new` both decoding to `session` with different stored bytes; exit **0**.
A changed fence, including legacy `null` becoming non-null, requires recapture and a new B4
certificate binding even for an empty document delta (P:655,676), not equal-witness renewal.

## Transaction-compatible manifest and B4 consumption

B3 returns plain records/arrays with **plain string chunks**, including captured text.
No Buffer, typed array, live cursor, function or opaque handle crosses `readTransaction()`.
The materialized-output guard rejects opaque objects and discards the connection
(`core/database.mjs:271–295,311–330`); P-output reproduced Buffer rejection with
`storage_error` and a closed connection, and successful plain-string output; exit **0**.
Captured binary uses tagged lowercase hex string chunks, exact byte length and digest;
preflight/charge both binary and encoded sizes, validate on decode, and retain no mutable alias.

Return a small envelope plus separate string-payload arrays, all within the aggregate account.
The envelope contains roots/counts and bounded chunk descriptors, **not the chunk payloads**.
Cap total manifest/text/binary chunks and descriptors at **1,024**, a planning cap using the
existing item ceiling (`core/context-read-input.mjs:190`); P-output serialized a synthetic
descriptor envelope at that count. This is not whole-capture feasibility evidence.
Additionally preflight/validate the actual envelope against **8,192 nodes / 262,144 bytes**
(`core/context-product-control.mjs:29–32,60`; `core/context-product-validation.mjs:6`).
Each frame and serialized string chunk must independently fit the existing serializer limits.
Whichever node/byte/count/aggregate limit is tighter applies; no oversized frame is truncated.
The payload arrays use the synchronous plain-value guard, not a single whole-payload
`canonicalJson` call; no limit is raised. P-map-envelope rejected **1,642 / 3,336** records at
**118,779 / 242,441** bytes; exit **0** (revision 1 probe; populations P:684–685).
Never put the complete map in `g.verify` or add optional tables to existing formats.

Use canonical JSON/newline record frames, whole-frame manifest chunks and streaming SHA-256
over exact UTF-8 bytes. This revision defines domain `context-read/b3-input-v2`; recapture
earlier manifests rather than reinterpret them. Bind store/canonical identity, selection,
intent/access, capability/policy/resource revision, ordered item observations and all fences.
Order item keys by namespace/type/stored identity bytes, independently of Card state streams;
include every selected state and terminal counts. Memory tuples include metadata/content
identity and the agreed suppression equality input, **no receipt observation**. Card facts use path C.
Item/manifest records contain no body/source text; captured text/binary is separate payload.
Comparison ID, base checkpoint and sample are envelope bindings, not equality-root inputs.

The envelope binds comparison identity, base/work seal, root/counts/chunk order, scope, resource
usage and original pre-acquisition clock evidence. Only B4 persists complete output in reviewed
authenticated new-format storage after canonical release and rechecks the base/work seal.
All buffers inside capture are encoded before return. Lost volatile output requires recapture;
only authenticated complete B4 state survives restart with original time (P:1291–1302,1314–1325).
Persistence validates neither restore admission nor a restarted clock domain (P:191–210,869–889).

| B3 result | Meaning and B4 consumption |
| --- | --- |
| complete/equal | Complete required observations, bytes/artifacts and fences equal the authenticated base; B4 may consider renewal only after capability, restore, clock and certificate checks. |
| complete/different | Complete enumeration/absence and required byte capture or artifact validation; B4 reconciles/verifies the captured input set before any closure/publication. |
| incomplete | Missing/interrupted/budget/layout/encoding/admission failure; no reusable closure root/sample. Charge usage; retain independently exact artifacts for preparation only. |

No authenticated base means no complete/equal. Missing required captured bytes is incomplete,
even after terminal metadata enumeration. Neither complete result installs credit itself.

| Concern | B3 | B4 |
| --- | --- | --- |
| Comparison | Complete bounded snapshot, absence, typed observations/result | Production reconciliation and closure |
| Clock | Acquisition hook and unchanged supplied sample | Suspend-safe provider/domain validity |
| Renewal/certificate | Supply complete input/root/fences/artifact identities | Authenticate/persist witness; bind verified generation and publication |
| Readiness/recovery | No bounded-as-of claim or request-side scan | Age/final/resume, expiry/fallback, durable recovery/audit/GC; cannot bypass restore gate |

This preserves P:164–219,758–763,1769–1770. Scalar observation timing at
`core/context-product-index.mjs:172–189` is not a coverage witness. Preserve captured E after E+1.

## Integration and acceptance

Register metrics through `core/context-product-attribution.mjs:2–7` and transport through
sidecar/index/Worker/reader/pump; preserve the charged transaction getter and reservation rules.
Capture incompletion is not disposal proof. The separately gated cutoff implementation
`f4077b62:core/context-product-reader.mjs:20–50,172–176,301–306` retains drain/writer-release
and full-reservation rules. Reopened Workers restart partial comparison, never redate a witness.
Regenerate runtime artifacts/import closure and independently cross-check archive/manifests
when implementing (`core/test/context-read-product-artifact.test.mjs:33–71`;
`packages/setup/build-runtime.mjs:79–100`); no artifact/code changes in this docs-only delta.

| Required regression | Boundary/source |
| --- | --- |
| Delete without epoch; eligibility without revision | P:670,674,1535–1544,1687–1689: ready/partial work, gaps/tail, denied-to-allowed and changed facts with equal decision bits. |
| Fence-only and legacy migration | P:676: each family; `null` to non-null forces recapture/new binding, never equal renewal. |
| Stored-byte fences | P-fence-bytes: NOCASE session column/BINARY primary key, one-row pages over `Z,z`; BINARY pagination must include both. NUL-suffixed keys must remain distinct via valid encoding or yield incomplete. Delete the formerly skipped key without an epoch change. |
| Preflight/resource exhaustion | P:748–756,1687–1689: all variable-length fields and encoding expansion, observable units, cumulative debt, row/byte/time/Raw/lineage limits; nothing materialized past allowance. |
| Plain output/envelope bounds | P-output; `core/database.mjs:276–295,328–330`: successful strings, Buffer rejection, bounded binary encoding; frame/chunk count, envelope node/byte and aggregate limits independently exhaust. |
| Restore/legacy admission | P:869–889: every stage/layout denies direct service from pre-forget backup; comparison/rebuild/B4 cannot bypass. Failed layout attestation is incomplete; legacy capability `none` is the explicit B policy choice. |
| Matching facts and Memory-only scope | Agreed interface: insert different matching fact with same reason; matching stamp changes. No per-receipt Memory observation; read-time S1 receipt checks remain. |
| Matching-set collision | Agreed interface amendment: equal count and maximum epoch, different matched fact sets must compare different; safety also tests different digests. Missing required digest is incomplete. |
| Ancestry with identical matched facts | Agreed interface amendment: mutate Raw ancestry while preserving the matched fact set; compare equal only when all other equality inputs, including the owner fence, are equal. |
| No mixed snapshot/renewal | P:1661–1667,1687–1689: insert behind cursor, partial scans, newer bodies, capture/sample separation. |
| Captured-E equivalence/provenance/recovery | P:1539–1558,1671–1680: independent frozen-E oracle, immutable old E, former contributors for path C, exact-artifact restart, tampered manifest and lost-commit outcomes. |

A later commit after coherent capture is E+1, not alone an abort condition. Native-clock
qualification remains B4-owned (P:1664–1689). **Hypothesis:** operational feasibility requires
charged real-shape/safety/DELETE campaigns (P:696–734,1439–1448), not isolated probes.

## Estimate and implementation gate

Planning worksheet P-planning-arithmetic from revision 1, using P:1734–1739's accounting:

| Incremental B3 work | Added/changed lines |
| --- | ---: |
| Comparator | 240–320 |
| Sidecar integration | 160–220 |
| Budgets and telemetry | 80–130 |
| Tests and independent oracle | 250–350 |
| Handoff and packaging | 70–80 |
| Total | **800–1,100** |

This replaces P:1769's **500–900**; allocation is planning judgment, not a measured count.
Excludes safety implementation, B4 storage/certificates/clocks/readiness, conditional delta
work and generated binaries. **Hypothesis:** new guards fit those allocations; revise the
estimate if implementation evidence disagrees. Review this delta and verify delivery of
the agreed interfaces and B4 storage/activation contract before code; prioritize path B.
