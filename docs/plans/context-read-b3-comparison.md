# Complete canonical comparison delta, revision 1

Status: proposed for review; design only. No B3 implementation is authorized by this draft.
Evidence baseline: main `c1019314`; S1 `pr/504` at `f17f0d96`; cutoff at `f4077b62`.
These are inspected Git revisions, not runtime qualification results.
In this document, **P** means `docs/plans/context-read-incremental-catchup.md`.
Main citations use the evidence baseline; `pr/504:` citations explicitly use S1.
Revision 1 defines the rules below; the safety-prerequisite decision remains pending.

## Amendment boundary and unresolved conflicts

This is a separate delta, following `docs/plans/context-read-maintenance-cutoff.md:3–5`.
It does not edit P, change canonical safety storage, or select a conditional delta engine.

| Text amended or superseded on approval | Replacement and evidence |
| --- | --- |
| P §3.1, lines 647–665: intent policy and comparison inputs | Intent follows the safety-owned policy below; complete observations replace Boolean-only equality. Main maps metadata to eligibility at `core/context-product-sidecar.mjs:360–385`. |
| P §3.1, lines 655 and 676: unspecified fence payload | The explicit scope below applies even with an empty document delta; current fence construction is `core/context-product-sidecar.mjs:98–105`. |
| P §3.2, lines 738–763: capture budgets and comparison output | The bounded snapshot, manifest and result rules below make these requirements concrete; no completeness or no-stitching rule is weakened. |
| P §9, lines 1759–1769: complete B3S prerequisite | Replace the blanket package prerequisite only after the coordinating owner selects a capability option below. Until then this conflict is unresolved. |
| P §9, lines 1769–1770: B3/B4 responsibility and B3 estimate | The handoff table and estimate below apply; B4 retains durable closure, certificate/witness installation and bounded-as-of readiness. |

**History conflict:** P:244–250 and P:652–654 require current Card eligibility for history.
The S1 amendments at `pr/504:docs/plans/context-read-incremental-catchup.md:246–258`
and `:661–671` differ. The intent rule below adopts those revised clauses.
**Prerequisite conflict:** compare P:1759–1769's complete-B3S requirement with the project
owner's later scope decision, summarized below. This draft records options, not an inferred
authorization.
**Format/staging conflict:** P:1333–1344 requires new-format records, while P:1774 assigns
cutover later. B3's in-memory output below grants no permission to reinterpret existing
certificates; production credit stays disabled until B4's reviewed storage/activation path exists.

## Intent rule

Project-owner intent policy, as adopted by the S1 amendments cited below:

- A **superseded** Memory (not a corrected one) is readable in history mode and marked as history.
- A Card in history mode does not require that it still holds now.
- Current mode is unchanged.
- Forgotten, deleted, purged, privacy-erased or unauthorized content, and **pre-correction
  text**, never appears in any mode.

B3 evaluates every selected Card under the requested intent, including previously denied
Cards and unchanged revisions. It never forces `intent:'current'` for history and never
selects draft inspection, confirmed review or another authoring purpose.
The safety track owns retrieval policy and any historical labels; B3 records its observations.
Common safety checks apply under both intents; the current-only eligibility distinction is
the S1 text at `pr/504:docs/plans/context-read-incremental-catchup.md:246–258,661–671`.
S1 dispatch/policy evidence: `pr/504:core/content-safety.mjs:17–30,186–201`.

## Safety prerequisite: decision for the coordinating owner

Project-owner scope decision, summarized: the complete-safety package (B3S) is delivered first
in a minimal form; the external erasure ledger and recovery inspection are deferred; and the
conditional packages B2, B5 and B6 are decided after the final architecture gate.

The following are capability options, not assertions that any named branch has delivered
the requested interface. Capability/observation revisions must be attested for the selected scope.

| Option | What B3 can establish | Closure/renewal credit and fail-closed boundary |
| --- | --- | --- |
| A — S1 shared predicate only | Complete metadata scans and live decision observations for preparation/diagnostics. S1 returns decisions and enumerates surviving bindings: `pr/504:core/content-safety.mjs:87–98,160–201`. | No complete safety-backed closure or renewal claim; Boolean equality is insufficient. Missing suppression identities and durable lineage remain missing capabilities; never convert them to equal fingerprints or an eligible projection. |
| B — S1 plus S2h suppression identities | Compare stable identities and complete suppression observations where attested. A selection explicitly restricted to Memory can become credit-eligible once all applicable observation fields exist. | Card-containing selections remain preparation-only without S2c commitments. **Hypothesis:** equal live-binding/suppression observations can miss changed former-source lineage. Missing required facts make comparison incomplete; no implicit type downgrade. |
| C — S1, S2h and S2c lineage commitments | Compare the complete selected input set, including durable per-body provenance and live support/ancestor observations, through the interface below. | Credit-eligible evidence requires complete bounded capture and the full interface; Boolean-only adapters still fail closed. Unknown lineage is a complete denial only when safety returns a complete comparable denial; interruption is incomplete. B4 must validate/install any credit. |

**Hypothesis:** comparing only the allow/deny bit would falsely equate changed support,
provenance or suppression state when that bit stays equal; the missing fields are visible in
`pr/504:core/content-safety.mjs:10,87–98,160–201` versus P:650–654,415–426.
**Recommendation — decision for the coordinating owner, not selected:** require C for
Card-containing selections; permit B only for explicitly Memory-only selections with the
complete applicable interface; keep A preparation-only. Record the chosen scope and capability
revision before implementation. Neither this recommendation nor a package label grants credit.

## Interface request to the safety track

Provide a synchronous, content-free comparison observation inside the caller's existing
canonical read transaction. Field/function names remain safety-owned. B3 implements no
lineage reconstruction, suppression, authoring policy or safety migration.
The interface returns comparable facts for every selected item, including denied items;
it must not hide revisions or provenance changes merely because eligibility is unchanged.

| Required observation family | S1 already supplies | Requested ownership beyond S1 |
| --- | --- | --- |
| Stable owner/namespace/type/item identity, incarnation, exact revision/body version and capability/policy revision | Namespace and exact-ref checks: `pr/504:core/content-safety.mjs:163–175`. | S2h supplies durable identity/suppression scope; S2c supplies body/provenance identities. |
| Provenance header state, body commitment, provenance revision and sorted monotone contributor/ancestor-set commitment | Surviving bindings only, explicitly temporary: `pr/504:core/content-safety.mjs:87–98`. | S2c supplies authoritative commitments surviving binding/child deletion; never reconstruct them in B3. |
| Live support identities/versions/content commitments, existence, and applicable suppression facts with scoped reasons/revisions | Live receipt/note/Raw checks: `pr/504:core/content-safety.mjs:102–155`; internal reasons at `:9–13`. | S2h supplies durable denial/identity facts; S2c binds the complete ancestor set. Return no source text. |
| Applicability identity and dependency declaration/context/vector plus exact consulted method bindings, absent slots, lifecycle and manifest commitments | Current callback bridge: `pr/504:core/context-read-sidecar.mjs:667–675`; comparator `core/card-current-storage.mjs:27–62,84–90`. | Safety-owned richer adapter, consumed by B3; S2h/S2c integration must preserve the S1 policy. |
| Complete allowed or complete denied observation, distinct from interrupted/unsupported/budget-exhausted observation | Typed decision only: `pr/504:core/content-safety.mjs:10–13,160–201`. | Safety adapter supplies explicit completeness and policy-required comparable fields; missing capability never means a complete denial. |
| Shared resource account and snapshot-local memo through a transaction-aware charged reader | Memo: `pr/504:core/content-safety.mjs:33–40`; transaction getter: `pr/504:core/context-product-sidecar.mjs:362–365`. | S2h/S2c observations accept the same account/check/memo; the Card bridge must transport them rather than allocate independent aggregate allowances. |
| Capability-tagged fence payload and requested retrieval intent | Current-only policy distinction: `pr/504:core/content-safety.mjs:25–28,200`; live session fence checks: `pr/504:core/raw-source-roots.mjs:21–28`. | Safety supplies its scoped suppression/provenance fence facts; B3 captures the Raw/method scope below without defining safety policy. |

A complete denial must carry the facts required by the safety policy to compare that denial.
Policy-irrelevant fields use a tagged not-applicable value, not a fabricated successful check.
Budget exhaustion or unavailable required evidence never becomes `eligible:false` with full
comparison credit. Memo reuse ends with the canonical snapshot; no cross-attempt cache of
allow decisions or missing-source results. Preserve `isTransaction`; all native reads remain charged.
The adapter may read bounded source evidence internally; its returned observations contain no
title/body/excerpt, plaintext source, provider credential or public denial reason.

## Aggregate capture budget and snapshot boundary

The public input remains `maxItems,maxMs` (`core/context-read-input.mjs:189–190`).
`maxItems` limits transformation attempts, not metadata rows. This delta adds private
aggregate capture limits, not public knobs or a larger authorized time allowance.
The following are planning policy choices for this revision, not measured feasibility bounds:

- Row limit: **131,072** native row visits per comparison attempt, including base-map loading,
  canonical metadata, safety/support/dependency/fence reads and captured-byte reads.
  Derivation: supported item ceiling **1,024** × metadata batch **128**;
  sources `core/context-read-input.mjs:190`, `core/context-product-sidecar.mjs:686`,
  planning arithmetic probe P-planning-arithmetic. The cap is independent of actual `maxItems`.
- Byte limit: **32 MiB / 33,554,432 bytes** of aggregate materialized capture traffic per attempt.
  This delta deliberately adopts P:1442's captured-byte ceiling for an additional traffic
  limit; it does not claim that the original debt limit already covered scan traffic.
  Count UTF-8 encoded metadata/observation/manifest payloads and actual binary/source bytes.
  Charge repeated native results again; memo hits require time checks but no native-row charge.
  Count an empty scalar lookup as a row visit; bound enumeration before materializing an excess.
- Live retained base-map/chunk/source/body payloads share the same byte ceiling as a working-set
  limit; this measures payload bytes, not JavaScript heap overhead. Also enforce P:1442's
  owner/intent captured-unprocessed-byte and pending-replacement-identity limits across existing
  work plus this capture. Unchanged metadata identities are not pending logical replacements.
  Release aborted observations; no spill or hidden queue bypasses limits. Base loading and chunk
  construction consume budget. Bound row iteration and preflight variable-length body/blob reads;
  an oversized record aborts rather than being truncated.
- Raw per-source limits remain **64,000 bytes / 1,024 rows**
  (`core/card-raw-sources.mjs:87,113–124`; `pr/504:core/content-safety.mjs:196`).
  Each source must fit its own allowance and the remaining aggregate allowance; per-source
  resets never reset the aggregate account. Shared-memo native work is charged where executed.
- Time/lock limit: use `min(operationCutoff,refreshStart+maxMs)` and the existing quantum
  reserve/admission formula (`core/context-product-sidecar.mjs:866–870`;
  `core/context-product-quantum.mjs:3–10`). Finish capture before cutoff minus that reserve.
  Check before/after each bounded statement and observation; acquisition/wait time is included.
  Record canonical lock-hold duration and actual DELETE writer interference separately.
  A native-call overrun earns no complete result; retain parent cutoff/disposal enforcement.

Every admitted catch-up comparison, including apparent ready/no-op work, enumerates completely
regardless of scalar equality (P:647–665); ordinary read/status requests remain scan-free (P:763).
Load the immutable authenticated base/work map before acquiring the canonical snapshot.
Sample the supplied coverage clock immediately before acquisition, then use the attributed
canonical-read seam (`core/context-product-sidecar.mjs:115–118`) for the entire capture.
All metadata pages, unconditional per-intent Card evaluation, lineage and fences share that
snapshot; helpers do not open nested transactions. No canonical transaction spans sidecar
COMMIT, provider await or another quantum.
The existing per-page merge remains preparation only (`core/context-product-sidecar.mjs:684–688`).
A failed/exhausted capture aborts and retries from the beginning: **never stitch snapshots**.
Retain independently sealed exact artifacts, not a partial closure cursor or freshness sample.
Validate prepared content/provenance identities in capture, or capture required changed bytes
there; never fetch newer bodies afterward and label them E (P:742–763).
**Hypothesis:** these planning limits admit the required real shapes; this must be measured
with actual safety/lineage, support and DELETE interference, not inferred from P:678–734.
If they do not, report capture-budget failure; only B4 applies expiry/fallback, without widening X.

## Fence payload and selection scope

The complete-input manifest binds the following content-free fence records in the same snapshot.
Each optional family has an attested present/absent/not-applicable tag; a required table missing
from a claimed layout makes the comparison incomplete. Missing epoch rows remain distinguishable
from present rows. Scalar epochs alone never prove equality.

- Namespace: selected namespace identity, Memory epoch and selected Card epoch, preserving
  the existing scope at `core/context-product-sidecar.mjs:98–105`.
- Raw: for every selected namespace with an attested Raw capability, including Memory-only
  selections, bind the exclusion-clock row; the complete ordered session-fence keys;
  conversation identity/revision pairs; and complete exclusion tuples scoped through their
  parent conversation. Commit table-presence tags, row counts and ordered tuple digests.
  Physical sources: `core/raw-schema.mjs:18–21,28–34`,
  `core/raw-lineage-schema.mjs:22–29`. Raw ancestry/support commitments remain safety-owned
  item observations; this aggregate payload is not a substitute for them.
- Methods: for Card selections, bind dependency-table capability, declaration presence for
  every selected namespace and method-epoch rows across the entire selected readSet, for
  both intents, even where declarations are absent. This explicitly expands the conditional
  comparison-fence behavior at `core/card-current-storage.mjs:15–17`; it does not alter
  history eligibility or legacy request-fence APIs. Memory-only selections tag methods
  not-applicable. Dependencies outside the authorized readSet cannot expand the capture scope.
  A layout without method capability records an absent-capability tag and queries no missing table.
- Safety: bind the selected capability revision and safety-owned scoped suppression/provenance
  fence observations. Do not derive safety fences from current bindings or generic epochs.

Stream large fence families through the capture account; do not build an unbounded array.
A changed fence means complete/different even with identical document contributions.
B4 captures a new certificate binding for that empty document delta (P:655,676); it must not
renew an old certificate's witness as though complete inputs were equal.

## B3 input manifest and B4 consumption

B3 produces a private immutable in-memory sequence of bounded chunks and an envelope.
It creates no canonical discovery DDL/feed and adds no map or optional table to existing formats.
The existing `canonicalJson` envelope is bounded (`core/context-product-validation.mjs:6`;
`core/context-product-control.mjs:29–32`). Probe P-map-envelope against the evidence baseline
returned `invalid_input` for **1,642 / 3,336** synthetic records, at **118,779 / 242,441**
encoded bytes; exit **0**. Each record held identity, revision, bodyRevision and eligible.
These populations come from P:684–685; this is a serializer probe, not a timing result.
Do not put the complete map in `g.verify`, sign it as a single bounded object, or raise that limit.

The manifest encoding is a domain/version header followed by ordered canonical record frames
and a terminal frame. Frames are canonical JSON plus newline, individually within existing
serializer limits; chunks contain whole frames. Stream SHA-256 over the exact ordered bytes.
The domain is `context-read/b3-input-v1`, defined by this revision; no existing certificate
domain is reused. Bind store/canonical identity, normalized selection/types/intent/access,
capability/policy/resource-policy revision, every item tuple and every fence record.
Order item keys by namespace boundary, type and stored identity bytes, independently of Card
state streams; include all selected states and terminal population counts. Preserve B1's
byte-order and encoding checks (`core/context-product-sidecar.mjs:360–377,640–643`).
Item tuples contain revisions, raw states, eligibility and safety-owned identity/observation
commitments, including exact artifact content identities. No body/source text enters this map.
The root excludes comparison ID, base checkpoint and clock sample; those are envelope bindings,
not equality inputs. Absence is compared against the complete authenticated base map.

The envelope binds comparison identity, base/work seal, manifest root/counts/chunk order,
scope/capability and resource usage, plus the original pre-acquisition clock evidence.
Required captured bytes are separately owned immutable observations keyed by exact identity/digest.
No live SQLite cursor, writable alias or provider callback escapes. B3 owns these buffers until
B4 accepts ownership or they are released; incomplete capture cannot leave a hidden queue.
Only B4 persists them in its reviewed authenticated new-format storage, after canonical release.
B4 rechecks the named base/work seal before accepting the comparison; a changed or revoked
base is not an equal-comparison renewal candidate. A complete root alone is not authorization.
Lost volatile output requires recapture; only a durably authenticated complete B4 manifest can
survive restart, with its original capture identity/time (P:1291–1302,1314–1325,1333–1344).
Persistence does not validate a clock domain after restart; B4 applies P:191–210 unchanged.

| B3 result | Meaning and B4 consumption |
| --- | --- |
| complete/equal | All required inputs/fences equal the authenticated base manifest; full enumeration and required evidence succeeded. B4 may consider witness renewal for unchanged E after its capability/clock/certificate checks. |
| complete/different | Full enumeration, absence comparison and required changed-byte capture or exact-artifact validation succeeded. B4 reconciles/verifies that captured input set and may close/publish it with the original sample. |
| incomplete | Budget, capability, identity, evidence or capture failure; no reusable closure root/sample. Usage and independently exact artifacts remain available for accounting/preparation only. |

No authenticated base manifest means no complete/equal result. Missing required changed bytes
means incomplete, even if the metadata scan ended. Neither complete result installs credit by itself.

| Concern | B3 | B4 |
| --- | --- | --- |
| Comparison | Complete bounded snapshot, absence, exact inputs and typed result | Production reconciliation and closure using those inputs |
| Clock | Acquisition hook; preserve the supplied original sample | Actual suspend-safe provider, domain/incarnation attestation and validity |
| Renewal | Supply complete/equal candidate only | Authenticate and durably install witness for unchanged E |
| Certificate | Supply root, scope, provenance/fences and captured/artifact identities | Verify complete contributions; atomically bind certificate/publication |
| Readiness/recovery | No bounded-as-of readiness claim or request-side scan | Age/final/resume checks, expiry/fallback, durable recovery and audit/GC |

This freezes the split in P:164–219,758–763,1769–1770. Operational budget/cadence clocks are
not coverage clocks; `core/context-product-index.mjs:172–189` supplies scalar-observation timing,
not a complete-comparison witness. B4 must retain E even if canonical advances after capture.

## Integration and acceptance

Register new work/attribution fields through `core/context-product-attribution.mjs:2–7`
and transport them consistently through sidecar/index/Worker/reader/pump. Preserve S1's
transaction getter, the attributed canonical-read seam, and existing reservation/refund rules.
Capture incompletion is not disposal proof. The cutoff implementation at
`f4077b62:core/context-product-reader.mjs:20–50,172–176,301–306` remains separately gated;
preserve its full reservation and confirmed drain/writer-release rules.
A reopened Worker restarts partial comparison, never resumes its closure proof or redates a witness.
Regenerate installed artifacts when implementation changes runtime inputs; register any new module,
rederive import closure and cross-check archive inventories, including generated setup manifests
(`core/test/context-read-product-artifact.test.mjs:33–71`;
`packages/setup/build-runtime.mjs:79–100`). No installed artifact changes in this docs-only delta.

| Required acceptance | Source and assertion |
| --- | --- |
| Delete without epoch | P:670,1535–1544: ready and partial-work cases; gaps/tail absence, no scalar shortcut. |
| Eligibility without revision | P:674,1687–1689: denied-to-allowed and changed fingerprints with unchanged eligibility; both intents use safety-owned policy. |
| Fence-only | P:676: each scoped family changes the root/certificate binding with an empty contribution delta. |
| Capture-budget exhaustion | P:748–756,1687–1689: row/byte/time/Raw/lineage boundaries, cumulative retained debt, honest incompletion and charged aborted work. |
| No mixed-snapshot closure or renewal | P:1661–1667,1687–1689: insert behind cursor, mutations between preparation pages, partial scans, newer bodies, and clock/sample separation. |
| Safety prerequisites and provenance | P:672,1553–1558: each option's missing-capability refusal; removed bindings, forgotten former contributors, complete denials versus interrupted evidence. |
| Captured-E equivalence/recovery | P:1539–1544,1671–1680: independent frozen-E oracle, immutable old E, exact-artifact restart, tampered manifest rejection and lost commit outcomes. |

A commit after a coherent capture is E+1; tests must not require abort solely for that later
commit. B4's clock/native/restart qualification remains separate (P:1664–1689).
**Hypothesis:** the architecture fits operational bounds only after charged campaigns including
P:696–734,1439–1448; no scan microprobe or successful isolated comparison qualifies it.

## Revised estimate and review gate

Planning worksheet P-planning-arithmetic, not measured implementation size; allocations follow
the interfaces/acceptance above and P:1734–1739's implementation/test/handoff accounting:

| Incremental B3 work | Added/changed lines |
| --- | ---: |
| Comparator | 240–320 |
| Sidecar integration | 160–220 |
| Budgets and telemetry | 80–130 |
| Meaningful tests and independent oracle | 250–350 |
| Handoff and packaging | 70–80 |
| Total | **800–1,100** |

This replaces P:1769's **500–900** estimate for this scope. Excludes safety-track implementation,
B4 durable storage/certificates/clocks/readiness, conditional delta work and generated binary size.
**Hypothesis:** the original range is optimistic if observation/budget/handoff adapters require
extra work; the worksheet is a planning allocation, not a cap or delivery promise.
Before B3 code: review this versioned delta, record the pending capability decision, obtain
the safety-owned interface agreement, and freeze B4's storage/activation contract.
