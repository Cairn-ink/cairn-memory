# Explicit source-qualified capture through local MCP (S3b)

Fixed base: `ffe301d6afb9bfdcd9c7a1a022fea00445ba3801`.
Dependent local candidate; inherited private security disclosure hold remains.
S3a passed dual-runtime full gates and independent Standards/Spec review.

## Frozen contract

This connects the same core's opted-in extraction/qualification to local stdio
MCP. It does not install a hook, silently collect conversation, certify a named
client, authenticate submitted roles, decide currentness or grant execution
authority. It does not alter the hosted plugin/HTTP capture contract.

- P1: add optional CLI `--capture-qualification source-bound-v1` and matching
  server constructor `captureQualification`. Invalid explicit settings fail
  before database opening. Absence preserves the five existing tools and
  behavior. Snapshot the setting and namespace at construction. CLI help and
  syntax-only check report opt-in mode and unverified model availability;
  `automaticCapture:false`, no database access or provider request during check.
- P2: only enabled servers register sixth tool `capture_memory`. Exact input:
  `{batchId,messages:[{role,content}]}`. Batch ID uses existing 200-unit identifier
  validation. Messages are a dense array of 1–24 user/assistant entries, content
  1–4000 units each and canonical total at most 20000, with core Unicode and
  normalization checks authoritative. No namespace/path/receipts/qualification/
  causal chronology/slot/binding/transition inputs. Host fixes client to
  `cairn-local-mcp`, sessionId to `submitted-capture`; eventId is batchId.
  Message IDs are deterministic SHA-256 hex of JSON array
  `['cairn.mcp.submitted-message.v1',batchId,index]`. Use core.capture with no
  causal fields. No second extraction, storage or qualification engine.
- P3: same batch/input replay does not call models; changed content/order/role
  at the same batch ID conflicts. Never invent a fresh retry key after failure.
  Empty extraction has no qualifier call; absent model/invalid qualification
  has explicit failure and no partial memories. Neither tool arguments nor
  model output create trusted bindings or retire records. Existing explicit
  remember/correct remain keyless and are not silently reclassified.
- P4: expose optional boolean `includeQualification` on inspect_memory only
  with memoryId. Omitted/false preserves the old ID result; the flag is invalid
  for listing even when false. Forward existing core opt-in inspection without
  modifying receipt pagination/cursors or adding qualifications to recall.
  Qualification inspection works without a model and across cold restart;
  correction clears it, forgetting removes access, retained history remains
  inspectable. Anchor receipt IDs may refer outside the selected receipt page.
- P5: mark capture openWorldHint true. Guidance/help/docs explicitly distinguish
  submitted source claims from authenticated human transcript/intent, exact
  source binding from semantic truth, and configured credentials from verified
  availability. Capture may leave incompatible active records; it does not
  settle which is current. Remembered consent is never execution authorization.
  Save only on actual user intent; no background hooks/transcript reads.
- P6: protocol threat-model update covers newly accepted bounded text/roles,
  deterministic batch/message identifiers, normalization/redaction, model
  transmission and receipt retention. Provider key stays environment-only;
  no telemetry, account scope, production data or spending-cap claim. Keep
  64KiB input/256KiB output transport limits; oversize input rejects rather than
  truncating transcript. Some otherwise core-sized Unicode batches exceed the
  transport cap. CLI check has no model call or file creation.
- P7: actual SDK stdio tests cover default/enabled tool discovery, strict
  schemas, positive capture/inspect/restart/replay, changed replay input,
  keyless inspection/failure, invalid/extra/forged authority arguments,
  namespace isolation, Unicode/redaction anchors, malformed later qualification
  atomicity, no bindings/retirement, correction/forget, and old tools unchanged.
- P8: installed archive probe uses installed MCP server and installed OpenAI
  adapter with fake HTTP, actual stdio SDK client, synthetic database, shutdown
  and fresh process restart, qualified inspection/replay and no bindings.
  No source-only imports masquerading as installed integration. No real key,
  provider call, registry publication or named-client certification.
- P9: both Node 22.16/24 full contributor/JSON/plugin, MCP/OpenAI/core, relevant
  capture/store/history demos and installed-artifact gates. Frozen final commit
  gets independent Standards and Spec review before next implementation.

Next reliability stage remains non-mutating, revision-bound relation evidence
and independently authored semantic cases: source qualification alone cannot
authorize automatic same-slot binding or retirement. A disproved premise must
not silently change a user's recorded selection to an invented alternative.

## Local verification

Root verified final code on Node 22.16.0 and 24.15.0: each passed generic 31,
core 437, OpenAI 157, MCP 35, installed-artifact 20, budget-ledger 15 and
request-guard 42 tests. Offline live-evidence passed 61 with 27 skipped.
JSON/plugin validation and store/admission/MOC/capture/conflict/history/rebuild/
recall/continuation/OpenAI-offline demos exited 0. Installed tests use actual
stdio processes and installed runtime/adapter imports with fake HTTP; after
shutdown a new process inspects qualification and replays with HTTP forbidden.

The new oversized-wire test initially assumed a database existed; actual
transport rejection occurs before lazy server construction. Its corrected
assertion requires that the database never be created. Both complete MCP and
artifact suites were rerun after this test-only fix, without relaxing runtime
validation. These are synthetic protocol/lifecycle results, not real-model
accuracy, named-client certification or authorization to publish security work.
