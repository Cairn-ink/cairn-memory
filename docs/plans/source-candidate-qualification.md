# Core-owned qualification evidence candidates (S5a)

Base: `a75f821bb6ca4159a99632d1dd05b1667113d478`; private dependent work,
security disclosure hold unchanged. This slice changes the shared core and
optional adapter, not MCP exposure or paid-method authorization.

## Observed failure and boundary

The separately frozen one-case diagnostic failed after four HTTP requests.
Finite event: qualify/core_validation/invalid_qualification. Its anchor declared
end41 for a 55-UTF16-unit quote and omitted evidence coverage for nonnull value.
Read-only replay rejected original and offset-only correction; adding coverage
as a diagnostic counterfactual passed structure. Nothing was admitted/repaired.
Subject/property/value interpretation was also poor. This does not establish the
cause of the preceding six-case failure and is not a semantic pass.

## Acceptance

- C1: New explicit core constructor `captureQualification: 'source-bound-v2'`.
  Absent and v1 behavior, custom `model.qualify` contract and bytes/digests remain
  unchanged. The existing mode-bound digest distinguishes v1/v2 replay. Invalid
  settings fail before DB initialization. No storage schema/version migration.
- C2: Core generates immutable evidence candidates from canonical item receipts
  before the model call. Partition each full retained excerpt in receipt order
  into nonoverlapping nonempty windows <=200 UTF16 units, splitting only between
  complete Unicode code points. Cover every retained unit exactly once; do not
  truncate/drop/rewrite sources. Indices increase globally across the batch so
  another item's candidate is unambiguously rejected. Mapping receiptIndex,
  start/end/text remains core-owned; model input exposes only candidateIndex,
  role,text alongside itemIndex/content/kind. Candidate indices are request-local,
  not trusted identities. A long word/phrase may cross windows; this is a known
  semantic limitation, not permission to fabricate support.
  Before windowing, v2 applies the same final receipt text canonicalization as
  admission (including a trailing space left by 800-unit truncation). Cover that
  exact stored canonical excerpt; do not change v1 preprocessing or relocate a
  model-generated quote to compensate for mismatched evidence.
- C3: New model method `qualifyCandidates`; one call per extracted batch after
  extraction, before atomic admission. Input `{items:[{itemIndex,content,kind,
  candidates:[{candidateIndex,role,text}]}]}`. Output exactly
  `{qualifications:[{itemIndex,subject,property,scope,applies,value,attribution,
  commitment}]}` with exactly one entry for each item. Each of the seven fields
  is exactly `{value,evidenceIndices}`. Descriptive values retain existing S1
  nullable length limits; attribution/commitment retain existing enums. Each
  evidenceIndices is a dense unique array of 0..4 indices, all from that item.
  Known fields require >=1 reference. Unknown fields may have 0..4 references;
  all-unknown output must still explicitly select >=1 candidate overall.
- C4: Compiler groups selected candidates into S1 anchors; derives fields from
  fields that selected each candidate, not model-supplied coverage. Canonicalize
  anchor ordering by candidateIndex. Require 1..4 distinct selected candidates
  per item; reject a fifth, missing/foreign/duplicate refs, malformed fields,
  duplicate/missing item entries or additional model keys. Run unchanged
  qualificationInput on the compiled DTO. No fuzzy matching, fallback source,
  silently omitted field, automatic correction or repair of v1 output.
- C5: Existing canonical source digests, redaction, revision guards, dedup conflict,
  suppression and all-or-nothing admission stay authoritative. Mode v2 still
  skips ordered retirement without trusted identity, retaining unresolved
  qualification_requires_identity. No trusted slots/singleClaim/authorization
  assertions, bindings, supersession, new engine or writes during model calls.
- C6: New adapter dynamic schema/method and baseline model profile entry;
  statically exported legacy schemas and existing paid guards deny the new
  method. Keep 6000 local input, 7024 provider input,1024 output and30-second core
  timeout. Request-scoped schemas constrain item and candidate indices and field
  value/reference alternatives; core rechecks correlations. New finite diagnostic
  stage qualifyCandidates uses existing invalid_qualification reason. Package
  allowlist includes candidate/compiler module and dedicated prompt; real installed
  core+adapter import must work without source checkout dependencies.
- C7: Prompt defines subject as entity described (not imperative verb phrase),
  property as attribute, value as asserted value, and scope/applies as applicability.
  Preserve quote/assistant proposal/uncertainty/temporary conditions. Candidate
  choice/source existence never proves entailment/adoption/truth/currentness.
  Model never computes offsets, repeats quote text or supplies coverage lists.
- C8: Independent offline tests cover exact UTF16/astral/NFKC/redacted/repeated
  quote/window mapping, full source coverage, deterministic indices, same-item
  reference validation, cross-window multi-evidence, all-unknown, known-uncited,
  four vs five anchors and complete-batch atomic failure. Assert input has no
  receipt identities/offsets/answers, and v1 remains rejected on the observed
  malformed example. Verify v2 admission/cold/replay/mode mismatch/ordered safety,
  malformed model timeout/cancel/budget limits, adapter schema and paid denial.
- C9: Root bothNode22.16/24 generic/JSON/plugin/core/OpenAI/MCP/artifact/live-offline,
  ledger/guard and affected capture/offline-adapter demos; exact final candidate
  Standards+Spec review. No paid calls in this slice. Later MCP/explicit guarded
  fresh-case experiment is separate; frozen failed experiments never rerun.

Mechanical validity is the gate for inspectable qualifications, not a semantic
score. A claim can have perfectly copied evidence yet be interpreted incorrectly.
