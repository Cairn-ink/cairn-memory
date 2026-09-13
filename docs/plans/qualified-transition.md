# Trusted-manual qualified transitions (S2a)

Fixed base: `ddd4468db6dbf1fc625073548a34ade9129705f6`.
Private dependent candidate: inherited security disclosure hold remains in force.
This is package 2's trusted-manual boundary, not automatic semantic qualification.

## Contract

`bindQualifiedClaim({namespace,memoryId,expectedRevision,slotId,singleClaim})`
requires every key, no extras. `singleClaim` must be true. `slotId:null` creates
a server-generated opaque slot identity; a string joins an existing slot in the
exact namespace. Only current, source-valid qualified memories are bindable.
All four stored slot fields must be known; joining requires exact equality with
the stored immutable descriptor. The trusted local caller explicitly attests
that the memory contains one claim and belongs to that slot. These are NOT
model/schema-derived proofs of identity or semantic atomicity. Bindings cannot
be overwritten. Repeating a matching binding returns its existing slot ID;
repeating null after an existing binding does not create another slot.

`transitionQualified({namespace,predecessor:{memoryId,expectedRevision},
replacement:{memoryId,expectedRevision}})` references two already-admitted
records; it accepts no replacement labels, slot overrides or model verdicts.
Validate both revisions and identities inside the shared transaction. Success
retires the predecessor using the existing supersession engine, retaining its
history and qualification. No new admission, second memory engine or model call.
Return a bounded outcome with status applied/unresolved, reason (null on success),
retiredCount 1/0, and indexRevision; successful output identifies both records.

## Acceptance

- T1: strict local-only input parsing, exact namespace/revision boundaries;
  no MCP/HTTP/model/capture allowlist widening. Same-record and stale/foreign/
  missing/historical references are hard errors with zero mutation.
- T2: atomic v10→v11 migration for bounded STRICT slot and membership tables.
  Server-generated slot IDs; immutable membership binds original qualification
  revision/content digest. No legacy backfill. Existing older migrations remain
  supported; v10 fixture from unmodified base, collision/lock rollback and cold
  reopen are tested. No qualification plaintext duplication beyond descriptor.
- T3: correction/forget clear memberships through qualification lifecycle; remove
  empty slots so forgotten descriptors do not remain in live tables. Filing and
  non-content revision changes preserve valid bindings; no silent reassignment.
- T4: apply only with both valid bindings sharing the same stored slot identity,
  all four known/equal descriptor fields, direct/adopted qualifications, different
  known values, user-role authoritative anchors covering both commitments and
  replacement value. Existing anchors/digests must be revalidated. Equal text
  alone, assistant suggestions and missing evidence cannot establish support.
  If the same slot has any additional current, nondeleted bound member outside
  the requested pair, return `additional_current_claims` unresolved. A pairwise
  operation must not report a clean replacement while an unreferenced current
  reaffirmation survives, or silently retire records without revision guards.
  Historical and deleted members do not trigger this gate. Test the three-member
  old/reaffirmed-old/new counterexample explicitly; broader multi-claim resolution
  is not implemented in this slice.
- T5: semantic preconditions not met return unresolved with a finite reason and
  no stored mutation; both pre-admitted sources remain visible. Corrupt/missing
  bound sources or storage integrity failures are storage_error, not unresolved.
  Failure after any retirement write rolls the entire transition back.
- T6: fence the common retirement seam whenever either record is qualified.
  Only the privately validated transition path can cross this fence. Existing
  direct supersede and ordered capture cannot bypass it. Unqualified-to-
  unqualified legacy retirement is unchanged and explicitly NOT protected.
  Never silently fall back from a failed qualified transition to legacy retire.
- T7: paired positive/negative actual-SQLite tests, including changed value,
  subject/scope/slot mismatch, unknown fields, same-value reaffirmation,
  proposed/considered/quoted assertions, assistant-only anchors, stale/corrupt
  source, immutable binding, suppression/history, replay, full cold reopen and
  cross-namespace attempts. Valid updates must work; always abstaining fails.
  Test the shared retirement fence on direct and ordered call paths.
- T8: document trusted-manual boundary, unresolved outcomes and remaining
  automatic identity/atomicity/adoption, rationale and premise gaps. Update
  changelog, storage/protocol docs and explicit artifact allowlist. Installed
  core probe must bind, transition, reopen and inspect retained history.
- T9: both Node22.16/24 generic/JSON/plugin, full core, relevant store/admission/
  capture/conflict/history/MOC/rebuild/recall/continuation demos, OpenAI/MCP offline
  and artifact gates. Root verification and independent Standards/Spec review of
  the frozen commit before private delivery. No paid calls in this slice.

No broad semantic reliability claim follows from trusted handcrafted bindings.
Automatic qualification and safe capture integration require the next package.

## Local verification record

Root reran the frozen runtime and tests on Node 22.16.0 and 24.15.0 after adding
the three-current-claim counterexample guard. On each runtime: `npm test` 31,
`npm run test:core` 394, `npm run test:openai` 152, `npm run test:mcp` 25 and
`npm run test:artifact` 17 passed. `npm run test:live-evidence-offline` passed 61
and skipped 27; those skips are not passes. JSON/plugin validation and the
store, admission, MOC, capture, conflicts, history, rebuild, recall, continuation
and OpenAI-offline demos all exited 0. The independent new focused suite has
43 passing cases, included in the full core count. All execution was synthetic
and offline with respect to model services. No provider key or paid run was used.

This is local verification, not private-fork CI or a model-quality score.
Independent Standards/Spec review of the frozen candidate is a separate gate;
the inherited private disclosure hold is not cleared by passing these tests.
