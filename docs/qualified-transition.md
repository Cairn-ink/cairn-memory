# Trusted-manual qualified transitions

This local-core boundary enforces stored claim identity and source constraints;
it does not make automatic extraction or reconciliation semantically reliable.
The caller authenticates namespaces and explicitly attests identity and a
single-claim assertion. A model-generated label or `singleClaim` boolean does
not establish truth, semantic atomicity or adoption. Do not expose these methods
as unreviewed model tools. MCP, HTTP, capture and provider input schemas are
unchanged.

## Establish an immutable binding

```js
core.bindQualifiedClaim({ namespace, memoryId, expectedRevision,
  slotId: null, singleClaim: true });
```

Every field is required, extras are rejected. `slotId: null` creates an opaque
server-generated identity for the stored qualification's subject, property,
scope and applicability. All four fields must be known. To bind another
already-admitted qualified memory, pass that returned `slotId`, attesting that
it contains exactly one claim about the same slot. The descriptor must match
exactly and the slot must belong to the same namespace. Matching descriptors
alone never combine independently created slots.

The result is `{slotId, memory:{id,revision}, indexRevision}`. Binding advances
the namespace epoch, not the memory revision. A matching repeat (including
`slotId:null` after binding) is a no-op and returns the existing identity. A
different requested identity fails `qualification_conflict`; no overwrite is
available. Bindings retain the qualification's original content digest and
bound revision. Source validity is rechecked even for repeats.

## Apply or leave unresolved

```js
core.transitionQualified({ namespace,
  predecessor: { memoryId: oldId, expectedRevision: oldRevision },
  replacement: { memoryId: newId, expectedRevision: newRevision } });
```

Both memories must already exist, be current, have distinct IDs, and match the
expected revisions. The method accepts no new labels, slot overrides or model
verdict. Within one transaction it revalidates qualifications and bindings,
requires the same stored slot identity, direct/adopted assertions, different
known values, and authoritative user-role anchors covering both commitments
and the replacement value. Exact source anchors prove linkage, not entailment.

Success returns `{status:'applied', reason:null, retiredCount:1, previous:{id,
revision}, replacement:{id,revision}, indexRevision}`. Existing supersession
history, suppression, conflict invalidation and MOC invalidation all commit
atomically. The predecessor's qualification and binding remain historical.

Unsupported transitions return `{status:'unresolved', reason, retiredCount:0,
indexRevision}` with **no stored mutation**. Both already-admitted memories and
their sources remain available. Finite reasons are `qualification_missing`,
`binding_missing`, `slot_mismatch`, `value_unknown`, `same_value`,
`attribution_unsupported`, `commitment_unsupported`, and
`adoption_evidence_missing`, plus `additional_current_claims` when the slot has
another current, nondeleted bound member outside the requested pair. A two-record
transition never silently retires that unreferenced member or declares resolution
while leaving a competing current claim; historical/deleted members do not block.
This is not a claim that a semantic conflict was
detected or that the two statements are equally valid.

Missing/foreign references, historical records, same-record requests and stale
revisions are hard errors. Corrupt bindings or source evidence return
`storage_error`, not unresolved. Repeating a successful manual transition with
old references produces a revision/history error; no new durable manual replay
result is introduced. Existing ordered-capture event replay remains unchanged.

## Resolve a complete set of current claims

```js
core.transitionQualifiedSet({ namespace,
  predecessors: [
    { memoryId: oldId, expectedRevision: oldRevision },
    { memoryId: reaffirmedId, expectedRevision: reaffirmedRevision }
  ],
  replacement: { memoryId: newId, expectedRevision: newRevision } });
```

This separate local method accepts 1–5 distinct predecessors and one distinct
replacement, all already admitted, current and revision guarded. Every field is
required and extra keys are rejected. It uses the same stored-slot, source and
direct/adopted policy as the pair method; every predecessor must have a known
value different from the replacement. All referenced qualifications and bindings
are inspected before an ordinary unresolved result. Old claims may reaffirm one
value or have different values: choosing this complete set is the trusted
caller's explicit instruction, not automatically inferred chronology.

The references must cover every current, nondeleted bound member of the slot.
Omitting even a same-value reaffirmation returns `additional_current_claims`
without mutation. Historical/deleted members do not consume the input allowance.
Discovery returns at most seven rows (six permitted members plus a sentinel);
this does not bound historical rows SQLite may visit. Corrupt foreign current
membership among returned rows fails `storage_error`.

Success returns `{status:'applied',reason:null,retiredCount,previous:[{id,
revision}],replacement:{id,revision},indexRevision}`, with predecessors sorted by
ID. Existing incoming history edges plus new edges cannot exceed five;
`supersession_limit` fails before retirement begins. All retirements reuse the
same mutation seam in one transaction, including suppression, invalidation and
epoch changes. Any late failure rolls the whole set back. Unresolved and hard
errors have the same meaning as the pair operation; successful replay is not
idempotent and fails its revision/history guards. The pair API remains unchanged.

## Protected and unprotected paths

The shared retirement seam fences any qualified endpoint from legacy direct
`supersede` (`qualified_transition_required`). That operation rolls back its
replacement admission too. Ordered capture instead preserves newly admitted
evidence, abstains from the entire retirement set, and durably records an
unresolved `qualified_transition_required` outcome for event replay. It never
silently downgrades a qualified record to legacy retirement.

Unqualified-to-unqualified direct and automatic retirement retains its previous
behavior and is explicitly **not protected** by this boundary. Automated slot
identity, alias resolution, atomicity and adoption judgments remain later work.
Compound partial changes and unknown scope/applicability cannot be made safe
by inventing a one-claim attestation. Reasons, premise dependencies and then/now/
why answers are not implemented here.

## Retention and migration

SQLite v10 upgrades atomically to v11 with STRICT slot and membership tables,
without backfilling legacy records. Slot descriptors duplicate only the bounded
four-field descriptor, not memory bodies, receipt text or value. Memberships
carry opaque links and revision/digest metadata; these remain personal data.
Correction and forgetting remove memberships through qualification deletion;
a trigger removes each now-empty slot so forgotten descriptors do not remain
in live tables. Other live/historical members retain their shared descriptor.
Non-content changes retain bindings. Backup/journal and secure-erasure limits
in [local storage](local-store.md) still apply.

Synthetic real-SQLite and installed-core tests verify this trusted handcrafted
contract, not model accuracy or end-to-end user reliability. No paid calls are
part of this slice.
