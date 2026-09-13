# Bounded claim qualification storage (S1)

Fixed base: `3512719a3c43c14354f76c31064d8d62666e97bf`.
Implements package 1 of [the update plan](source-backed-update-contract.md),
not automatic qualification or safer automatic retirement. Offline only.

## Frozen input and inspection contract

`admit` accepts optional top-level `qualification`; each `finishAdmission.items[]`
accepts the same optional member. Absence preserves existing behavior. Explicit
null is invalid. No capture, extraction/model, legacy-store, HTTP or MCP input
allowlist is widened. A trusted local caller supplies this metadata; the core
checks source binding, not the truth of that caller's interpretation.

Qualification is exactly:

```
{ version: 1,
  slot: { subject, property, scope, applies },
  value, attribution, commitment,
  anchors: [{ receiptIndex, start, end, text, fields }] }
```

- All listed keys required; reject extras, sparse arrays and wrong types.
- Subject/property/value: null (unknown) or 1–160 UTF-16 units. Scope/applies:
  null or 1–120 units. Text must already equal the existing boundedText canonical
  normalization/redaction result; reject secret-bearing/noncanonical labels
  rather than silently changing the qualification. No free-form identifier or
  namespace/role/revision field is accepted.
- Every qualification string and the content/receipts of a qualified admission
  must be well-formed Unicode: reject unpaired surrogates before writes. Existing
  unqualified paths retain their compatibility behavior. Validate the actual
  persisted content/receipts as well, so SQLite text conversion cannot silently
  change a supposedly exact source binding.
- Attribution: direct|reported|quoted|proposed|unknown. Commitment:
  adopted|considered|rejected|unknown. These are unverified descriptions, not
  permissions or confidence scores. Shape describes one claimed assertion;
  it does not prove the memory is semantically atomic.
- Anchors: 1–4; each selects one of this item's 1–4 normalized stored receipts
  by zero-based receiptIndex. start/end are safe integers with 0<=start<end;
  offsets are UTF-16 units into the canonical stored excerpt, never raw text.
  Neither boundary may split a surrogate pair. text is exactly that slice,
  1–200 UTF-16 units, and is not independently transformed.
- fields: 1–7 distinct names from subject/property/scope/applies/value/
  attribution/commitment. Every nonnull text field and nonunknown enum must be
  covered by at least one anchor. Multiple fields may share one passage.
  This provides inspectable attribution of labels, not proof of entailment.
- Reject duplicate anchors (same receipt/start/end/fields, field order ignored).
  Receipt IDs/digests and binding revisions are server-derived, never inputs.

`get` accepts optional `includeQualification` boolean. Absent/false preserves its
exact old response and cursor binding. True adds `qualification: null` for legacy
or cleared data, otherwise the bounded DTO above with `boundRevision` and
`contentDigest`, and anchors using `receiptId`, `receiptDigest`, `start`, `end`,
`text`, `fields` instead of receiptIndex. Text is reconstructed from the current
authoritative receipt, not duplicated in qualification storage. The flag does
not change receipt pagination; each qualified page can return the same bounded
qualification and its anchors, including anchors outside that receipt page.
The flag does not enter an existing cursor binding because row traversal is
unchanged; callers may toggle it. No list/fetch/recall/model/MCP output changes.

## Acceptance

- S1: source validation precedes writes and resolves anchors against attached
  authoritative receipts inside the existing transaction. Exact namespace,
  receipt ownership and role come from the same stored record. No external I/O.
- S2: persist at most one immutable qualification per memory, using bounded
  STRICT qualification/anchor tables in an atomic v9→v10 migration. Keep normal
  foreign-key protection; no legacy backfill, schema downgrade or private engine.
  Bind exact UTF-8 SHA256 of admitted content and receipt excerpts (not the
  case-insensitive dedup fingerprint), plus original admission memory revision.
- S3: dedup without incoming qualification may add receipts/change non-content
  revision as before, retaining existing qualification. With qualification,
  allow only exact existing qualification and authoritative anchor equality;
  differing metadata, content spelling, new bindings, or legacy unqualified
  targets reject atomically with qualification_conflict. Do not silently attach,
  overwrite or merge qualifications. Same-event claim replay remains unchanged.
- S4: correction and forgetting clear qualification and anchors within their
  transaction, including legacy facade and same-content correction. Suppressed
  replay cannot restore them. Mere filing, additional receipts and explicit
  supersession retain the original binding; a later revision alone does not
  relabel a still-identical claim. Historical qualification remains inspectable
  until correction/forget boundaries apply. No changes to retirement judgments.
- S5: opt-in inspection validates content and every receipt anchor/digest; stale,
  missing, corrupted or foreign evidence returns storage_error, not a purported
  valid qualification. Missing qualification is null. Never forge receipt
  revision: receipts have no independent revision in the existing store.
- S6: test explicit and inferred atomic admission, exact dedup, conflicting
  qualification, unqualified legacy, full claim replay, transaction failure after
  partial work, namespace isolation, source forgery, fields/array/text bounds,
  Unicode boundaries and unpaired surrogates, normalization/redaction, suppression, correction, filing,
  history and full close/reopen. A rejected batch leaves no partial qualification,
  receipts, memory, index mutation or completed claim. Existing lease/replay
  semantics must not be weakened to make this feature work.
- S7: migrate a frozen v9 synthetic fixture from the unmodified base, preserve
  every old record/receipt/identity/cursor/replay/index, verify v10 reopen, test
  DDL-collision rollback and writer-lock failure. Preserve supported older
  migrations and reject unsupported databases. Existing migration test version
  assertions may advance to10, but baseline fixtures/evidence remain unchanged.
- S8: extend public-core storage documentation and the protocol trust-boundary
  discussion for these newly captured local fields. Qualifications may contain
  personal text and are untrusted memory content, not instruction/authority.
  No new telemetry, automatic capture, provider transmission or MCP exposure.
  Update changelog and explicit artifact allowlist for every new runtime module.
- S9: dual Node22.16/24 generic/JSON/plugin, complete core, store/MOC/capture/
  conflict/history/rebuild/recall/continuation demos, OpenAI/MCP offline and
  installed artifact gates. Include actual installed core qualification lifecycle
  with synthetic sources. Independent Standards and Spec review final commit.

This package establishes bounded provenance storage. Slot identity resolution,
semantic atomicity, adoption accuracy, automatic qualification, safe transition
enforcement, premise dependencies and rationale QA remain separate failed/open
gates. It cannot be marketed as repairing the retained update-quality failures.
