# Source evidence context (S7)

Base `b6df5ff9274b526646c132ba242ce9cbbc9b8f94`. Isolated dependent delivery.
No paid calls, registry publication, deployment, production data or merges.

The frozen eight-case real experiment completed mechanically but preserved
semantic failures: false adoption, question-to-assertion conversion, lost
uncertainty, generalized one-time conditions and incomplete antecedent anchors.
Do not rescore or rewrite these stored results. This slice separates sources
from interpretation when using memory; it does not certify either as truth.

## Acceptance

- S1: Add strict optional core fetch/recall `contextMode: 'source-evidence'`.
  Absent preserves every legacy/qualified response, prompt and cursor behavior.
  Reject any other value (including null), and reject simultaneous explicit
  `includeQualification:true` in source mode. False is allowed but irrelevant.
  No new schema, model method, inference stage, authority, source writing or
  automatic update. Inspection remains the way to view model interpretation.
- S2: Source-mode items have only `memory:{id,revision,currentness}`,
  `receipts:[{id,role,excerpt}]`, `receiptCount`,
  `interpretationStatus:'omitted'`, `sourceSelectionCoverage:'unassessed'`.
  Every field is constructed by core, not accepted from model output. Preserve
  exact stored canonical excerpts and submitted user/assistant roles. No
  content summary, kind, confidence, qualification labels, client/session/event
  IDs or inferred rationale in this usage DTO. Currentness is storage lifecycle,
  not temporal truth. Explicit remember text is itself a submitted source,
  not authenticated history; role never establishes adoption or authorization.
- S3: Source-mode fetch returns complete retained receipts for one reference,
  never a partial receipt or truncated source set. At most 100 receipts (using
  existing 101-row sentinel); more or failure to fit the existing <=4000-token
  envelope returns context_item_too_large. Pagination may continue across refs,
  not within sources. Source-mode cursors bind mode, refs, view, budget and epoch;
  reject cross-mode cursors and nonzero receipt offsets. Historical fetch may
  return source-only historical evidence, not generated change reasons.
- S4: Source-mode rank receives only source DTO candidates, with a separate
  source-evidence rank prompt; model summaries/labels cannot enter rank or final
  returned memory context. Existing MOC navigation/selection may still use
  unverified generated routing labels; document that selection bias remains.
  Keep max2 selects/36 candidates, existing4000 fetch/6000 rank-input/1024output
  bounds. Do not drop source text or candidates to force success. No extra
  model calls or source expansion into neighboring messages.
- S5: Validate source DTOs inside fetch/final transactions. Final recall rereads
  all candidates (even unselected and empty selection), checks namespace,
  revision/epoch, complete receipt count and source correspondence to the
  fetched candidate. Validate available qualification source bindings internally
  without returning their interpretations. Malformed/missing/changed sources
  fail closed; no counter/model callback follows authoritative final read.
  Preserve correction/forget/cold/isolation behavior and never repair records.
- S6: MCP recall exposes optional contextMode with same strict enum, usable
  with or without capture configuration. In source mode omitted qualification
  must not inherit the configured true default; explicit true conflicts.
  Existing callers without contextMode retain exact prior defaults. Namespace,
  tool count, transport caps and returned untrusted evidence label unchanged.
- S7: Independent core/MCP tests cover source-only rank/final field allowlist,
  exact proposal/question/uncertainty/exception/third-party source preservation,
  missing antecedent remains missing, no neighboring source retrofit, complete
  source limits and cursor separation, corrupt sources, stale/foreign refs,
  correction/forget races, empty/unselected freshness, cold behavior and both
  legacy modes. Root real installed fake-provider probe demonstrates that a
  deliberately wrong stored interpretation stays inspectable but is absent
  from source-mode rank and final context. This is not downstream answer quality.
- S8: Root both Node22.16/24 generic/JSON/plugin/core/OpenAI/MCP/artifact/live
  offline gates plus store/recall/capture/openai-offline demos; exact-head
  independent Standards/Spec review. Add new prompt/helper to artifact allowlist,
  threat-model docs and changelog. Preserve frozen eight-case aggregate evidence
  with no raw private locators or unsupported accuracy claim.

## Limits and next functional work

This prevents generated interpretations from being delivered as source text;
it cannot verify source truth, repair missing antecedents, eliminate MOC routing
bias, or prevent a downstream model misunderstanding sources. No source-mode
default switch is implied. User setup/native-host wiring, recorded rationale,
premise challenge and safe automatic state transitions remain required.
Additional model sufficiency checks may later reject unsupported interpretations,
but a second model agreeing is not verification or execution authority.

## Verification before candidate review

Root both Node22.16.0 and24.15.0: generic31, core502, OpenAI163, MCP53,
artifact47, live-offline99 passed/27 intentionally skipped, plus JSON/plugin
validation and store/recall/capture/OpenAI-offline demos.

Independent core16 and MCP4 new tests pass on both runtimes. The core tests
first found a source-fetch/tokenizer race: changing a stored source during
the counting callback without advancing epoch returned stale source context.
The fix rereads/validates the complete source page transactionally after the
last callback, compares it to the counted snapshot, and rejects mismatches.
The formerly failing regression now passes; legacy paths are unchanged.

Root actual installed fake-provider probe passed: deliberately wrong stored
adoption/summary stays inspectable, while source-mode rank/final output contains
only the exact two source passages and submitted roles. Cold inspection and
duplicate replay make zero HTTP requests; source recalls use existing calls.
Legacy qualified recall is unchanged. The artifact prompt hash is verified.

The frozen real eight-case result remains semantic_failures_observed; no real
model call or rescore occurred in this slice. Exact-head dual review pending.
