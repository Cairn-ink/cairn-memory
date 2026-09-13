# Opt-in automatic source qualification (S3a)

Fixed base: `2b1f838ed70388eb2cc801ab707571d1b51d8990`.
Private dependent candidate; inherited security disclosure hold remains.
This follows independently verified complete trusted-manual transitions.

## Frozen boundary

Add optional constructor setting `captureQualification: 'source-bound-v1'` to
`openMemoryCore`. Absence preserves exact legacy capture behavior; other explicit
values reject before opening a database. Snapshot the setting at construction.
Do not widen the capture input DTO, MCP/HTTP inputs, or transcript retention.
The opted-in mode participates in a versioned capture payload digest, so replay
under another mode fails event_payload_conflict instead of silently pretending
a legacy event was qualified. Legacy digest bytes must remain unchanged.

After extraction constructs canonical receipts, make exactly one batch
`model.qualify` call for nonempty items. Empty extraction and completed replay
make no qualification call. The qualifier sees only
`{items:[{itemIndex,content,kind,sources:[{receiptIndex,role,excerpt}]}]}`:
zero-based item and local receipt positions, never namespace/client/session/event
IDs or full source messages. Excerpts are the exact redacted/canonical 800-unit
receipt text already selected for storage, not the original 4000-unit message.

Output is exactly `{qualifications:[{itemIndex,qualification}]}`, one entry for
every extracted item, unique item indices and no extras. Qualification is the
existing complete S1 DTO, nonnull; its unknown/null field values remain valid
and explicitly unverified. Validate each qualification against that item's
canonical receipts with the existing validator. No quote relocation, fuzzy
matching, source ID generation, metadata stripping or qualification backfill.
Attach only fully validated metadata before the existing atomic admission.

No automatic slot binding or singleClaim attestation is created. In enabled
ordered capture, skip the legacy reconcile model entirely: nonempty new items
produce a durable unresolved `qualification_requires_identity` outcome with zero
retirements, regardless of unknown labels, dedup or suppression. Empty items use
the existing no-change outcome. This is provenance production, NOT completed
automatic updating. Legacy mode remains explicitly unprotected.

## Acceptance

- Q1: strict constructor setting, immutable snapshot, mode-bound event digest,
  baseline byte/behavior compatibility and replay/lease safety. Reject malformed
  Unicode source messages before any model call in enabled mode. Reject malformed
  extracted/qualified content before admission; no namespace widening.
- Q2: exactly one bounded qualification batch, after extraction and before
  admission. Preserve existing 6000 local-input/1024 output-token and 30-second
  per-call limits; no per-item calls or lease renewal. Extract+qualify consumes
  at most two precommit model timeouts. Classification remains postcommit.
- Q3: enforce exact item coverage, local receipt indexing, source/field/UTF-16
  anchor validity and bounded personal labels. Any malformed later item, timeout,
  missing qualifier, overflow or qualification_conflict fails explicitly with
  no partial memories/receipts/qualifications. Existing content-free claim and
  fenced lease cleanup semantics remain; no silent unqualified fallback.
- Q4: enabled ordered capture stores/replays unresolved outcome and new evidence
  without calling reconcile or trusted binding/transition methods. Do not treat
  full schema validity, source substring presence or all-unknown metadata as
  proof of identity, adoption, atomicity, truth or execution authorization.
- Q5: adapter exposes dynamic-only `qualify` schema through existing exact
  count/generate framing. Use pinned DEFAULT_MODEL for this new method, independent
  of extraction profile. All fields required, nullable text where S1 allows;
  root object, additionalProperties:false and bounded request-scoped item/source
  index enums with core correlation checks. Keep old methods' request bytes and
  token budgets unchanged. Do NOT add qualify to static `schemas` paid allowlist
  or existing experiment-guard regex; unauthorized paid guards must still reject
  it before network. No paid request in this slice.
- Q6: finite content-free qualify diagnostics and invalid_qualification reason;
  new prompt/module enter artifact allowlist. Document the newly transmitted
  bounded item/receipt text, model interpretation status, retention limits,
  dedup conflicts, mode-specific replay and remaining automatic-update gates.
- Q7: actual SQLite and fake-HTTP tests cover ordinary/ordered positives,
  reordered sourceIndices [3,0], multilingual/NFKC/redaction/astral anchors,
  absent beyond-800 source evidence, forged/missing/duplicate/extra items,
  invalid later item atomicity, unknown fields/qualifications, timeout/overflow,
  mode replay conflict, completed replay, suppression/dedup and lease successor.
  Show no slot bindings created and no legacy retirement in enabled mode.
- Q8: installed core plus installed OpenAI adapter with fake transport captures
  source-qualified data, closes all handles/reopens, verifies exact stored
  qualification and no trusted binding. Include an ordered unresolved case.
  No registry publication, production data or real client certification.
- Q9: both Node22.16/24 contributor/JSON/plugin, full core, capture/store/admission/
  MOC/conflict/history/rebuild/recall/continuation demos, OpenAI/MCP offline,
  experiment-budget guard offline and installed-artifact gates; independent
  Standards/Spec review of the final frozen diff before next implementation.

## Official API reference

[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
requires an object root, required fields (nullable unions can represent unknown
values), and rejects additional unspecified properties in strict schemas.
Schema adherence is not semantic correctness. Our existing core source binding
and private retirement boundary remain authoritative; no model migration is
part of this proposal.

## Local verification

Root ran the final runtime and tests on Node 22.16.0 and 24.15.0. Each passed
generic 31, core 437, OpenAI 157, MCP 25, budget-ledger 15, request-guard 42
and installed-artifact 19 tests. The offline live-evidence suite passed 61
with 27 skipped (not 88 passes). JSON/plugin validation and all Q9 demos
exited 0. The new denial test is included in the ordinary request-guard command.
All model responses and databases were synthetic. No provider key, paid call,
public push, merge, publication or deployment was used. These are local
structural/lifecycle gates, not semantic accuracy or private-fork CI evidence.
