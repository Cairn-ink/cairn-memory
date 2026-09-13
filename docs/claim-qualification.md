# Bounded claim qualification storage

Trusted local callers may attach one qualification to a newly admitted memory.
This records their interpretation with exact source anchors. It does not establish
semantic truth, a shared subject identity, adoption, or safe retirement. The
opt-in [source-qualified capture mode](capture.md#opt-in-automatic-source-qualification)
also produces validated qualifications from model assertions. It never creates
trusted slot bindings, and it preserves ordered evidence as unresolved rather
than invoking legacy retirement. Default capture does not produce qualifications.

```js
const receipt = { client: 'synthetic', sessionId: 'session', eventId: 'event',
  role: 'user', excerpt: 'I prefer tea' };
const saved = core.admit({ namespace,
  memory: { content: 'I prefer tea', kind: 'preference' }, receipts: [receipt],
  qualification: { version: 1,
    slot: { subject: 'I', property: 'drink preference', scope: null, applies: null },
    value: 'tea', attribution: 'direct', commitment: 'adopted',
    anchors: [{ receiptIndex: 0, start: 0, end: 12, text: 'I prefer tea',
      fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] },
});
if (!saved.ok) throw new Error(saved.error.code);
const inspected = core.get({ namespace, memoryId: saved.value.memory.id,
  includeQualification: true });
```

The same optional `qualification` is accepted on each trusted
`finishAdmission.items[]`. The existing five-item, receipt, lease, replay and
suppression bounds still apply. Do not pass unvalidated model output to this
manual storage seam. Unknown keys and explicit `qualification:null` are invalid.

## Shape and source binding

All shown qualification and slot keys are required. Subject, property and value
are null (unknown) or 1–160 UTF-16 units; scope and applies are null or 1–120.
These labels must already equal the existing normalization/redaction result:
noncanonical or secret-bearing labels are rejected, not silently rewritten.
Qualification strings and qualified admission content/receipt strings must have
well-formed Unicode. Unpaired surrogates fail before writes; existing unqualified
paths keep their compatibility behavior.

`attribution` is `direct`, `reported`, `quoted`, `proposed` or `unknown`;
`commitment` is `adopted`, `considered`, `rejected` or `unknown`. These descriptions
are unverified memory content. The receipt author role is derived from storage;
it is distinct from the described claim subject. Null applicability is not
silently replaced with delivery time. A single DTO cannot prove semantic atomicity.

Each of 1–4 anchors selects one of this item's normalized receipts by zero-based
`receiptIndex`. Safe-integer `start/end` are UTF-16 offsets into its canonical
stored excerpt with `0 <= start < end`. Neither boundary may split a surrogate
pair. `text` is the exact 1–200-unit slice, without independent transformation.
Each anchor declares 1–7 distinct `fields` from subject/property/scope/applies/
value/attribution/commitment; their output order is canonical. Every nonnull label
and nonunknown enum needs coverage. Duplicate anchors for the same source/range/
field set are rejected, including repeated receipt inputs. Coverage and equality
prove inspectable binding only, not that the passage entails the description.

Within the existing admission transaction the core resolves actual attached
receipts, verifies their identity/key and exact content, and stores server-derived
receipt IDs, SHA256 digests of the UTF-8 excerpts, offsets and fields. Anchor text
is not copied into the qualification tables. The qualification also binds the
exact UTF-8 SHA256 of memory content and its original admission revision;
case-insensitive dedup fingerprints are not this binding. Receipts have no
independent revision and none is invented. A failure rolls back the complete
batch, including receipt attachment, epochs and admission completion.

## Immutable lifecycle and inspection

A qualified dedup succeeds only with identical stored qualification and resolved
anchors. Different labels, content spelling, new source bindings, or an existing
unqualified target fail `qualification_conflict`. Qualifications cannot be added
retroactively through dedup, merged, or overwritten by a later verdict. Dedup
without qualification retains existing qualifications while applying the normal
receipt and non-content revision rules. Same-event claim replay is unchanged.

Filing, extra receipts and explicit supersession preserve the original binding.
Correction (including same-content correction) and forgetting clear qualification
and anchors atomically through both core and legacy facades. Suppressed replay
cannot restore them. Historical qualification is inspectable until forgetting;
the existing prohibition on correcting historical records still applies.

Absent/false `get.includeQualification` preserves the exact existing response and
cursor binding. True adds `qualification:null` for legacy/cleared data, otherwise
the input DTO plus `boundRevision` and `contentDigest`. Anchors contain `receiptId`
and `receiptDigest` instead of `receiptIndex`, and reconstruct `text` from stored
receipts. Every source, key, digest, boundary and field is revalidated; missing,
foreign, stale or malformed evidence fails `storage_error`. Qualification can
repeat on each receipt page, including anchors outside that page. The flag may
be toggled on a receipt cursor because it does not alter traversal. List, fetch,
recall, model, HTTP and MCP inputs/outputs are unchanged.

## Migration, retention and limits

An atomic v9→v10 migration adds bounded STRICT qualification and anchor tables
with normal foreign keys. Supported older versions upgrade through their existing
migrations. No qualifications are backfilled and no old data is rewritten.
Older binaries cannot open v10; there is no downgrade tool. Close all connections
before upgrading meaningful data and retain a backup.

Labels may contain personal information. They are local untrusted content, never
instructions or authority. Digests and source links are not encryption. No new
telemetry or MCP exposure is introduced by manual qualification storage. The
separate opt-in automatic capture mode transmits bounded item/source text as
documented in [capture](capture.md#opt-in-automatic-source-qualification).
Correction/forget removes live qualification rows; database backups/journals and
secure-erasure limitations remain as documented in [local storage](local-store.md).

Tests use handcrafted synthetic qualifications and real temporary SQLite stores.
They establish bounded provenance storage and lifecycle safety, not repair of the
retained update-quality failures. Slot identity resolution, semantic atomicity,
adoption accuracy and qualified transition enforcement remain separate work.
See [acceptance](plans/claim-qualification-storage.md).
