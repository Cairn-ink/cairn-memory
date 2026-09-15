# Question-conditioned selection: bounded candidate contract

Dependent baseline: `3e8f11af357174db1dbe75a9a567080a4718c734`.

The once-only multi-window run localized seven source omissions at selection
despite faithful visible labels, and one at ranking. This package tests a
transient selection representation, not another persistent rationale graph.
It does not claim to fix answer currentness or authorize a live experiment.

## Acceptance

1. Add an evaluation-only module under `evaluation/architecture/` that builds a
   bounded question-conditioned selector request and compiles its response into
   the existing `{ refs }` selection shape. Production core, adapter schemas,
   default prompts and stored state remain unchanged. No network, credential,
   external model invocation, or implicit fallback is added by this module.
2. The request uses the actual query, visible navigation maps and existing
   `maxRefs`. The proposal contains at most four requests, each with an exact
   nonempty query span (UTF-16 start/end offsets) and zero or more visible memory
   references. No generated reason, asserted coverage status or source excerpt
   is accepted as authority. Distinct requests may select a shared reference;
   compile a stable first-occurrence union. Empty requests/proposals are allowed
   and mean no selected evidence, not proof of absence.
3. Fail closed on extra fields, malformed/dense-array failures, duplicate spans,
   duplicate references within a request, invalid query spans, group references,
   unknown namespace/memory/revision tuples, or more than twelve unique refs per
   namespace / `maxRefs` overall (maximum24). Validate identities with the core's
   existing identifier/revision rules; source data remains untrusted. Bound
   serialized input to24,000 UTF-8 bytes and output to16,000 bytes in addition
   to structural limits. These byte limits do not substitute for the existing
   model token/time limits in a future integration.
   Input means the complete prepared request including its instruction. Query
   length remains at most4,000 UTF-16 units and must be well-formed Unicode.
   Validate actual recall-visible map shapes and distinct namespace indices0/1;
   retain indices when only one namespace has a page. Reject conflicting
   revisions for a repeated namespace/memory identity; repeated identical tuples
   in different group memberships are valid. Groups are context, not selectable.
4. Return a detached validated request snapshot so caller mutation cannot change
   the allowed reference set after request preparation. The compiler validates
   against that snapshot, never a later caller map. It returns explicit
   `model-proposed` / semantic coverage `unassessed` diagnostics separately from
   `{ refs }`. No coverage certification, chronology inference, admission,
   correction, deletion, retrieval retry or broader namespace access occurs.
   Test mutation of original arguments and nested returned request fields.
5. Offline tests cover valid overlapping selections, empty/unresolved requests,
   malformed proposals, foreign/stale/nonvisible references, offsets including
   surrogate-pair boundaries, duplicate tuples/spans, union and namespace limits,
   mutation isolation, byte bounds and deterministic compilation. Handcrafted
   cases prove the contract, not improved model selection. Include a scripted
   invocation through the existing core recall orchestration to demonstrate
   the compiled shape is consumable without changing ranking or freshness rules.
6. Document the separately unfinished integration and fresh comparison gates:
   bounded model transport/schema support, one attempt per arm, matched call and
   context limits, independent required-source/irrelevant-source scoring, retained
   failures, and separate answer-currentness evaluation. Do not regenerate old
   answers or spend money here. Run generic tests, JSON and strict plugin checks
   on Node22.16/24; independent Standards/Spec review and required CI before merge.
   Preserve the generic suite's Node20 compatibility: pure compiler tests run
   there, while only the SQLite integration test explicitly skips below22.16.
