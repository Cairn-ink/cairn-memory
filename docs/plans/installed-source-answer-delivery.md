# Installed MCP source-to-answer delivery

Base: `1649d6c068cdf3bd824e7775256c8b0f629c1b9c` (source-answer utility PR).

Existing installed tests cover capture/restart/source recall; actual answer
evidence reused frozen contexts. Join those pieces without new graph logic,
default changes, real credentials or paid calls.

## Acceptance

1. A small evaluation-only consumer accepts an actual MCP tool result for
   source-evidence recall, validates success and the untrusted-evidence marker,
   and preserves exact original receipt IDs/roles/text and memory ID/revision/
   currentness. Generated summaries, qualification and basis are excluded by a
   strict shape check. Source-selection relevance remains unassessed.
2. Bound input to six source memories, at most 100 receipts per memory, 800 UTF-16
   units per excerpt, 4,000 per question, 262,144 bytes per incoming MCP text,
   and 24,000 serialized request bytes. Reject overflow or incomplete retained
   receipt pages rather than truncate. These bounds do not prove semantic
   completeness. Empty successful recall is valid ignorance, not a transport error.
3. Build one pinned-model, nonstreaming answer request with no tools, explicit
   untrusted evidence/non-authority instructions and 1,024 output tokens. Require
   an injected guarded completion function; never discover credentials, endpoints
   or global fetch. Invoke it once, no retry. Surface invalid source, completion
   failure and malformed/truncated/tool-bearing answer separately; never certify
   model truth from response completion. Preserve answer text on invalid output.
4. Through the generated installer command and real SDK stdio, capture an
   existing synthetic changed-decision source pair, close/restart, perform actual
   MOC source recall, and feed that exact result into an injected fake completion.
   Assert exact provenance, temporal/nonadoption text and absence of generated
   summary/qualification in model-facing context. No manual source admission.
5. Offline tests cover absent/error/oversized/partial/wrong-context MCP results,
   empty evidence, invalid host output and one-call transport failure. Regress
   ordinary default behavior without changing it. Tests are wiring evidence, not
   semantic accuracy, real-host tool choice or resistance to model-level injection.
6. Run Node 22.16 and 24 live-evidence offline suites and installed artifact
   suites, generic tests, JSON and strict plugin validation. Independently review
   exact candidate on Standards and Spec before delivery.
