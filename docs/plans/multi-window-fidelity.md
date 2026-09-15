# Multi-window source and answer fidelity diagnostic

Dependent base: `8bdcbb87f5b042c9723164c54e05e4c4e4d56569` (PR111).
Question: when a history outgrows complete small-set reads, which boundary loses
the evidence needed to preserve a changing decision and its reasons?

## Acceptance

1. Freeze three new authored pairs (six histories), each three windows of six
   messages and one final question. Each window contains five user messages and
   one assistant suggestion. Each pair differs only in one decisive user message,
   with provisional/conditional versus explicit commitment. Spread original
   reason, changed premise, actor and scope across windows. Use explicit natural
   temporal anchors in source text; receipt sorting is not chronology. Include
   unrelated and similar-topic distractors, no final recap repeating the decisive
   qualifier, real personal data, high-stakes guidance or execution permissions.
   This is three paired units, not six independent samples.
2. Separate model-facing fixture from rubric: required/irrelevant source IDs,
   decisive source/quote and prose expectations for commitment, actors, reasons
   and temporal scope. Validate shape, bounds, all bindings, disjoint labels,
   unique IDs, exactly one changed user sentence per pair before any callback.
   No labels/pair IDs enter capture, model or answer inputs. Clone inputs before
   callbacks so mutations cannot change the frozen experiment or later scoring.
3. Inject client and answer callbacks only; no provider/key/HTTP code. Each
   history has an operator-bound namespace; stable batch IDs include history and
   window. Capture each window once; close and reopen before inspecting its
   staged view and bounded admitted receipts. Capture/inspection/close errors
   remain visible; after an operational failure do not continue capturing that
   history. Post-admission classification failure is separately retained and
   does not erase admitted data. All 18 capture and 12 answer slots survive.
4. Bind inspected receipts to canonical source event hashes, role and exact
   excerpt; mismatched or foreign evidence fails validation, never counts as
   retained. Inspect at most 128 memories, three list pages and two 50-receipt
   pages per memory; bounded JSON responses, repeat cursors/IDs and inconsistent
   revisions fail closed. This is private evaluation inspection, not a product
   snapshot or a route to promote failed/staged source into recall.
5. After successful capture/cold inspection, call `read_memory_sources` once
   with limit12, then ordinary source-evidence `recall_memory` once with limit6.
   Record actual active admitted count: over12 is the challenge criterion, not
   an assumed property of 15 input statements. Fewer memories still remain in
   the report but do not demonstrate beyond-cap behavior. Over-cap rejection
   with no partial source payload is expected boundary behavior, not useful
   retrieval success. No padding, query retry, fallback, or automatic promotion.
   Final recall receipts must match cold admitted identity/revision and exact
   source projection. Mechanical coverage and semantic judgments stay separate.
6. Generate once from recalled source evidence and once from the full canonical
   18-message history, using identical unchanged SOURCE_ANSWER_INSTRUCTION,
   question and flat source format. Alternate arm order by history index.
   Control is explicitly constructed input, never claimed as Cairn recall.
   Failed/partial recall leaves its answer not-run; control can remain observed
   but cannot rescue a failed memory history. Preserve all operation and answer
   failures; all generated answers remain semanticStatus unassessed. Exact
   quotation transport is already provided by MCP: no redundant renderer or
   second memory engine is introduced here.
7. Actual-core scripted offline tests cover ordinary execution, >12 count and
   snapshot rejection, capture omission versus recall omission, classification
   error, cold/close failure, answer failure, malformed/foreign/oversized source,
   callback mutation and oracle separation. Both Node22.16/24 full offline
   evidence suites plus generic JSON/plugin gates. Two independent reviews and
   all required CI successes precede delivery. Existing frozen experiments,
   drivers, prompts and runtime defaults remain unchanged.

## Later installed execution gate (not completed by this slice)

Freeze commit/archive/fixture/rubric/operator hashes and rehearse transport,
malformed-source/answer and cleanup failures before a once-only synthetic paid
attempt. The operator must retain actual model traces (navigation visibility,
selected refs, fetched/rank candidates, rank selections, final receipts) and
stage-to-source mappings, calls, context bytes/tokens and latency. Missing trace
means unlocalized loss, not an invented causal diagnosis. Keep trace collection
outside product telemetry and retain no real conversation data.

Use the existing cumulative US$50 ledger, not a new allowance. Proposed local
cap is US$6 conservative reservations /600 HTTP requests /12 answer generations;
stop if either local or remaining cumulative allowance is insufficient. No
retry or replacement of failed attempts. Paid execution additionally requires
the frozen operator and offline failure gates, not merely this protocol.

Independent semantic review must distinguish lost conditionality, strengthened
or weakened commitment, actor swaps, invented/obsolete reasons, time omissions
and unsupported additions. Complete-source control failures identify answer
consumption limits but cannot validate retrieval. No broad reliability score,
MOC superiority, default change, npm publication, deployment or launch claim.
