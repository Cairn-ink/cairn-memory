# Opt-in staged capture evidence

Base: `8eb2d19c9cea57cc45706fdeafbc2fa5e4d46cd6`.
First delivery is embedded shared core, not a second engine or a new default.
MCP/host exposure follows only after this lifecycle is verified.

## Contract and acceptance

1. `openMemoryCore({path, model, captureQualification:'source-bound-v2',
   captureEvidence:'staged-v1'})` explicitly enables staging. Reject other
   values/combinations before opening a database; reject causal capture in this
   first mode before writes/model calls. Existing modes and legacy API behavior
   remain unchanged unless a persisted staged-event fence applies.
2. Validate and canonicalize using existing capture semantics. Atomically claim
   and save the bounded retainedSourceView before extraction/qualification. Save
   at most 24 messages,800 UTF-16 units each,existing normalization/redaction,
   including original message IDs/roles and truncation metadata. Do not store the
   larger pre-truncation input or model interpretations in the staging payload.
   Reject a serialized payload above128KiB. Per namespace, at most64 payloads
   and1MiB total payload bytes; overflow rejects atomically before provider calls.
3. Fixed retention is24hours from original claim, never renewed by replay/read.
   Persist a nondecreasing namespace clock watermark so observed expiration
   cannot reverse across restart/clock rollback. Explicit access/claim/mutation
   prunes expired payloads; no background worker or physical-erasure promise.
   Small content-free event fences may remain with the existing admission claims
   indefinitely; payload limits are not a total database-size bound.
4. Qualification/extraction failure retains the staged bounded source, marks
   failure with no raw exception/provider data, admits nothing and expires the
   ownership lease. Successful admission marks admitted; stage and admission
   outcome changes share the transaction. No staged content enters ordinary
   get/list/map/search/recall/rank or model work beyond existing capture input.
5. Public embedded `inspectCaptureEvidence({namespace,client,eventId})` returns
   `{evidence:null}` when absent, otherwise an explicitly untrusted evidence DTO
   with state, original expiry and bounded source view (null after purge).
   `discardCaptureEvidence({namespace,client,eventId})` returns
   `{discarded:boolean}`; exact namespace and strict-field validation apply.
   Both require ordinary local access authority but no model/key. Discard removes
   content and fences in-flight admission; replay cannot recreate it.
6. Persisted event identity uses existing namespace/client/event/payloadDigest.
   Different payload conflicts. A live identical staged claim returns processing;
   admitted duplicate retains existing duplicate semantics without new model work.
   A failed or expired abandoned staged event is inspect/discard-only: no implicit
   retry. Crash-expired pending claims become failed on subsequent claim attempt.
   Existing non-staged claims cannot be retroactively staged. Fences must also
   reject legacy/manual claim/finish or reopening without captureEvidence.
7. Conservative first-version deletion: a successful forget OR correction clears
   every staged payload in that exact namespace and marks those events forgotten,
   including pending claims, atomically with the memory mutation. Old tokens and
   exact event replays cannot admit paraphrases. Other namespaces stay unchanged;
   other admitted memories are not deleted. Missing/stale rejected mutations do
   not purge. New unrelated events remain usable; this is not semantic blocking
   of deliberately resubmitted text under a new event ID. Document the breadth
   rather than claiming source-lineage precision or global semantic erasure.
8. Database migration is additive, transactional and versioned. Older readers
   must reject the new schema. Default capture must never stage plaintext; no
   retrospective backfill, telemetry, provider/model change or paid test.

## Verification

- Real-core synthetic tests: failed qualification retains source after reopen,
  no memory admitted, no source leakage to regular reads; successful capture and
  cold replay; malformed input/options and namespace boundaries; canonicalization
  and truncation; payload/count/byte quota failure before model calls; crash/lease
  expiry and clock rollback; identical/changed replay; discard during deferred
  extraction; forget/correct during deferred extraction from legacy and envelope
  facades; no resurrection after disabling staging; old-version migration.
- BothNode22.16/24: full core tests,store/admission/capture demos. Bothadapter and
  artifact suites for shared packaging compatibility; both offline evidence
  suites plus generic38/JSON/strict-plugin checks. No paid-provider rerun.
- Final fixed candidate gets independent Standards and Spec review, followed by
  PR and all-green CI. No publish/deploy. Follow with MCP integration only after
  embedded core behavior and deletion contract are demonstrated.
