# Opt-in indexed evidence capture

The embedded JavaScript core can explicitly select an extraction-only lane:

```js
const core = openMemoryCore({ path, model,
  captureSourcePolicy: 'indexed-evidence-v1' });
```

Omit `captureQualification`, `captureEvidence` and `captureRationale` entirely;
even own explicit-undefined values are invalid. This policy rejects any own
`causal` field on capture, including undefined, before admission or model work.
There is no new default, MCP/Hermes flag, benchmark mode or silent fallback from
failed qualification. Inherited source policies do not opt in. In this explicit
lane, inherited enrichment settings are ignored, never activated.

The same [canonical indexed windows](retained-source-windows.md), extractor
prompt and wire are reused. Core normalizes and redacts up to 24 submitted
messages, with 4,000 UTF-16 units/message and 20,000/batch. At most 64
surrogate-safe windows of 800 units are visible. Extraction selects at most five
items with one to four distinct exact receipts each. The model selects indices;
core supplies identity, roles and excerpt bytes. Selected source binding is not
truth, entailment, adoption, execution authority or a complete transcript archive.
Submitted roles are not authenticated human identities.

Extraction is followed by atomic admission and the existing initial
classification. This lane never accesses qualification, reconciliation,
relation or decision-basis methods. Invalid extraction admits none of the batch.
Classification failure is a separate post-admission outcome: saved evidence can
remain unfiled. Two incompatible dated choices may remain current records;
"current" is a storage lifecycle state, not verified current applicability.

Successful results, including processing/duplicate responses, add
`qualificationStatus: 'not-requested'` and the existing `sourceWindowCatalog`.
This describes the requested interpretation, not semantic correctness or the
absence of prior qualifications. A deduplicated existing memory can retain its
separate qualification; immutable qualification/dedup rules are unchanged.
Failing envelopes carry no success metadata. The full normalized input and new
policy bind the replay digest; changing either at the same event conflicts.
Warm/cold duplicates do not rerun models, restore corrected content or resurrect
forgotten memories. Existing namespace, suppression, lease and deadline fences
remain. Forgetting is logical deletion, not erasure of SQLite/WAL/backups.

Use `fetch` or `recall` with `contextMode: 'source-evidence'` to inspect exact
retained receipts without generated summaries or qualification descriptions.
Missing qualification is the existing null representation on qualified
inspection, not an assertion of support. Source selection and semantic coverage
remain unassessed; retrieval, extraction and classification can fail or omit
needed evidence. Semantic recall still requires its configured model. The
bounded keyless `sourceSnapshot` reads only the complete small current-admitted
set, not staged, forgotten or historical sources.

Synthetic actual-core and installed-archive tests use the actual OpenAI adapter
with fake HTTP. They verify tail retention, cold reads, request-stage separation
and strict qualified/invalid-output controls, not real-model quality, host
integration, causal improvement, matched competitor performance or a score.
The frozen official six v3 and earlier consumed cases are unchanged. An old
grant cannot authorize this lane: any paid comparison needs separate versioned
integration, fresh source-only selection, resource bounds and acceptance.
